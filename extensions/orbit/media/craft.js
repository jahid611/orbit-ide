/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// A Crafting App shown inside Orbit. Orbit holds the application's real window over this page.
// The page's part is to be found: its stage is one plain colour, with a small mark in two
// corners. A helper looks at what Orbit draws, lays the window between the marks, and takes
// it off as soon as anything else than that colour shows there. So nothing may be drawn on
// the stage while the application is on: every word goes in the bar above. See `craftView.ts`.
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
			<button class="btn" id="open">${icon('plus')}Ouvrir un fichier</button>
			<button class="btn" id="out" title="Sortir l'application d'Orbit, dans une fenêtre à elle">${icon('expand')}Sa propre fenêtre</button>
		</header>
		<main id="stage"><i class="corner first" id="first"></i><i class="corner second" id="second"></i><div class="wait" id="wait"></div></main>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	let state = 'idle';
	let seen = false;

	function note(/** @type {boolean} */ shown) {
		seen = state === 'live' && (seen || shown);
		$('note').textContent = state !== 'live' ? '' : shown ? 'Tes agents agissent sur cette même fenêtre.' : seen ? 'En retrait, le temps de ce qu\'Orbit affiche par-dessus.' : 'Mise en place de la fenêtre…';
	}

	function draw(/** @type {any} */ data) {
		state = data.state;
		$('name').textContent = data.name;
		$('mark').innerHTML = data.icon ? `<img src="${data.icon}" alt="" />` : '';
		$('live').hidden = state !== 'live';
		$('open').hidden = state !== 'live' || !data.opens;
		$('out').hidden = state !== 'live';
		// Painted only while the application is on: the window must not be laid over a message.
		const on = state === 'live';
		$('stage').style.background = on ? data.plain : '';
		$('first').style.background = data.marks?.[0] ?? '';
		$('second').style.background = data.marks?.[1] ?? '';
		$('first').hidden = $('second').hidden = !on;
		note(!!data.shown);
		const wait = $('wait');
		wait.hidden = on;
		wait.innerHTML = state === 'starting' || state === 'idle' ? `<div class="spin"></div><p>${data.name} démarre…</p>`
			: state === 'out' ? `<p>${data.name} est dans sa propre fenêtre.</p><p class="dim">Tes agents continuent d'agir dessus.</p><button class="btn primary" id="in">Le ramener dans Orbit</button>`
				: `<p>${data.problem || `${data.name} n'est pas disponible.`}</p><button class="btn primary" id="retry">Rouvrir ${data.name}</button>`;
	}

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
		} else if (msg?.type === 'shown') {
			note(!!msg.on);
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
