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
	/** The same errors, kept for the agent when it reads the page. */
	const problems = [];
	const report = (kind, message, detail = {}) => {
		const text = String(message ?? '').slice(0, 1200);
		const key = `${kind}|${text}|${detail.source ?? ''}:${detail.line ?? ''}`;
		// The same error in a loop (a render that throws every frame) is reported once.
		if (!text || seen.has(key) || seen.size > 200) {
			return;
		}
		seen.add(key);
		problems.push(`${kind} : ${text.slice(0, 300)}${detail.source ? ` (${detail.source}:${detail.line ?? ''})` : ''}`);
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

	// --- the agent uses the page as a person would: it reads it, clicks, types, and reads it again.
	// Orbit's relay sends its requests down the event stream; the answers go back by a plain request.
	const INTERACTIVE = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], [onclick], [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"])';
	let refs = [];
	// The page is being left: whatever it would answer describes a page that is going away.
	let leaving = false;
	addEventListener('beforeunload', () => { leaving = true; });
	const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
	const shown = el => {
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) {
			return false;
		}
		const s = getComputedStyle(el);
		return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.02;
	};
	const squeeze = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
	const nameOf = el => squeeze(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? '' : el.innerText) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || (el.querySelector && el.querySelector('img[alt]') && el.querySelector('img[alt]').alt) || '', 90);
	const kindOf = el => {
		const role = el.getAttribute('role');
		const tag = el.tagName.toLowerCase();
		if (tag === 'a' || role === 'link') { return 'lien'; }
		if (tag === 'select') { return 'liste'; }
		if (tag === 'textarea') { return 'zone de texte'; }
		if (tag === 'input') {
			const type = (el.getAttribute('type') || 'text').toLowerCase();
			return type === 'checkbox' ? 'case à cocher' : type === 'radio' ? 'bouton radio' : /^(submit|button|reset|image)$/.test(type) ? 'bouton' : type === 'file' ? 'champ fichier' : `champ ${type}`;
		}
		if (role === 'tab') { return 'onglet'; }
		if (role === 'checkbox' || role === 'switch') { return 'interrupteur'; }
		if (el.isContentEditable) { return 'zone de texte'; }
		return 'bouton';
	};
	const look = () => {
		refs = [];
		const lines = [];
		const height = innerHeight;
		for (const el of document.querySelectorAll(INTERACTIVE)) {
			if (refs.length >= 160 || !shown(el) || el.closest('orbit-inspector')) {
				continue;
			}
			// A link wrapping a button, a button wrapping a span with a tabindex: the outer one is enough.
			if (refs.some(known => known !== el && known.contains(el) && known.tagName !== 'FORM' && nameOf(known) === nameOf(el))) {
				continue;
			}
			refs.push(el);
			const r = el.getBoundingClientRect();
			const facts = [];
			if (el.disabled || el.getAttribute('aria-disabled') === 'true') { facts.push('désactivé'); }
			if (el.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') { facts.push('coché'); }
			if (el.tagName === 'SELECT') { facts.push(`choisi : ${squeeze(el.selectedOptions[0] && el.selectedOptions[0].text, 40)} ; choix : ${Array.from(el.options).slice(0, 12).map(o => squeeze(o.text, 30)).join(' | ')}`); }
			else if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|submit|button|file|password)$/i.test(el.type) && el.value) { facts.push(`contient « ${squeeze(el.value, 60)} »`); }
			else if (el.type === 'password' && el.value) { facts.push('rempli'); }
			if (el.validity && !el.validity.valid && el.validationMessage) { facts.push(`refusé par le navigateur : ${squeeze(el.validationMessage, 80)}`); }
			if (el.tagName === 'A' && el.getAttribute('href')) { facts.push(`vers ${squeeze(el.getAttribute('href'), 70)}`); }
			if (r.bottom < 0 || r.top > height) { facts.push('hors de l\'écran'); }
			lines.push(`[${refs.length}] ${kindOf(el)} « ${nameOf(el) || 'sans nom'} »${facts.length ? ` (${facts.join(', ')})` : ''}`);
		}
		const text = String(document.body ? document.body.innerText : '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
		return {
			address: `${location.pathname}${location.search}${location.hash}`,
			title: document.title,
			window: `${innerWidth} × ${innerHeight}`,
			scroll: `${Math.round(scrollY)} sur ${Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight))}`,
			focus: document.activeElement && refs.includes(document.activeElement) ? refs.indexOf(document.activeElement) + 1 : undefined,
			elements: lines,
			text: text.length > 6000 ? `${text.slice(0, 6000)}\n… (texte coupé : fais défiler ou cible un élément)` : text,
			errors: problems.slice(-12),
		};
	};
	const find = target => {
		if (typeof target === 'number' || /^\d+$/.test(String(target))) {
			if (!refs.length) {
				look();
			}
			const el = refs[Number(target) - 1];
			if (!el || !el.isConnected) {
				throw new Error(`L'élément ${target} n'existe plus : la page a changé, relis-la.`);
			}
			return el;
		}
		const wanted = squeeze(target, 200).toLowerCase();
		if (!wanted) {
			throw new Error('Il faut dire quel élément (target) : son numéro, son texte ou un sélecteur CSS.');
		}
		const all = Array.from(document.querySelectorAll(INTERACTIVE)).filter(shown);
		const exact = all.find(el => nameOf(el).toLowerCase() === wanted) || all.find(el => nameOf(el).toLowerCase().includes(wanted));
		if (exact) {
			return exact;
		}
		try {
			const el = document.querySelector(String(target));
			if (el) {
				return el;
			}
		} catch {
			// not a selector
		}
		throw new Error(`Aucun élément « ${target} » sur la page.`);
	};
	const click = el => {
		el.scrollIntoView({ block: 'center', inline: 'center' });
		const r = el.getBoundingClientRect();
		const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
		el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, isPrimary: true }));
		el.dispatchEvent(new MouseEvent('mousedown', init));
		if (typeof el.focus === 'function') { el.focus(); }
		el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, isPrimary: true }));
		el.dispatchEvent(new MouseEvent('mouseup', init));
		el.click();
	};
	const write = (el, text) => {
		el.scrollIntoView({ block: 'center' });
		el.focus();
		if (el.isContentEditable) {
			document.execCommand('selectAll');
			document.execCommand('insertText', false, text);
			return;
		}
		if (!/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
			throw new Error('Cet élément n\'est pas un champ où écrire.');
		}
		// Frameworks watch the element's own setter: going through the prototype's is what typing does.
		const setter = Object.getOwnPropertyDescriptor(el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set;
		setter.call(el, text);
		el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const press = key => {
		const el = document.activeElement || document.body;
		const init = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, composed: true };
		const went = el.dispatchEvent(new KeyboardEvent('keydown', init));
		el.dispatchEvent(new KeyboardEvent('keyup', init));
		if (went && key === 'Enter' && el.form && el.tagName !== 'TEXTAREA') {
			if (typeof el.form.requestSubmit === 'function') { el.form.requestSubmit(); } else { el.form.submit(); }
		}
	};
	/** The page has stopped moving: nothing changed in it for a quarter of a second. */
	const settle = () => new Promise(resolve => {
		let quiet;
		const done = () => { observer.disconnect(); clearTimeout(limit); resolve(); };
		const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, 250); });
		const limit = setTimeout(done, 3000);
		observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
		quiet = setTimeout(done, 450);
	});
	const act = async command => {
		switch (command.action) {
			case 'look': break;
			case 'click': click(find(command.target)); break;
			case 'type': {
				const el = find(command.target);
				write(el, String(command.text ?? ''));
				if (command.submit) {
					press('Enter');
				}
				break;
			}
			case 'press': press(String(command.key || 'Enter')); break;
			case 'select': {
				const el = find(command.target);
				if (el.tagName !== 'SELECT') {
					throw new Error('Cet élément n\'est pas une liste de choix.');
				}
				const wanted = squeeze(command.text, 200).toLowerCase();
				const option = Array.from(el.options).find(o => o.value.toLowerCase() === wanted || squeeze(o.text, 200).toLowerCase() === wanted) || Array.from(el.options).find(o => squeeze(o.text, 200).toLowerCase().includes(wanted));
				if (!option) {
					throw new Error(`Aucun choix « ${command.text} » dans cette liste.`);
				}
				el.value = option.value;
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
				break;
			}
			case 'scroll':
				if (command.target !== undefined && command.target !== '') {
					find(command.target).scrollIntoView({ block: 'center' });
				} else {
					const to = String(command.text || 'down');
					scrollTo({ top: to === 'top' ? 0 : to === 'bottom' ? document.documentElement.scrollHeight : scrollY + (to === 'up' ? -1 : 1) * innerHeight * 0.85 });
				}
				break;
			case 'go': {
				// The page lives behind Orbit's relay: a full address of the app is followed by its path.
				let to = String(command.text || '/');
				if (/^https?:\/\//i.test(to)) {
					const url = new URL(to);
					to = `${url.pathname}${url.search}${url.hash}`;
				} else if (/^[a-z][a-z0-9+.-]*:/i.test(to)) {
					throw new Error(`« ${to} » n'est pas une page de l'application : donne un chemin, par exemple /login.`);
				}
				location.assign(to);
				break;
			}
			case 'back': history.back(); break;
			case 'reload': location.reload(); break;
			case 'wait': await pause(Math.min(10000, Math.max(100, Number(command.text) || 1000))); break;
			default: throw new Error(`Action inconnue « ${command.action} ».`);
		}
		if (command.action !== 'look') {
			await settle();
			if (command.action === 'go' || command.action === 'reload') {
				await pause(1200);
			}
		}
		if (leaving) {
			// Orbit reads the page that replaces this one.
			return new Promise(() => undefined);
		}
		return look();
	};
	const answer = (id, body) => {
		const request = new XMLHttpRequest();
		request.open('POST', '/__orbit/agent');
		request.setRequestHeader('content-type', 'application/json');
		request.send(JSON.stringify({ id, ...body }));
	};
	// Links that leave the application. The view only shows what runs through Orbit's relay:
	// another site would not load in this frame, and a new tab has nowhere to open. Orbit is
	// asked instead: it opens the address in the computer's browser, or, when the address is
	// the application's own under its real origin, answers with the path to go to here.
	const leave = (/** @type {string} */ address) => {
		const request = new XMLHttpRequest();
		request.open('POST', '/__orbit/external');
		request.setRequestHeader('content-type', 'application/json');
		request.onload = () => {
			try {
				const inside = JSON.parse(request.responseText).go;
				if (inside) {
					location.href = inside;
				}
			} catch {
				// opened outside
			}
		};
		request.send(JSON.stringify({ url: address }));
	};
	const outside = (/** @type {string | URL | undefined | null} */ address) => {
		try {
			const url = new URL(String(address ?? ''), location.href);
			return /^(https?|mailto|tel|sms):$/.test(url.protocol) && url.origin !== location.origin ? url.href : undefined;
		} catch {
			return undefined;
		}
	};
	addEventListener('click', e => {
		if (selecting || e.defaultPrevented || e.button !== 0) {
			return;
		}
		const link = e.composedPath().find(el => el instanceof Element && el.matches('a[href], area[href]'));
		const address = link && outside(/** @type {Element} */ (link).getAttribute('href'));
		if (address) {
			e.preventDefault();
			leave(address);
		}
	});
	const openWindow = window.open;
	window.open = function (address, ...rest) {
		const target = outside(address);
		if (target) {
			leave(target);
			return null;
		}
		return openWindow.call(window, address, ...rest);
	};

	const onAgent = e => {
		let command;
		try {
			command = JSON.parse(e.data);
		} catch {
			return;
		}
		act(command).then(result => answer(command.id, { result }), err => answer(command.id, { error: String(err && err.message || err) }));
	};

	// --- static pages: Orbit reloads them when their files change, keeping the scroll position
	try {
		const saved = sessionStorage.getItem('orbit-scroll');
		if (saved) {
			sessionStorage.removeItem('orbit-scroll');
			const [x, y] = saved.split(',').map(Number);
			addEventListener('load', () => scrollTo(x, y));
		}
		// A frame inside the page runs this script too: only the page itself answers the agent.
		let inner = false;
		try {
			inner = !!window.parent.__orbitInspector;
		} catch {
			// the parent is Orbit's own frame
		}
		const events = new EventSource(inner ? '/__orbit/events' : '/__orbit/events?page=1');
		if (!inner) {
			events.addEventListener('agent', onAgent);
		}
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
