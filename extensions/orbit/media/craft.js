/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// A Crafting App shown inside Orbit. First the pictures of its window (two or three a second);
// then, as soon as the mouse rests here, the real window laid over this page. See `craftView.ts`.
(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { icon } = window.OrbitIcons;

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="bar">
			<span class="mark" id="mark"></span>
			<b id="name"></b>
			<span class="live" id="live"><i></i>en direct</span>
			<span class="note" id="note"></span>
			<span class="grow"></span>
			<button class="btn" id="open">${icon('plus')}Ouvrir une image</button>
			<button class="btn" id="out" title="Sortir l'application d'Orbit, dans une fenêtre à elle">${icon('expand')}Sa propre fenêtre</button>
		</header>
		<main id="stage" tabindex="0"><img id="frame" alt="" draggable="false" /><div class="wait" id="wait"></div></main>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	const stage = $('stage');
	const frame = /** @type {HTMLImageElement} */ ($('frame'));
	/** The size of the application's window, in its own points: what a click is measured in. */
	let window_ = { width: 0, height: 0 };
	let state = 'idle';
	/** Whether the application's real window is laid over this page. */
	let docked = false;
	const NOTE = 'Pose la souris sur l\'image : la vraie fenêtre vient se placer ici, à pleine vitesse. Tes agents agissent dessus.';
	const NOTE_DOCKED = 'C\'est la vraie fenêtre de l\'application. Tes agents agissent dessus.';

	function draw(/** @type {any} */ data) {
		state = data.state;
		$('name').textContent = data.name;
		$('mark').innerHTML = data.icon ? `<img src="${data.icon}" alt="" />` : '';
		$('live').hidden = state !== 'live';
		$('note').textContent = state === 'live' ? (docked ? NOTE_DOCKED : NOTE) : '';
		$('open').hidden = state !== 'live';
		$('out').hidden = state !== 'live';
		frame.hidden = state !== 'live';
		const wait = $('wait');
		wait.hidden = state === 'live';
		wait.innerHTML = state === 'starting' || state === 'idle' ? `<div class="spin"></div><p>${data.name} démarre…</p>`
			: state === 'out' ? `<p>${data.name} est dans sa propre fenêtre.</p><p class="dim">Tes agents continuent d'agir dessus.</p><button class="btn primary" id="in">Le ramener dans Orbit</button>`
				: `<p>${data.problem || `${data.name} n'est pas disponible.`}</p><button class="btn" id="retry">Réessayer</button>`;
	}

	/** The application's window takes the size of this page, so the picture is shown point for point. */
	let sizing;
	function size() {
		clearTimeout(sizing);
		sizing = setTimeout(() => vscode.postMessage({ type: 'size', width: stage.clientWidth, height: stage.clientHeight }), 250);
	}
	new ResizeObserver(size).observe(stage);

	const at = (/** @type {MouseEvent} */ e) => {
		const box = frame.getBoundingClientRect();
		return { x: Math.round((e.clientX - box.left) * (window_.width || box.width) / box.width), y: Math.round((e.clientY - box.top) * (window_.height || box.height) / box.height) };
	};
	frame.addEventListener('click', e => { stage.focus(); vscode.postMessage({ type: 'click', ...at(e), count: e.detail >= 2 ? 2 : 1 }); });
	frame.addEventListener('contextmenu', e => { e.preventDefault(); vscode.postMessage({ type: 'click', ...at(e), button: 'right' }); });
	// The pointer is followed at the pace the pictures come, not at every pixel.
	let moved = 0;
	let resting;
	frame.addEventListener('mousemove', e => {
		if (Date.now() - moved > 250) {
			moved = Date.now();
			vscode.postMessage({ type: 'move', ...at(e) });
		}
		// Resting on the picture calls the real window: Orbit lays it over this page, measured
		// from where the pointer is (in real pixels of the screen, hence the pixel ratio).
		clearTimeout(resting);
		if (!docked && state === 'live') {
			resting = setTimeout(() => {
				const box = stage.getBoundingClientRect();
				const ratio = window.devicePixelRatio || 1;
				vscode.postMessage({ type: 'anchor', dx: (e.clientX - box.left) * ratio, dy: (e.clientY - box.top) * ratio, width: box.width * ratio, height: box.height * ratio });
			}, 140);
		}
	});
	frame.addEventListener('mouseleave', () => clearTimeout(resting));
	const KEYS = ['Enter', 'Escape', 'Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Space'];
	stage.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (state !== 'live') {
			return;
		}
		const key = e.key === ' ' ? 'Space' : e.key;
		const chord = e.ctrlKey || e.altKey || e.metaKey;
		if (key.length === 1 && !chord) {
			vscode.postMessage({ type: 'text', text: e.key });
		} else if (KEYS.includes(key) || (key.length === 1 && chord)) {
			vscode.postMessage({ type: 'key', key: key.length === 1 ? key.toUpperCase() : key, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey });
		} else {
			return;
		}
		e.preventDefault();
	});

	document.addEventListener('click', e => {
		const id = /** @type {HTMLElement} */ (e.target).closest('button')?.id;
		if (id === 'open' || id === 'out' || id === 'in' || id === 'retry') {
			vscode.postMessage({ type: id });
		}
	});

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'state') {
			draw(msg);
			size();
		} else if (msg?.type === 'docked') {
			docked = !!msg.on;
			$('note').textContent = state === 'live' ? (docked ? NOTE_DOCKED : NOTE) : '';
		} else if (msg?.type === 'frame') {
			window_ = { width: msg.width, height: msg.height };
			frame.src = `data:image/png;base64,${msg.picture}`;
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
