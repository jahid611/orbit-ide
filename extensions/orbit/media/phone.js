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

	const STORES = {
		ios: 'https://apps.apple.com/app/ntfy/id1625396347',
		android: 'https://play.google.com/store/apps/details?id=io.heckel.ntfy',
	};

	/** @type {any} */
	let data;
	let tested = '';

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="hero">
			<div class="mark">${icon('mobile')}</div>
			<div class="titles"><h1>Orbit sur ton téléphone</h1><p>Sois prévenu quand un agent attend ton accord, quand un long travail est fini, et à la fin de la file de nuit.</p></div>
			<span class="spacer"></span>
			<span id="status" class="status"></span>
		</header>
		<main id="main"></main>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	/** The code to scan: the link, drawn as crisp squares. */
	function code(/** @type {string} */ text) {
		// @ts-ignore
		const qr = qrcode(0, 'M');
		qr.addData(text);
		qr.make();
		const n = qr.getModuleCount();
		let path = '';
		for (let y = 0; y < n; y++) {
			for (let x = 0; x < n; x++) {
				if (qr.isDark(y, x)) {
					path += `M${x} ${y}h1v1h-1z`;
				}
			}
		}
		return `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${path}" fill="#0a0918"/></svg>`;
	}

	function render() {
		if (!data) {
			return;
		}
		$('status').className = `status ${data.paired ? 'on' : ''}`;
		$('status').innerHTML = `<i></i>${data.paired ? 'Téléphone relié' : 'Pas encore relié'}`;
		const toggles = `
			<div class="toggles">
				<label><input type="checkbox" data-toggle="waiting" ${data.waiting ? 'checked' : ''}/><span><b>Un agent attend ton accord</b>Tu réponds, il repart.</span></label>
				<label><input type="checkbox" data-toggle="done" ${data.done ? 'checked' : ''}/><span><b>Un long travail est terminé</b>Seulement quand tu n'es pas devant Orbit.</span></label>
				<label><input type="checkbox" data-toggle="queue" ${data.queue ? 'checked' : ''}/><span><b>La file de nuit est finie</b>Avec le nombre de tâches réussies.</span></label>
			</div>`;
		$('main').innerHTML = data.paired ? `
			<section class="linked">
				<div class="done-mark">${icon('check')}</div>
				<h2>Ton téléphone est relié</h2>
				<p>Choisis ce qui mérite de faire vibrer ta poche.</p>
				${toggles}
				<div class="row">
					<button data-act="test" class="primary">${icon('send')}<span>Envoyer un test</span></button>
					<button data-act="renew" class="ghost">Relier un autre téléphone</button>
					<button data-act="disable" class="ghost danger">Désactiver</button>
				</div>
				<p class="note" id="note">${tested === 'sent' ? 'Notification envoyée.' : tested === 'failed' ? 'L\'envoi a échoué : vérifie la connexion internet.' : ''}</p>
			</section>` : `
			<section class="pair">
				<ol class="steps">
					<li><i>1</i><div><b>Installe l'application ntfy</b><span>Gratuite, sans compte. C'est elle qui affiche les notifications d'Orbit.</span>
						<div class="stores"><button data-open="${STORES.ios}">${window.OrbitIcons.brand ? window.OrbitIcons.brand('apple') : ''}<span>App Store</span></button><button data-open="${STORES.android}">${window.OrbitIcons.brand ? window.OrbitIcons.brand('google') : ''}<span>Google Play</span></button></div></div></li>
					<li><i>2</i><div><b>Scanne le code avec l'appareil photo</b><span>Le lien s'ouvre dans ntfy : appuie sur « S'abonner ».</span></div></li>
					<li><i>3</i><div><b>Vérifie</b><span>Orbit envoie une notification d'essai sur ton téléphone.</span>
						<div class="stores"><button data-act="test" class="primary small">${icon('send')}<span>Envoyer un test</span></button>${tested === 'sent' ? `<button data-act="confirm" class="confirm">${icon('check')}<span>Je l'ai reçue</span></button>` : ''}</div>
						<p class="note">${tested === 'sent' ? 'Envoyée. Si rien n\'arrive, vérifie que tu t\'es bien abonné dans ntfy.' : tested === 'failed' ? 'L\'envoi a échoué : vérifie la connexion internet.' : ''}</p></div></li>
				</ol>
				<div class="card">
					${data.link ? code(data.link) : ''}
					<div class="link"><code>${escape(data.link)}</code><button data-copy="${escape(data.link)}" title="Copier le lien">${icon('link')}</button></div>
					<p>Ce lien est privé : qui le connaît peut lire tes notifications. Orbit n'y envoie que de courtes lignes d'état, jamais ton code.</p>
				</div>
			</section>`;
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const open = target.closest('[data-open]');
		const copy = target.closest('[data-copy]');
		const act = target.closest('[data-act]');
		if (open) {
			vscode.postMessage({ type: 'open', url: open.getAttribute('data-open') });
		} else if (copy) {
			vscode.postMessage({ type: 'copy', text: copy.getAttribute('data-copy') });
		} else if (act) {
			vscode.postMessage({ type: act.getAttribute('data-act') });
		}
	});
	document.addEventListener('change', e => {
		const box = /** @type {HTMLInputElement} */ (e.target);
		const key = box.getAttribute?.('data-toggle');
		if (key) {
			vscode.postMessage({ type: 'toggle', key, value: box.checked });
		}
	});
	window.addEventListener('message', e => {
		if (e.data?.type === 'state') {
			data = e.data;
			if (e.data.tested) {
				tested = e.data.tested;
			}
			render();
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
