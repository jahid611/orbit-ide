/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { icon } = window.OrbitIcons;
	// @ts-ignore
	const setup = window.OrbitViewer;
	// @ts-ignore
	const docx = window.docx;

	const escape = (/** @type {string} */ text) => String(text).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
	const svg = (/** @type {string} */ d) => `<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
	const I = {
		up: svg('m6 14 6-6 6 6'),
		down: svg('m6 10 6 6 6-6'),
		minus: svg('M6 12h12'),
		plus: svg('M12 6v12M6 12h12'),
		out: svg('M14 4h6v6m0-6-9 9M10 6H5v13h13v-5'),
		exact: svg('M12 3l2.4 5.6 5.6.9-4.3 3.9 1.2 5.8L12 16.3l-4.9 2.9 1.2-5.8L4 9.5l5.6-.9L12 3Z'),
	};

	/** @type {'auto' | 'width' | 'page' | number} */
	let fit = 'auto';
	let scale = 1;
	let current = 0;
	/** @type {HTMLElement[]} */
	let pages = [];
	/** @type {Range[]} */
	let matches = [];
	let match = -1;

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="bar">
			<button id="prev" class="tool" title="Page précédente">${I.up}</button>
			<button id="next" class="tool" title="Page suivante">${I.down}</button>
			<span class="pager"><input id="page" type="text" inputmode="numeric" value="1" /><span id="count">/ …</span></span>
			<span class="sep"></span>
			<button id="out" class="tool" title="Réduire">${I.minus}</button>
			<select id="zoom" title="Taille d'affichage">
				<option value="auto">Automatique</option><option value="width">Largeur</option><option value="page">Page entière</option>
				<option value="0.5">50 %</option><option value="0.75">75 %</option><option value="1">100 %</option><option value="1.25">125 %</option><option value="1.5">150 %</option><option value="2">200 %</option><option value="3">300 %</option>
			</select>
			<button id="in" class="tool" title="Agrandir">${I.plus}</button>
			<span class="spacer"></span>
			<div class="find"><span class="glass">${icon('search')}</span><input id="find" type="text" placeholder="Rechercher…" spellcheck="false" /><span id="found"></span><button id="findPrev" class="tool small" title="Résultat précédent">${I.up}</button><button id="findNext" class="tool small" title="Résultat suivant">${I.down}</button></div>
			<span class="sep"></span>
			<button id="exact" class="text" title="Convertit le document en PDF avec le logiciel installé sur cette machine, pour un rendu identique à l'original" hidden>${I.exact}<span>Rendu exact</span></button>
			<button id="agent" class="text accent" title="Envoyer ce document (et le texte sélectionné) à ${escape(setup.assistant)}"><span>Demander à ${escape(setup.assistant)}</span></button>
			<button id="external" class="tool" title="Ouvrir avec l'application du système">${I.out}</button>
		</header>
		<div class="body">
			<main id="scroller" class="scroller"><div id="status" class="status">${icon('refresh')}<span>Ouverture de ${escape(setup.name)}…</span></div><div id="sheets" class="sheets"><div id="frame" class="frame"><div id="zoomed" class="zoomed"><div id="styles"></div><div id="doc"></div></div></div></div></main>
		</div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	const scroller = /** @type {HTMLElement} */ ($('scroller'));
	const zoomed = /** @type {HTMLElement} */ ($('zoomed'));
	const frame = /** @type {HTMLElement} */ ($('frame'));
	$('exact').hidden = !setup.exact;

	function status(/** @type {string} */ text, failed = false) {
		$('status').hidden = !text;
		$('status').className = `status ${failed ? 'failed' : ''}`;
		$('status').innerHTML = `${failed ? '' : icon('refresh')}<span>${escape(text)}</span>`;
	}

	// ------------------------------------------------------------------ layout

	/** The first page at its real size (zoom 1), measured when the document is laid out. */
	let natural = { w: 816, h: 1056 };

	function layout() {
		// The reader stays where they were: the same point of the same page at the top.
		const anchor = pages[current];
		const at = anchor ? (scroller.getBoundingClientRect().top - anchor.getBoundingClientRect().top) / Math.max(1, anchor.getBoundingClientRect().height) : 0;
		const { w, h } = natural;
		const byWidth = (scroller.clientWidth - 40) / w;
		scale = fit === 'width' ? byWidth : fit === 'page' ? Math.min(byWidth, (scroller.clientHeight - 28) / h) : fit === 'auto' ? Math.min(1, byWidth) : fit;
		scale = Math.min(5, Math.max(0.1, scale));
		// The pages keep their layout and are scaled as a picture; the frame around them takes the
		// scaled size, so the scroll bars are right. (CSS zoom gave positions that did not agree.)
		zoomed.style.transform = `scale(${scale})`;
		frame.style.width = `${Math.ceil(zoomed.offsetWidth * scale)}px`;
		frame.style.height = `${Math.ceil(zoomed.offsetHeight * scale)}px`;
		$('zoom').value = String(fit);
		if (typeof fit === 'number' && $('zoom').value !== String(fit)) {
			let custom = $('zoom').querySelector('[data-custom]');
			if (!custom) {
				custom = document.createElement('option');
				custom.setAttribute('data-custom', '');
				$('zoom').appendChild(custom);
			}
			custom.value = String(fit);
			custom.textContent = `${Math.round(fit * 100)} %`;
			$('zoom').value = String(fit);
		}
		if (anchor) {
			scroller.scrollTop = top(anchor) + at * anchor.offsetHeight * scale;
		}
	}

	function setFit(/** @type {'auto' | 'width' | 'page' | number} */ next) {
		fit = typeof next === 'number' ? Math.min(5, Math.max(0.1, next)) : next;
		layout();
	}

	/** Where a page starts in the scrolled content, at the current scale. */
	const top = (/** @type {HTMLElement} */ page) => frame.offsetTop + page.offsetTop * scale;

	function goTo(/** @type {number} */ index, smooth = false) {
		const page = pages[Math.min(pages.length - 1, Math.max(0, index))];
		if (page) {
			scroller.scrollTo({ top: top(page) - 12, behavior: smooth ? 'smooth' : 'auto' });
		}
	}

	function track() {
		const middle = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
		let found = 0;
		pages.forEach((page, index) => {
			if (page.getBoundingClientRect().top <= middle) {
				found = index;
			}
		});
		current = found;
		if (document.activeElement !== $('page')) {
			$('page').value = String(current + 1);
		}
	}

	// ------------------------------------------------------------------ the file

	async function open(/** @type {string} */ url, keepPlace = false) {
		const ratio = keepPlace ? scroller.scrollTop / Math.max(1, scroller.scrollHeight) : 0;
		if (!keepPlace) {
			status(`Ouverture de ${setup.name}…`);
		}
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`lecture impossible (${response.status})`);
			}
			const data = await response.arrayBuffer();
			$('doc').innerHTML = '';
			$('styles').innerHTML = '';
			zoomed.style.transform = '';
			await docx.renderAsync(data, $('doc'), $('styles'), {
				className: 'docx',
				inWrapper: true,
				breakPages: true,
				// Word writes where its pages ended when it last saved: the pages fall where they do in Word.
				ignoreLastRenderedPageBreak: false,
				experimental: true,
				renderHeaders: true,
				renderFooters: true,
				renderFootnotes: true,
				renderEndnotes: true,
				useBase64URL: true,
			});
		} catch (err) {
			status(`Ce document ne s'ouvre pas : ${err instanceof Error ? err.message : String(err)}`, true);
			return;
		}
		pages = /** @type {HTMLElement[]} */ ([...$('doc').querySelectorAll('section.docx')]);
		$('count').textContent = `/ ${pages.length}`;
		if (pages[0]) {
			natural = { w: pages[0].offsetWidth, h: pages[0].offsetHeight };
		}
		status('');
		layout();
		if (keepPlace) {
			scroller.scrollTop = ratio * scroller.scrollHeight;
		} else {
			scroller.scrollTop = 0;
		}
		track();
		if (query) {
			search(query, false);
		}
	}

	// ------------------------------------------------------------------ search

	let query = '';
	/** One letter as it is compared: lower case, without its accent. Keeps the length of the text. */
	const fold = (/** @type {string} */ text) => [...text].map(c => c.toLowerCase().normalize('NFD')[0] ?? c).join('');

	/** Word cuts a sentence into many runs: the text is searched as a whole, then found back in its pieces. */
	function search(/** @type {string} */ text, jump = true) {
		query = text;
		matches = [];
		match = -1;
		// @ts-ignore
		const highlights = CSS.highlights;
		highlights?.delete('orbit-find');
		highlights?.delete('orbit-find-current');
		const wanted = fold(text.trim());
		if (wanted) {
			const walker = document.createTreeWalker($('doc'), NodeFilter.SHOW_TEXT);
			/** @type {Text[]} */
			const nodes = [];
			/** @type {number[]} */
			const starts = [];
			let all = '';
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				nodes.push(/** @type {Text} */ (node));
				starts.push(all.length);
				all += fold(/** @type {Text} */ (node).data);
			}
			const locate = (/** @type {number} */ at) => {
				let low = 0;
				let high = starts.length - 1;
				while (low < high) {
					const mid = (low + high + 1) >> 1;
					if (starts[mid] <= at) {
						low = mid;
					} else {
						high = mid - 1;
					}
				}
				return { node: nodes[low], offset: at - starts[low] };
			};
			for (let at = all.indexOf(wanted); at !== -1 && matches.length < 5000; at = all.indexOf(wanted, at + wanted.length)) {
				const start = locate(at);
				const end = locate(at + wanted.length - 1);
				const range = document.createRange();
				range.setStart(start.node, start.offset);
				range.setEnd(end.node, end.offset + 1);
				matches.push(range);
			}
		}
		if (matches.length && highlights) {
			// @ts-ignore
			highlights.set('orbit-find', new Highlight(...matches));
		}
		$('found').textContent = text.trim() ? (matches.length ? '' : '0') : '';
		if (matches.length && jump) {
			step(1);
		} else if (matches.length) {
			$('found').textContent = `${matches.length}`;
		}
	}

	function step(/** @type {number} */ by) {
		if (!matches.length) {
			return;
		}
		match = (match + by + matches.length) % matches.length;
		const range = matches[match];
		// @ts-ignore
		CSS.highlights?.set('orbit-find-current', new Highlight(range));
		$('found').textContent = `${match + 1} / ${matches.length}`;
		const box = range.getBoundingClientRect();
		const view = scroller.getBoundingClientRect();
		if (box.top < view.top + 40 || box.bottom > view.bottom - 40) {
			scroller.scrollTop += box.top - view.top - scroller.clientHeight / 3;
		}
	}

	// ------------------------------------------------------------------ controls

	$('prev').addEventListener('click', () => goTo(current - 1, true));
	$('next').addEventListener('click', () => goTo(current + 1, true));
	$('page').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter') {
			goTo(Number($('page').value) - 1);
			$('page').blur();
		}
	});
	$('zoom').addEventListener('change', () => {
		const value = $('zoom').value;
		setFit(value === 'auto' || value === 'width' || value === 'page' ? value : Number(value));
	});
	$('out').addEventListener('click', () => setFit(scale / 1.2));
	$('in').addEventListener('click', () => setFit(scale * 1.2));
	let typing = /** @type {any} */ (0);
	$('find').addEventListener('input', () => {
		clearTimeout(typing);
		typing = setTimeout(() => search($('find').value), 180);
	});
	$('find').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if ($('find').value !== query) {
				search($('find').value);
			} else {
				step(e.shiftKey ? -1 : 1);
			}
		} else if (e.key === 'Escape') {
			$('find').value = '';
			search('');
			$('find').blur();
		}
	});
	$('findPrev').addEventListener('click', () => step(-1));
	$('findNext').addEventListener('click', () => step(1));
	$('exact').addEventListener('click', () => {
		$('exact').disabled = true;
		$('exact').querySelector('span').textContent = 'Conversion…';
		vscode.postMessage({ type: 'exact' });
	});
	$('agent').addEventListener('click', () => vscode.postMessage({ type: 'agent', page: current + 1, text: String(window.getSelection() ?? '') }));
	$('external').addEventListener('click', () => vscode.postMessage({ type: 'external' }));
	scroller.addEventListener('scroll', track, { passive: true });
	scroller.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
		if (e.ctrlKey) {
			e.preventDefault();
			setFit(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
		}
	}, { passive: false });
	// Links: to the web through the system, inside the document by scrolling.
	$('doc').addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const link = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('a[href]') : null);
		if (!link) {
			return;
		}
		e.preventDefault();
		const href = link.getAttribute('href') ?? '';
		if (href.startsWith('#')) {
			document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
		} else {
			vscode.postMessage({ type: 'open', url: href });
		}
	});
	window.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			$('find').focus();
			$('find').select();
		} else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
			e.preventDefault();
			setFit(scale * 1.2);
		} else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
			e.preventDefault();
			setFit(scale / 1.2);
		} else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
			e.preventDefault();
			setFit('auto');
		}
	});
	let resizing = /** @type {any} */ (0);
	new ResizeObserver(() => {
		clearTimeout(resizing);
		resizing = setTimeout(() => typeof fit !== 'number' && pages.length && layout(), 60);
	}).observe(scroller);

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'reload') {
			open(msg.url, true);
		} else if (msg?.type === 'exactDone' || msg?.type === 'exactFailed') {
			$('exact').disabled = false;
			$('exact').querySelector('span').textContent = 'Rendu exact';
			if (msg.type === 'exactFailed') {
				status('La conversion a échoué : le document reste affiché tel que lu par Orbit.', true);
				setTimeout(() => status(''), 4000);
			}
		}
	});

	open(setup.url);
})();
