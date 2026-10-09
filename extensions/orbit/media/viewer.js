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
	const pdfjs = window.pdfjsLib;

	const escape = (/** @type {string} */ text) => String(text).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
	const svg = (/** @type {string} */ d) => `<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
	const I = {
		side: svg('M4 5h16v14H4zM9.5 5v14'),
		up: svg('m6 14 6-6 6 6'),
		down: svg('m6 10 6 6 6-6'),
		minus: svg('M6 12h12'),
		plus: svg('M12 6v12M6 12h12'),
		rotate: svg('M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5'),
		present: svg('M3 5h18v11H3zM12 16v4m-4 0h8'),
		out: svg('M14 4h6v6m0-6-9 9M10 6H5v13h13v-5'),
		close: svg('M6 6l12 12M18 6 6 18'),
		exact: svg('M12 3l2.4 5.6 5.6.9-4.3 3.9 1.2 5.8L12 16.3l-4.9 2.9 1.2-5.8L4 9.5l5.6-.9L12 3Z'),
	};
	/** A PDF's own unit is 1/72 inch; a screen's « 100 % » is 96 per inch. */
	const BASE = 96 / 72;
	const MAX_PIXELS = 16_000_000;
	const KEEP = 14;
	const pdfKind = () => mode === 'pdf';
	const unit = () => setup.kind === 'pptx' ? 'diapositive' : 'page';

	/** What is on screen: a PDF drawn by pdf.js, or slides drawn as elements. */
	let mode = setup.kind === 'pptx' ? 'slides' : 'pdf';
	/** @type {any} */
	let pdf;
	/** The presentation, read by PptxViewJS: it draws one slide at a time into a canvas. */
	/** @type {any} */
	let deck;
	let deckQueue = Promise.resolve();
	/** @type {{ index: number, el: HTMLElement, w: number, h: number, proxy?: any, task?: any, drawn?: number, text?: string }[]} */
	let pages = [];
	let scale = 1;
	/** @type {'width' | 'page' | number} */
	let fit = 'width';
	let rotation = 0;
	let current = 0;
	let query = '';
	/** @type {{ page: number, nth: number }[]} */
	let matches = [];
	let match = -1;
	let generation = 0;
	/** @type {Set<number>} */
	const visible = new Set();

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="bar">
			<button id="side" class="tool" title="Miniatures">${I.side}</button>
			<span class="sep"></span>
			<button id="prev" class="tool" title="Précédente">${I.up}</button>
			<button id="next" class="tool" title="Suivante">${I.down}</button>
			<span class="pager"><input id="page" type="text" inputmode="numeric" value="1" /><span id="count">/ …</span></span>
			<span class="sep"></span>
			<button id="out" class="tool" title="Réduire">${I.minus}</button>
			<select id="zoom" title="Taille d'affichage">
				<option value="width">Largeur</option><option value="page">Page entière</option>
				<option value="0.5">50 %</option><option value="0.75">75 %</option><option value="1">100 %</option><option value="1.25">125 %</option><option value="1.5">150 %</option><option value="2">200 %</option><option value="3">300 %</option><option value="4">400 %</option>
			</select>
			<button id="in" class="tool" title="Agrandir">${I.plus}</button>
			<button id="rotate" class="tool" title="Pivoter">${I.rotate}</button>
			<span class="spacer"></span>
			<div class="find"><span class="glass">${icon('search')}</span><input id="find" type="text" placeholder="Rechercher…" spellcheck="false" /><span id="found"></span><button id="findPrev" class="tool small" title="Résultat précédent">${I.up}</button><button id="findNext" class="tool small" title="Résultat suivant">${I.down}</button></div>
			<span class="sep"></span>
			<button id="exact" class="text" title="Convertit la présentation avec le logiciel installé sur cette machine, pour un rendu identique à l'original" hidden>${I.exact}<span>Rendu exact</span></button>
			<button id="present" class="text" title="Plein écran, une ${unit()} à la fois (F)">${I.present}<span>Présenter</span></button>
			<button id="agent" class="text accent" title="Envoyer ce document (et le texte sélectionné) à ${escape(setup.assistant)}"><span>Demander à ${escape(setup.assistant)}</span></button>
			<button id="external" class="tool" title="Ouvrir avec l'application du système">${I.out}</button>
		</header>
		<div class="body">
			<aside id="thumbs" class="thumbs" hidden></aside>
			<main id="scroller" class="scroller"><div id="status" class="status">${icon('refresh')}<span>Ouverture de ${escape(setup.name)}…</span></div><div id="sheets" class="sheets"></div></main>
		</div>
		<div id="show" class="show" hidden><div id="showSheet" class="showSheet"></div><div class="showBar"><button id="showPrev" class="tool">${I.up}</button><span id="showCount"></span><button id="showNext" class="tool">${I.down}</button><button id="showClose" class="tool" title="Quitter (Échap)">${I.close}</button></div></div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	const scroller = /** @type {HTMLElement} */ ($('scroller'));
	const sheets = /** @type {HTMLElement} */ ($('sheets'));

	function status(/** @type {string} */ text, failed = false) {
		$('status').hidden = !text;
		$('status').className = `status ${failed ? 'failed' : ''}`;
		$('status').innerHTML = `${failed ? '' : icon('refresh')}<span>${escape(text)}</span>`;
	}

	// ------------------------------------------------------------------ layout

	function fitScale() {
		const widest = Math.max(...pages.map(p => p.w), 1);
		const tallest = Math.max(...pages.map(p => p.h), 1);
		const byWidth = (scroller.clientWidth - 40) / widest;
		if (fit === 'width') {
			return byWidth;
		}
		if (fit === 'page') {
			return Math.min(byWidth, (scroller.clientHeight - 28) / tallest);
		}
		return fit;
	}

	/** Gives every sheet its size at the current scale, keeping the reader where they were. */
	function layout() {
		if (!pages.length) {
			return;
		}
		const anchor = pages[current]?.el;
		const before = anchor ? (scroller.scrollTop - anchor.offsetTop) / Math.max(1, anchor.offsetHeight) : 0;
		scale = Math.min(8, Math.max(0.1, fitScale()));
		for (const page of pages) {
			page.el.style.width = `${Math.round(page.w * scale)}px`;
			page.el.style.height = `${Math.round(page.h * scale)}px`;
		}
		if (anchor) {
			scroller.scrollTop = anchor.offsetTop + before * anchor.offsetHeight;
		}
		$('zoom').value = String(fit);
		if (typeof fit === 'number' && $('zoom').value !== String(fit)) {
			// A size reached with the wheel is not in the list: it is shown all the same.
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
		clearTimeout(layout.timer);
		layout.timer = setTimeout(() => visible.forEach(index => draw(pages[index])), 90);
	}
	layout.timer = /** @type {any} */ (0);

	function setFit(/** @type {'width' | 'page' | number} */ next) {
		fit = typeof next === 'number' ? Math.min(8, Math.max(0.1, next)) : next;
		layout();
	}

	function goTo(/** @type {number} */ index, smooth = false) {
		const page = pages[Math.min(pages.length - 1, Math.max(0, index))];
		if (page) {
			scroller.scrollTo({ top: page.el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
		}
	}

	function track() {
		const middle = scroller.scrollTop + scroller.clientHeight / 3;
		let found = 0;
		for (const page of pages) {
			if (page.el.offsetTop <= middle) {
				found = page.index;
			} else {
				break;
			}
		}
		if (found !== current || $('page').value !== String(current + 1)) {
			current = found;
			if (document.activeElement !== $('page')) {
				$('page').value = String(current + 1);
			}
			document.querySelectorAll('.thumb.on').forEach(t => t.classList.remove('on'));
			const thumb = document.querySelector(`.thumb[data-index="${current}"]`);
			thumb?.classList.add('on');
			if (!$('thumbs').hidden) {
				thumb?.scrollIntoView({ block: 'nearest' });
			}
		}
	}

	// ------------------------------------------------------------------ PDF

	/** Draws one slide into a canvas of the given size. The reader holds one « current slide »: drawings wait for their turn. */
	function drawSlide(/** @type {number} */ index, /** @type {number} */ width, /** @type {number} */ height) {
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(width);
		canvas.height = Math.round(height);
		const mine = generation;
		const turn = deckQueue.then(async () => {
			if (mine === generation) {
				await deck.renderSlide(index, canvas, { quality: 'high' });
			}
			return canvas;
		});
		deckQueue = turn.then(() => undefined, () => undefined);
		return turn;
	}

	async function draw(/** @type {typeof pages[0] | undefined} */ page) {
		if (!page) {
			return;
		}
		if (!pdfKind()) {
			const wanted = scale * 1000;
			if (!deck || page.drawn === wanted) {
				return;
			}
			page.drawn = wanted;
			const mine = generation;
			const ratio = Math.min((window.devicePixelRatio || 1) * scale, Math.sqrt(MAX_PIXELS / (page.w * page.h)));
			const canvas = await drawSlide(page.index, page.w * ratio, page.h * ratio).catch(() => undefined);
			if (canvas && mine === generation && page.drawn === wanted) {
				page.el.querySelectorAll('canvas').forEach(old => old.remove());
				page.el.prepend(canvas);
				page.el.classList.add('ready');
				release();
			}
			return;
		}
		if (!pdf) {
			return;
		}
		const wanted = scale * 1000 + rotation;
		if (page.drawn === wanted) {
			return;
		}
		page.drawn = wanted;
		const mine = generation;
		page.task?.cancel();
		const proxy = page.proxy ??= await pdf.getPage(page.index + 1);
		if (mine !== generation || page.drawn !== wanted) {
			return;
		}
		const viewport = proxy.getViewport({ scale: scale * BASE, rotation });
		const natural = proxy.getViewport({ scale: BASE, rotation });
		if (Math.abs(natural.width - page.w) > 1 || Math.abs(natural.height - page.h) > 1) {
			// The pages of a document are not always all the same size.
			page.w = natural.width;
			page.h = natural.height;
			page.el.style.width = `${Math.round(page.w * scale)}px`;
			page.el.style.height = `${Math.round(page.h * scale)}px`;
		}
		const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
		const canvas = document.createElement('canvas');
		canvas.width = Math.floor(viewport.width * ratio);
		canvas.height = Math.floor(viewport.height * ratio);
		const task = page.task = proxy.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
		try {
			await task.promise;
		} catch {
			return; // cancelled: a newer drawing is on its way
		}
		if (mine !== generation || page.drawn !== wanted) {
			return;
		}
		// The sharp picture replaces the stretched one only once it is ready: no blank flash while zooming.
		page.el.querySelectorAll('canvas').forEach(old => old.remove());
		page.el.prepend(canvas);
		page.el.classList.add('ready');
		const layer = /** @type {HTMLElement} */ (page.el.querySelector('.textLayer'));
		layer.textContent = '';
		layer.style.setProperty('--scale-factor', String(viewport.scale));
		const content = await proxy.getTextContent();
		if (mine !== generation || page.drawn !== wanted) {
			return;
		}
		page.text ??= content.items.map((/** @type {any} */ item) => item.str).join(' ');
		await pdfjs.renderTextLayer({ textContentSource: content, container: layer, viewport }).promise.catch(() => undefined);
		highlight(page);
		links(page, proxy, viewport);
		release();
	}

	/** Links of the page: web addresses open in the browser, internal ones jump inside the document. */
	async function links(/** @type {typeof pages[0]} */ page, /** @type {any} */ proxy, /** @type {any} */ viewport) {
		const layer = /** @type {HTMLElement} */ (page.el.querySelector('.linkLayer'));
		layer.textContent = '';
		const annotations = await proxy.getAnnotations().catch(() => []);
		for (const a of annotations) {
			if (a.subtype !== 'Link' || !a.rect || (!a.url && !a.dest)) {
				continue;
			}
			const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
			const link = document.createElement('a');
			link.style.left = `${Math.min(x1, x2)}px`;
			link.style.top = `${Math.min(y1, y2)}px`;
			link.style.width = `${Math.abs(x2 - x1)}px`;
			link.style.height = `${Math.abs(y2 - y1)}px`;
			link.title = a.url ?? 'Aller à cet endroit du document';
			link.addEventListener('click', async () => {
				if (a.url) {
					vscode.postMessage({ type: 'open', url: a.url });
					return;
				}
				try {
					const dest = typeof a.dest === 'string' ? await pdf.getDestination(a.dest) : a.dest;
					const target = dest && (typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : Number(dest[0]));
					if (Number.isInteger(target)) {
						goTo(target, true);
					}
				} catch {
					// a destination the document does not define
				}
			});
			layer.appendChild(link);
		}
	}

	/** Pages far from the screen give their picture back: a long document must not fill the memory. */
	function release() {
		const drawn = pages.filter(p => p.el.classList.contains('ready'));
		if (drawn.length <= KEEP) {
			return;
		}
		drawn.sort((a, b) => Math.abs(b.index - current) - Math.abs(a.index - current));
		for (const page of drawn.slice(0, drawn.length - KEEP)) {
			if (!visible.has(page.index)) {
				page.el.querySelectorAll('canvas').forEach(canvas => {
					canvas.width = 0;
					canvas.remove();
				});
				const layer = page.el.querySelector('.textLayer');
				if (layer) {
					layer.textContent = '';
				}
				page.el.classList.remove('ready');
				page.drawn = undefined;
			}
		}
	}

	const watcher = new IntersectionObserver(entries => {
		for (const entry of entries) {
			const index = Number(/** @type {HTMLElement} */ (entry.target).dataset.index);
			if (entry.isIntersecting) {
				visible.add(index);
				draw(pages[index]);
			} else {
				visible.delete(index);
			}
		}
	}, { root: scroller, rootMargin: '900px 0px' });

	const thumbWatcher = new IntersectionObserver(entries => {
		for (const entry of entries) {
			const el = /** @type {HTMLElement} */ (entry.target);
			if (entry.isIntersecting && !el.dataset.done) {
				el.dataset.done = '1';
				thumbnail(el, Number(el.dataset.index));
			}
		}
	}, { root: $('thumbs'), rootMargin: '400px 0px' });

	async function thumbnail(/** @type {HTMLElement} */ el, /** @type {number} */ index) {
		const page = pages[index];
		const box = /** @type {HTMLElement} */ (el.firstElementChild);
		if (!pdfKind()) {
			const ratio = (132 / page.w) * (window.devicePixelRatio || 1);
			box.style.height = `${132 * page.h / page.w}px`;
			const canvas = await drawSlide(index, page.w * ratio, page.h * ratio).catch(() => undefined);
			if (canvas) {
				box.replaceChildren(canvas);
			}
			return;
		}
		const proxy = page.proxy ??= await pdf.getPage(index + 1);
		const base = proxy.getViewport({ scale: 1, rotation });
		const viewport = proxy.getViewport({ scale: (132 / base.width) * (window.devicePixelRatio || 1), rotation });
		const canvas = document.createElement('canvas');
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		box.style.height = `${132 * base.height / base.width}px`;
		box.appendChild(canvas);
		await proxy.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise.catch(() => undefined);
	}

	function build() {
		sheets.textContent = '';
		$('thumbs').textContent = '';
		visible.clear();
		for (const page of pages) {
			const el = page.el;
			el.className = 'sheet';
			el.dataset.index = String(page.index);
			if (pdfKind()) {
				el.innerHTML = '<div class="textLayer"></div><div class="linkLayer"></div>';
			}
			sheets.appendChild(el);
			watcher.observe(el);
			const thumb = document.createElement('button');
			thumb.className = 'thumb';
			thumb.dataset.index = String(page.index);
			thumb.innerHTML = `<div class="mini"></div><span>${page.index + 1}</span>`;
			$('thumbs').appendChild(thumb);
			thumbWatcher.observe(thumb);
		}
		$('count').textContent = `/ ${pages.length}`;
		$('rotate').hidden = !pdfKind();
		current = Math.min(current, pages.length - 1);
		layout();
		track();
	}

	async function openPdf(/** @type {string} */ url, keepPlace = false) {
		const place = keepPlace ? scroller.scrollTop : 0;
		generation++;
		mode = 'pdf';
		if (!pdfjs.GlobalWorkerOptions.workerSrc) {
			// The worker is started from a copy held in memory: a page of Orbit may not start one from a file.
			const code = await (await fetch(setup.worker)).text();
			pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
		}
		const loading = pdfjs.getDocument({ url, cMapUrl: setup.cmaps, cMapPacked: true, standardFontDataUrl: setup.fonts, isEvalSupported: false });
		loading.onPassword = (/** @type {(password: string) => void} */ give) => {
			status('Ce document est protégé par un mot de passe : Orbit ne peut pas l\'ouvrir.', true);
			void give;
		};
		const opened = await loading.promise;
		pdf?.destroy();
		pdf = opened;
		const first = await pdf.getPage(1);
		const size = first.getViewport({ scale: BASE, rotation });
		pages = Array.from({ length: pdf.numPages }, (_, index) => ({ index, el: document.createElement('div'), w: size.width, h: size.height, proxy: index === 0 ? first : undefined }));
		status('');
		build();
		scroller.scrollTop = place;
		if (query) {
			search(query, false);
		}
	}

	// ------------------------------------------------------------------ slides

	/** Every piece of text of a slide, for the search. */
	function slideText(/** @type {any} */ slide) {
		const found = /** @type {string[]} */ ([]);
		const seen = new Set();
		const walk = (/** @type {any} */ node, /** @type {number} */ depth) => {
			if (!node || typeof node !== 'object' || depth > 9 || seen.has(node)) {
				return;
			}
			seen.add(node);
			for (const key of Object.keys(node)) {
				// The slide's own content only: its layout and master would repeat on every slide.
				if (/^(layout|master|parent|notes)$/i.test(key)) {
					continue;
				}
				const value = node[key];
				if (typeof value === 'string') {
					if (/^(text|t|content)$/i.test(key) && value.trim()) {
						found.push(value.trim());
					}
				} else {
					walk(value, depth + 1);
				}
			}
		};
		walk(slide, 0);
		return found.join(' ');
	}

	async function openSlides(/** @type {string} */ url, keepPlace = false) {
		const place = keepPlace ? scroller.scrollTop : 0;
		generation++;
		mode = 'slides';
		const buffer = await (await fetch(url)).arrayBuffer();
		// @ts-ignore
		const reader = new window.PptxViewJS.PPTXViewer({});
		await reader.loadFile(buffer);
		const count = reader.getSlideCount();
		if (!count) {
			throw new Error('aucune diapositive lisible');
		}
		deck?.destroy?.();
		deck = reader;
		// A slide is measured in EMU (914 400 per inch); a screen's « 100 % » is 96 pixels per inch.
		const size = reader.presentation?.slideSize ?? {};
		const w = size.cx > 0 ? size.cx / 9525 : 960;
		const h = size.cy > 0 ? size.cy / 9525 : 540;
		pages = Array.from({ length: count }, (_, index) => ({ index, el: document.createElement('div'), w, h, text: slideText(reader.presentation?.slides?.[index]) }));
		status('');
		build();
		scroller.scrollTop = place;
		if (query) {
			search(query, false);
		}
	}

	// ------------------------------------------------------------------ search

	function highlight(/** @type {typeof pages[0]} */ page) {
		const layer = page.el.querySelector('.textLayer');
		if (!layer || !query) {
			return;
		}
		const needle = query.toLowerCase();
		let nth = 0;
		for (const span of Array.from(layer.querySelectorAll('span'))) {
			const text = span.textContent ?? '';
			const lower = text.toLowerCase();
			let at = lower.indexOf(needle);
			if (at < 0 || span.querySelector('mark')) {
				continue;
			}
			let html = '';
			let from = 0;
			while (at >= 0) {
				const mine = matches[match]?.page === page.index && matches[match]?.nth === nth;
				html += `${escape(text.slice(from, at))}<mark class="${mine ? 'cur' : ''}">${escape(text.slice(at, at + needle.length))}</mark>`;
				from = at + needle.length;
				nth++;
				at = lower.indexOf(needle, from);
			}
			span.innerHTML = html + escape(text.slice(from));
		}
		page.el.querySelector('mark.cur')?.scrollIntoView({ block: 'center' });
	}

	async function search(/** @type {string} */ text, jump = true) {
		query = text.trim();
		matches = [];
		match = -1;
		// Earlier marks go with the text layers: visible pages are drawn again below.
		if (!query) {
			$('found').textContent = '';
			redraw();
			return;
		}
		$('found').textContent = '…';
		const mine = ++search.run;
		const needle = query.toLowerCase();
		for (const page of pages) {
			if (page.text === undefined && pdfKind()) {
				const proxy = page.proxy ??= await pdf.getPage(page.index + 1);
				page.text = (await proxy.getTextContent()).items.map((/** @type {any} */ item) => item.str).join(' ');
			}
			if (mine !== search.run) {
				return;
			}
			const lower = (page.text ?? '').toLowerCase();
			let nth = 0;
			for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
				matches.push({ page: page.index, nth: nth++ });
			}
		}
		if (jump && matches.length) {
			const from = matches.findIndex(m => m.page >= current);
			match = from >= 0 ? from : 0;
		}
		show();
	}
	search.run = 0;

	function redraw() {
		for (const page of pages) {
			if (page.el.classList.contains('ready') && pdfKind()) {
				page.drawn = undefined;
			}
		}
		visible.forEach(index => draw(pages[index]));
	}

	function show() {
		$('found').textContent = matches.length ? `${match + 1} / ${matches.length}` : query ? 'Aucun' : '';
		const found = matches[match];
		if (found) {
			goTo(found.page);
		}
		redraw();
	}

	function step(/** @type {number} */ by) {
		if (matches.length) {
			match = (match + by + matches.length) % matches.length;
			show();
		}
	}

	// ------------------------------------------------------------------ presenting

	let showing = -1;

	async function present(/** @type {number} */ index) {
		if (showing < 0) {
			vscode.postMessage({ type: 'present', on: true });
		}
		showing = Math.min(pages.length - 1, Math.max(0, index));
		const page = pages[showing];
		const box = /** @type {HTMLElement} */ ($('showSheet'));
		$('show').hidden = false;
		$('showCount').textContent = `${showing + 1} / ${pages.length}`;
		const ratio = Math.min(window.innerWidth / page.w, (window.innerHeight) / page.h);
		box.style.width = `${page.w * ratio}px`;
		box.style.height = `${page.h * ratio}px`;
		const dpr = window.devicePixelRatio || 1;
		if (!pdfKind()) {
			const shownSlide = showing;
			const canvas = await drawSlide(showing, page.w * ratio * dpr, page.h * ratio * dpr).catch(() => undefined);
			if (canvas && shownSlide === showing) {
				box.replaceChildren(canvas);
			}
			return;
		}
		const proxy = page.proxy ??= await pdf.getPage(showing + 1);
		const viewport = proxy.getViewport({ scale: ratio * BASE * dpr, rotation });
		const canvas = document.createElement('canvas');
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		const shown = showing;
		await proxy.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise.catch(() => undefined);
		if (shown === showing) {
			box.replaceChildren(canvas);
		}
	}

	function leave() {
		if (showing >= 0) {
			goTo(showing);
			showing = -1;
			vscode.postMessage({ type: 'present', on: false });
			$('show').hidden = true;
			$('showSheet').replaceChildren();
		}
	}

	// ------------------------------------------------------------------ controls

	$('side').addEventListener('click', () => {
		$('thumbs').hidden = !$('thumbs').hidden;
		$('side').classList.toggle('on', !$('thumbs').hidden);
		layout();
		track();
	});
	$('prev').addEventListener('click', () => goTo(current - 1));
	$('next').addEventListener('click', () => goTo(current + 1));
	$('page').addEventListener('change', () => goTo((parseInt($('page').value, 10) || 1) - 1));
	$('page').addEventListener('focus', () => $('page').select());
	$('out').addEventListener('click', () => setFit(scale / 1.2));
	$('in').addEventListener('click', () => setFit(scale * 1.2));
	$('zoom').addEventListener('change', () => setFit($('zoom').value === 'width' || $('zoom').value === 'page' ? $('zoom').value : Number($('zoom').value)));
	$('rotate').addEventListener('click', () => {
		rotation = (rotation + 90) % 360;
		for (const page of pages) {
			[page.w, page.h] = [page.h, page.w];
			page.drawn = undefined;
		}
		document.querySelectorAll('.thumb').forEach(t => {
			delete /** @type {HTMLElement} */ (t).dataset.done;
			/** @type {HTMLElement} */ (t.firstElementChild).replaceChildren();
			thumbWatcher.unobserve(t);
			thumbWatcher.observe(t);
		});
		layout();
	});
	$('thumbs').addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const thumb = /** @type {HTMLElement} */ (e.target).closest('.thumb');
		if (thumb) {
			goTo(Number(/** @type {HTMLElement} */ (thumb).dataset.index));
		}
	});
	$('find').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter') {
			$('find').value.trim() === query ? step(e.shiftKey ? -1 : 1) : search($('find').value);
		} else if (e.key === 'Escape') {
			$('find').value = '';
			search('');
			$('find').blur();
		}
	});
	$('findPrev').addEventListener('click', () => step(-1));
	$('findNext').addEventListener('click', () => step(1));
	$('present').addEventListener('click', () => present(current));
	$('showPrev').addEventListener('click', e => { e.stopPropagation(); present(showing - 1); });
	$('showNext').addEventListener('click', e => { e.stopPropagation(); present(showing + 1); });
	$('showClose').addEventListener('click', e => { e.stopPropagation(); leave(); });
	$('show').addEventListener('click', () => showing < pages.length - 1 ? present(showing + 1) : leave());
	$('agent').addEventListener('click', () => vscode.postMessage({ type: 'agent', page: current + 1, text: String(window.getSelection() ?? '') }));
	$('external').addEventListener('click', () => vscode.postMessage({ type: 'external' }));
	$('exact').addEventListener('click', () => {
		$('exact').disabled = true;
		$('exact').querySelector('span').textContent = 'Conversion…';
		vscode.postMessage({ type: 'exact' });
	});
	scroller.addEventListener('scroll', () => requestAnimationFrame(track), { passive: true });
	scroller.addEventListener('wheel', e => {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			setFit(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
		}
	}, { passive: false });
	window.addEventListener('resize', () => {
		if (typeof fit !== 'number') {
			layout();
		}
		if (showing >= 0) {
			present(showing);
		}
	});
	window.addEventListener('keydown', e => {
		const typing = /** @type {HTMLElement} */ (e.target).tagName === 'INPUT';
		if (showing >= 0) {
			if (e.key === 'Escape') {
				leave();
			} else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
				present(showing + 1);
			} else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
				present(showing - 1);
			}
			e.preventDefault();
			return;
		}
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
			setFit('width');
		} else if (!typing && e.key.toLowerCase() === 'f') {
			present(current);
		} else if (!typing && (e.key === 'ArrowRight' || e.key === 'PageDown')) {
			e.preventDefault();
			goTo(current + 1);
		} else if (!typing && (e.key === 'ArrowLeft' || e.key === 'PageUp')) {
			e.preventDefault();
			goTo(current - 1);
		} else if (!typing && e.key === 'Home') {
			goTo(0);
		} else if (!typing && e.key === 'End') {
			goTo(pages.length - 1);
		}
	});

	function fail(/** @type {unknown} */ err) {
		status(`Impossible d'afficher ${setup.name} : ${err instanceof Error ? err.message : String(err)}. Le bouton en haut à droite l'ouvre avec l'application de ton système.`, true);
	}

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'reload') {
			(setup.kind === 'pptx' && mode === 'slides' ? openSlides(msg.url, true) : setup.kind === 'pdf' ? openPdf(msg.url, true) : Promise.resolve()).catch(fail);
		} else if (msg?.type === 'exact') {
			openPdf(msg.url).then(() => { $('exact').hidden = true; }).catch(fail);
		} else if (msg?.type === 'exactFailed') {
			$('exact').disabled = false;
			$('exact').querySelector('span').textContent = 'Rendu exact';
			status('');
		}
	});

	$('exact').hidden = !setup.exact;
	(setup.kind === 'pptx' ? openSlides(setup.url) : openPdf(setup.url)).catch(fail);
})();
