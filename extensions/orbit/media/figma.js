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

	const LOGO = '<svg viewBox="0 0 38 57" class="figma"><path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z"/><path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z"/><path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z"/><path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z"/><path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z"/></svg>';
	const KINDS = [['screen', 'Écran complet'], ['section', 'Section'], ['component', 'Composant']];

	/** @type {any} */
	let data;
	const view = { kind: 'screen', responsive: true };

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="bar"><div class="brand">${LOGO}<b>Figma vers code</b></div><span class="spacer"></span><button id="status" class="status"></button></header>
		<main>
			<section class="hero">
				<h1>Colle un lien Figma.<br/><span>Ton agent construit l'écran.</span></h1>
				<div class="field"><span class="glyph">${icon('link')}</span><input id="url" type="text" spellcheck="false" autocomplete="off" placeholder="https://www.figma.com/design/…?node-id=…" /><button id="go" class="primary">Construire</button></div>
				<p class="help">Dans Figma : sélectionne le cadre, clic droit, « Copy link to selection ».</p>
				<div class="options">
					<div class="seg" id="kinds"></div>
					<label class="check"><input type="checkbox" id="responsive" checked />Adapter au téléphone et au grand écran</label>
				</div>
				<textarea id="note" rows="2" placeholder="Précisions pour l'agent (facultatif) : où ranger le fichier, quelles données afficher…"></textarea>
				<div class="stack" id="stack"></div>
			</section>
			<section id="onboard" class="onboard" hidden></section>
			<section id="past" class="past"></section>
		</main>
		<div id="toast" class="toast" hidden></div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function toast(/** @type {string} */ text) {
		const t = $('toast');
		t.textContent = text;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, 3600);
	}

	function ago(/** @type {number} */ at) {
		const minutes = Math.round((Date.now() - at) / 60000);
		return minutes < 1 ? 'à l\'instant' : minutes < 60 ? `il y a ${minutes} min` : minutes < 1440 ? `il y a ${Math.round(minutes / 60)} h` : `il y a ${Math.round(minutes / 1440)} j`;
	}

	function render() {
		$('kinds').innerHTML = KINDS.map(k => `<button data-kind="${k[0]}" class="${view.kind === k[0] ? 'on' : ''}">${k[1]}</button>`).join('');
		if (!data) {
			return;
		}
		const status = $('status');
		status.className = `status ${data.working ? 'wait' : data.connected === true ? 'on' : data.connected === false ? 'off' : 'wait'}`;
		status.innerHTML = `<i></i>${data.working ? escape(data.working) : data.connected === true ? 'Figma connecté' : data.connected === false ? 'Figma non connecté' : 'Vérification…'}`;
		$('stack').innerHTML = data.stack.length ? `<span>Le code sera écrit avec ce que « ${escape(data.project)} » utilise :</span>${data.stack.map((/** @type {string} */ s) => `<i>${escape(s)}</i>`).join('')}` : `<span>L'agent regardera d'abord comment « ${escape(data.project)} » est construit.</span>`;
		const off = data.connected === false;
		$('onboard').hidden = !off;
		document.querySelector('.hero')?.classList.toggle('locked', off);
		if (off) {
			$('onboard').innerHTML = `<div>${LOGO}</div><div class="text"><b>Relie ton compte Figma</b><span>Ton agent lit la maquette avec le connecteur officiel de Figma : structure, styles, variables et capture du cadre. Orbit l'ajoute, puis une page Figma s'ouvre pour valider. Une seule fois.</span></div><button data-act="connect" class="primary" ${data.working ? 'disabled' : ''}>${data.working ? 'En cours…' : 'Relier Figma'}</button>`;
		}
		$('past').innerHTML = data.past.length ? `<h2>Maquettes déjà construites</h2>${data.past.map((/** @type {any} */ p) => `<a data-again="${escape(p.url)}"><span class="thumb">${LOGO}</span><b>${escape(p.name)}</b><em>${ago(p.at)}</em><button data-open="${escape(p.url)}" class="iconbtn" title="Ouvrir dans Figma">${icon('link')}</button></a>`).join('')}` : '';
	}

	function build() {
		const url = $('url').value.trim();
		if (!url) {
			$('url').focus();
			return;
		}
		if (data?.connected === false) {
			toast('Relie d\'abord ton compte Figma.');
			return;
		}
		vscode.postMessage({ type: 'build', url, kind: view.kind, responsive: $('responsive').checked, note: $('note').value });
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const attr = (/** @type {string} */ name) => target.closest(`[${name}]`)?.getAttribute(name);
		if (target.closest('[disabled]')) {
			return;
		}
		if (attr('data-kind')) {
			view.kind = String(attr('data-kind'));
			render();
		} else if (attr('data-open')) {
			vscode.postMessage({ type: 'open', url: attr('data-open') });
		} else if (attr('data-again')) {
			$('url').value = attr('data-again');
			$('url').focus();
		} else if (attr('data-act')) {
			vscode.postMessage({ type: attr('data-act') });
		} else if (target.closest('#go')) {
			build();
		} else if (target.closest('#status')) {
			vscode.postMessage({ type: 'recheck' });
		}
	});
	$('url').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => e.key === 'Enter' && build());
	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'state') {
			data = msg;
			render();
		} else if (msg?.type === 'sent') {
			$('url').value = '';
			$('note').value = '';
			toast('Envoyé à l\'agent : il lit la maquette.');
		} else if (msg?.type === 'toast') {
			toast(msg.text);
		}
	});
	render();
	vscode.postMessage({ type: 'ready' });
})();
