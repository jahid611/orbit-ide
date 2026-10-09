/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Orbit live view inspector. Injected into the previewed page by Orbit's local relay: lets the
// user point at any element, and tells Orbit what it is and where it comes from in the code.
// @ts-nocheck

(function () {
	if (window.__orbitInspector || window.parent === window) {
		return;
	}
	window.__orbitInspector = true;

	const ACCENT = '#8b7bff';
	const PICKED = '#5eead4';
	let selecting = false;
	let hovered = null;
	let picked = null;
	let pickedSelector = '';

	const post = message => window.parent.postMessage({ source: 'orbit-inspector', ...message }, '*');

	// --- runtime errors of the page, reported to Orbit so Claude can fix them
	const seen = new Set();
	const report = (kind, message, detail = {}) => {
		const text = String(message ?? '').slice(0, 1200);
		const key = `${kind}|${text}|${detail.source ?? ''}:${detail.line ?? ''}`;
		// The same error in a loop (a render that throws every frame) is reported once.
		if (!text || seen.has(key) || seen.size > 200) {
			return;
		}
		seen.add(key);
		post({ type: 'pageError', error: { kind, message: text, source: detail.source, line: detail.line, column: detail.column, stack: detail.stack ? String(detail.stack).slice(0, 1500) : undefined, at: Date.now() } });
	};
	addEventListener('error', e => {
		if (e.target && e.target !== window && (e.target.src || e.target.href)) {
			// A script, stylesheet or image that failed to load.
			report('resource', `${String(e.target.tagName).toLowerCase()} introuvable : ${e.target.src || e.target.href}`);
		} else {
			report('error', e.message, { source: e.filename, line: e.lineno, column: e.colno, stack: e.error && e.error.stack });
		}
	}, true);
	addEventListener('unhandledrejection', e => {
		const r = e.reason;
		report('promise', r && r.message ? r.message : String(r), { stack: r && r.stack });
	});
	const consoleError = console.error;
	console.error = function (...args) {
		try {
			report('console', args.map(a => a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a).slice(0, 300) : String(a)).join(' '), { stack: args.find(a => a instanceof Error)?.stack });
		} catch {
			// unserialisable argument: the page's own console still gets it
		}
		return consoleError.apply(this, args);
	};
	if (window.fetch) {
		const realFetch = window.fetch;
		window.fetch = function (input, init) {
			const url = typeof input === 'string' ? input : input && input.url;
			const method = (init && init.method) || (input && input.method) || 'GET';
			return realFetch.apply(this, arguments).then(res => {
				if (res.status >= 400) {
					report('network', `${method} ${url} a répondu ${res.status} ${res.statusText}`);
				}
				return res;
			}, err => {
				report('network', `${method} ${url} a échoué : ${err && err.message}`);
				throw err;
			});
		};
	}

	// --- overlay, drawn above the page and never part of it
	const host = document.createElement('orbit-inspector');
	const shadow = host.attachShadow({ mode: 'closed' });
	shadow.innerHTML = `<style>
		.box { position: fixed; pointer-events: none; z-index: 2147483647; border-radius: 4px; transition: all .08s ease-out; display: none; }
		.hover { outline: 2px solid ${ACCENT}; background: rgba(139, 123, 255, .10); }
		.picked { outline: 2px solid ${PICKED}; background: rgba(94, 234, 212, .08); box-shadow: 0 0 0 4px rgba(94, 234, 212, .18); }
		.chip { position: fixed; pointer-events: none; z-index: 2147483647; display: none; font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
			color: #fff; background: ${ACCENT}; padding: 4px 7px; border-radius: 6px; white-space: nowrap; box-shadow: 0 4px 14px rgba(0, 0, 0, .35); }
		.chip b { font-weight: 700; } .chip i { font-style: normal; opacity: .8; margin-left: 6px; }
	</style><div class="box hover"></div><div class="box picked"></div><div class="chip"></div>`;
	const [hoverBox, pickedBox, chip] = shadow.querySelectorAll('.hover, .picked, .chip');
	const mount = () => { if (!host.isConnected) { document.documentElement.appendChild(host); } };

	function place(box, el) {
		if (!el || !el.isConnected) {
			box.style.display = 'none';
			return null;
		}
		const r = el.getBoundingClientRect();
		Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
		return r;
	}

	function render() {
		mount();
		const r = selecting ? place(hoverBox, hovered) : place(hoverBox, null);
		if (r && hovered) {
			const info = describe(hovered, false);
			chip.innerHTML = `<b>${escape(info.label)}</b>${info.component ? `<i>${escape(info.component)}</i>` : ''}`;
			chip.style.display = 'block';
			chip.style.left = `${Math.max(4, Math.min(r.left, innerWidth - chip.offsetWidth - 4))}px`;
			chip.style.top = `${r.top > 28 ? r.top - 26 : r.bottom + 6}px`;
		} else {
			chip.style.display = 'none';
		}
		if (picked && !picked.isConnected && pickedSelector) {
			// The app re-rendered (hot reload): find the same element again.
			picked = document.querySelector(pickedSelector);
		}
		place(pickedBox, picked);
	}
	let frame = 0;
	const schedule = () => { if (!frame) { frame = requestAnimationFrame(() => { frame = 0; render(); }); } };
	addEventListener('scroll', schedule, true);
	addEventListener('resize', schedule);
	new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true });

	// --- what an element is, and where it comes from
	function escape(s) {
		return String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
	}

	function label(el) {
		const classes = [...el.classList].filter(c => !/^(orbit-|css-|sc-|jsx-)/.test(c)).slice(0, 2);
		return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes.map(c => `.${c}`).join('')}`;
	}

	function selectorOf(el) {
		const parts = [];
		for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
			if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
				parts.unshift(`#${CSS.escape(node.id)}`);
				break;
			}
			let part = node.tagName.toLowerCase();
			const parent = node.parentElement;
			if (parent) {
				const same = [...parent.children].filter(c => c.tagName === node.tagName);
				if (same.length > 1) {
					part += `:nth-of-type(${same.indexOf(node) + 1})`;
				}
			}
			parts.unshift(part);
		}
		return parts.join(' > ');
	}

	function fiberOf(el) {
		for (const key in el) {
			if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
				return el[key];
			}
		}
		return undefined;
	}

	function componentName(type) {
		return typeof type === 'function' ? (type.displayName || type.name) : type && typeof type === 'object' ? (type.displayName || type.render?.displayName || type.render?.name || type.type?.name) : undefined;
	}

	/** Framework debug data: React (fiber), Vue (component file), Svelte (loc). */
	function frameworkInfo(el) {
		const fiber = fiberOf(el);
		if (fiber) {
			let component;
			for (let f = fiber.return; f && !component; f = f.return) {
				component = componentName(f.type);
			}
			const source = fiber._debugSource || fiber._debugOwner?._debugSource;
			const stack = fiber._debugStack?.stack || (typeof fiber._debugStack === 'string' ? fiber._debugStack : undefined);
			return { framework: 'React', component, source: source && { file: source.fileName, line: source.lineNumber, column: source.columnNumber }, stack };
		}
		for (let node = el; node; node = node.parentElement) {
			if (node.__svelte_meta?.loc) {
				const loc = node.__svelte_meta.loc;
				return { framework: 'Svelte', source: { file: loc.file, line: loc.line, column: loc.column + 1 } };
			}
			const vue = node.__vueParentComponent;
			if (vue) {
				return { framework: 'Vue', component: vue.type?.name || vue.type?.__name, source: vue.type?.__file && { file: vue.type.__file } };
			}
		}
		return {};
	}

	function describe(el, full) {
		const fw = frameworkInfo(el);
		const info = { label: label(el), component: fw.component };
		if (!full) {
			return info;
		}
		const annotated = el.closest('[data-orbit-loc]');
		const [line, column] = (annotated?.getAttribute('data-orbit-loc') || '').split(':').map(Number);
		return {
			...info,
			tag: el.tagName.toLowerCase(),
			text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
			ownText: [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120),
			classes: [...el.classList].slice(0, 12),
			attributes: ['href', 'src', 'alt', 'placeholder', 'aria-label', 'title', 'type'].filter(a => el.hasAttribute(a)).map(a => `${a}="${el.getAttribute(a).slice(0, 80)}"`),
			selector: selectorOf(el),
			html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 700),
			framework: fw.framework,
			source: fw.source,
			stack: fw.stack,
			annotated: annotated && line ? { path: location.pathname, line, column, exact: annotated === el } : undefined,
			url: location.href,
		};
	}

	// --- pointing
	const ours = e => e.composedPath().includes(host);
	addEventListener('mousemove', e => {
		if (!selecting || ours(e)) {
			return;
		}
		const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
		if (el !== hovered) {
			hovered = el;
			schedule();
		}
	}, true);
	for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
		addEventListener(type, e => { if (selecting && !ours(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
	}
	addEventListener('click', e => {
		if (!selecting || ours(e)) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		picked = hovered || e.target;
		pickedSelector = selectorOf(picked);
		schedule();
		post({ type: 'selected', info: describe(picked, true) });
	}, true);
	addEventListener('keydown', e => {
		if (e.key === 'Escape' && selecting) {
			setSelecting(false);
			post({ type: 'mode', selecting: false });
		} else if (e.key === 'Escape') {
			// The page has the focus: Orbit still closes its large view.
			post({ type: 'escape' });
		}
	}, true);

	function setSelecting(value) {
		selecting = value;
		hovered = null;
		document.documentElement.style.cursor = value ? 'crosshair' : '';
		schedule();
	}

	addEventListener('message', e => {
		const msg = e.data;
		if (!msg || msg.source !== 'orbit-preview') {
			return;
		}
		if (msg.type === 'mode') {
			setSelecting(!!msg.selecting);
		} else if (msg.type === 'clear') {
			picked = null;
			pickedSelector = '';
			schedule();
		} else if (msg.type === 'navigate') {
			if (msg.action === 'back') { history.back(); } else if (msg.action === 'forward') { history.forward(); } else if (msg.action === 'reload') { location.reload(); }
		} else if (msg.type === 'device') {
			// Phones and tablets overlay their scrollbars: none take room on the page.
			let style = document.getElementById('orbit-device-style');
			if (msg.on && !style) {
				style = document.createElement('style');
				style.id = 'orbit-device-style';
				style.textContent = '::-webkit-scrollbar { width: 0 !important; height: 0 !important; }';
				document.documentElement.appendChild(style);
			} else if (!msg.on && style) {
				style.remove();
			}
		}
	});

	// --- static pages: Orbit reloads them when their files change, keeping the scroll position
	try {
		const saved = sessionStorage.getItem('orbit-scroll');
		if (saved) {
			sessionStorage.removeItem('orbit-scroll');
			const [x, y] = saved.split(',').map(Number);
			addEventListener('load', () => scrollTo(x, y));
		}
		const events = new EventSource('/__orbit/events');
		events.onmessage = () => {
			sessionStorage.setItem('orbit-scroll', `${scrollX},${scrollY}`);
			location.reload();
		};
	} catch {
		// not served by the static relay
	}

	const announce = () => post({ type: 'ready', url: location.href, title: document.title });
	addEventListener('popstate', announce);
	for (const method of ['pushState', 'replaceState']) {
		const original = history[method];
		history[method] = function (...args) { const result = original.apply(this, args); announce(); return result; };
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', announce);
	} else {
		announce();
	}
})();
