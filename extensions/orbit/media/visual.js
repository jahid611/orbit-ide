/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { escape } = window.OrbitMarkdown;
	// @ts-ignore
	const { icon } = window.OrbitIcons;

	const EYE = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
	const MODES = [['auto', 'Automatique', 'L\'agent reçoit les captures et se corrige tout seul'], ['notify', 'Me demander', 'Orbit te prévient, tu décides'], ['off', 'Coupée', 'Aucune capture']];

	/** @type {any} */
	let data;
	let split = 50;
	let layout = 'slider';
	let drawn = '';

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `<header class="top" id="top"></header><main id="main"></main>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function ago(/** @type {number} */ at) {
		const minutes = Math.round((Date.now() - at) / 60000);
		return minutes < 1 ? 'à l\'instant' : minutes < 60 ? `il y a ${minutes} min` : `il y a ${Math.round(minutes / 60)} h`;
	}

	function render() {
		if (!data) {
			return;
		}
		const pair = data.pair;
		$('top').innerHTML = `
			<div class="mark">${EYE}</div>
			<div class="titles"><h1>Relecture visuelle</h1><p>${pair ? `${escape(pair.url)} · ${ago(pair.at)}${pair.agent ? ` · ${escape(pair.agent)}` : ''}` : 'L\'agent regarde la page qu\'il vient de modifier, avant et après'}</p></div>
			<span class="spacer"></span>
			<div class="seg" title="Quand un agent a modifié l'interface">${MODES.map(m => `<button data-mode="${m[0]}" class="${data.mode === m[0] ? 'on' : ''}" title="${m[2]}">${m[1]}</button>`).join('')}</div>
			<button data-act="now" class="btn">${icon('camera')}Capturer maintenant</button>
			<button data-act="tell" class="btn accent" ${pair?.after ? '' : 'disabled'}><span class="claude-mark"></span>Faire relire par l'agent</button>`;
		const html = !pair?.after
			? `<div class="empty"><div class="big">${EYE}</div><b>Rien à comparer pour l'instant</b><span>Lance le serveur de développement du projet. Dès qu'un agent modifie l'interface, Orbit photographie la page avant et après, et les deux images arrivent ici — et chez l'agent, qui vérifie son propre travail.</span><button data-act="now" class="btn accent">${icon('camera')}Capturer la page maintenant</button></div>`
			: !pair.before
				? `<div class="single"><figure><figcaption>Maintenant</figcaption><img src="${pair.after}" alt="" /></figure></div>`
				: `<div class="tools"><div class="seg">${[['slider', 'Curseur'], ['side', 'Côte à côte']].map(l => `<button data-layout="${l[0]}" class="${layout === l[0] ? 'on' : ''}">${l[1]}</button>`).join('')}</div><button data-act="open" class="btn small">Ouvrir la vue vivante</button></div>
					${layout === 'side'
						? `<div class="side"><figure><figcaption>Avant</figcaption><img src="${pair.before}" alt="" /></figure><figure><figcaption class="after">Après</figcaption><img src="${pair.after}" alt="" /></figure></div>`
						: `<div class="compare" id="compare"><img src="${pair.after}" alt="" draggable="false" /><div class="clip" id="clip"><img src="${pair.before}" alt="" draggable="false" /></div><span class="tag left">Avant</span><span class="tag right">Après</span><div class="handle" id="handle"><i></i></div></div>`}`;
		if (drawn !== html) {
			drawn = html;
			$('main').innerHTML = html;
		}
		place();
	}

	function place() {
		const clip = $('clip');
		if (clip) {
			clip.style.width = `${split}%`;
			const image = /** @type {HTMLElement} */ (clip.firstElementChild);
			image.style.width = `${$('compare').clientWidth}px`;
			$('handle').style.left = `${split}%`;
		}
	}

	let dragging = false;
	const move = (/** @type {MouseEvent} */ e) => {
		const box = $('compare')?.getBoundingClientRect();
		if (box) {
			split = Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100));
			place();
		}
	};
	document.addEventListener('mousedown', e => {
		if (/** @type {HTMLElement} */ (e.target).closest('#compare')) {
			dragging = true;
			move(e);
			e.preventDefault();
		}
	});
	document.addEventListener('mousemove', e => dragging && move(e));
	document.addEventListener('mouseup', () => { dragging = false; });
	window.addEventListener('resize', place);

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const mode = target.closest('[data-mode]');
		const look = target.closest('[data-layout]');
		const act = target.closest('[data-act]');
		if (mode) {
			vscode.postMessage({ type: 'mode', mode: mode.getAttribute('data-mode') });
		} else if (look) {
			layout = String(look.getAttribute('data-layout'));
			render();
		} else if (act && !act.hasAttribute('disabled')) {
			vscode.postMessage({ type: act.getAttribute('data-act') });
		}
	});
	window.addEventListener('message', e => {
		if (e.data?.type === 'state') {
			data = e.data;
			render();
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
