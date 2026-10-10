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
	const mac = /Mac/.test(navigator.platform);

	const QUICK = ['Plus grand', 'Plus discret', 'Aux couleurs de la marque', 'Centrer', 'Ajouter une animation au survol', 'Rendre responsive', 'Supprimer'];
	const DEVICES = [{ id: 'desktop', label: 'Ordinateur' }, { id: 'tablet', label: 'Tablette' }, { id: 'mobile', label: 'Mobile' }];
	/**
	 * Real devices, drawn after their hardware: screen in CSS points (what the page sees),
	 * screen corner radius, bezels and front cutout. No brand artwork, only the shapes.
	 */
	const MODELS = /** @type {{ id: string, kind: string, name: string, w: number, h: number, r: number, bezel: number[], cut: string, tone: string }[]} */ ([
		{ id: 'iphone-16-pro', kind: 'mobile', name: 'iPhone 16 Pro', w: 402, h: 874, r: 62, bezel: [12, 12, 12], cut: 'island', tone: 'titanium' },
		{ id: 'iphone-16-pro-max', kind: 'mobile', name: 'iPhone 16 Pro Max', w: 440, h: 956, r: 64, bezel: [12, 12, 12], cut: 'island', tone: 'titanium' },
		{ id: 'iphone-16', kind: 'mobile', name: 'iPhone 16', w: 393, h: 852, r: 55, bezel: [14, 14, 14], cut: 'island', tone: 'aluminium' },
		{ id: 'iphone-se', kind: 'mobile', name: 'iPhone SE', w: 375, h: 667, r: 0, bezel: [96, 18, 96], cut: 'home', tone: 'aluminium' },
		{ id: 'galaxy-s25-ultra', kind: 'mobile', name: 'Galaxy S25 Ultra', w: 412, h: 891, r: 26, bezel: [10, 10, 10], cut: 'punch', tone: 'titanium' },
		{ id: 'galaxy-s25', kind: 'mobile', name: 'Galaxy S25', w: 360, h: 780, r: 46, bezel: [11, 11, 11], cut: 'punch', tone: 'graphite' },
		{ id: 'galaxy-a56', kind: 'mobile', name: 'Galaxy A56', w: 384, h: 832, r: 40, bezel: [14, 14, 16], cut: 'punch', tone: 'graphite' },
		{ id: 'pixel-9-pro', kind: 'mobile', name: 'Pixel 9 Pro', w: 410, h: 914, r: 52, bezel: [12, 12, 12], cut: 'punch', tone: 'graphite' },
		{ id: 'ipad-pro-13', kind: 'tablet', name: 'iPad Pro 13″', w: 1032, h: 1376, r: 30, bezel: [22, 22, 22], cut: 'dot', tone: 'aluminium' },
		{ id: 'ipad-air-11', kind: 'tablet', name: 'iPad Air 11″', w: 820, h: 1180, r: 28, bezel: [26, 26, 26], cut: 'dot', tone: 'aluminium' },
		{ id: 'ipad-mini', kind: 'tablet', name: 'iPad mini', w: 744, h: 1133, r: 30, bezel: [26, 26, 26], cut: 'dot', tone: 'aluminium' },
		{ id: 'ipad', kind: 'tablet', name: 'iPad 10,9″', w: 820, h: 1180, r: 26, bezel: [32, 32, 32], cut: 'dot', tone: 'aluminium' },
		{ id: 'galaxy-tab-s10-ultra', kind: 'tablet', name: 'Galaxy Tab S10 Ultra', w: 924, h: 1478, r: 22, bezel: [16, 16, 16], cut: 'notch', tone: 'graphite' },
		{ id: 'galaxy-tab-s10', kind: 'tablet', name: 'Galaxy Tab S10+', w: 876, h: 1400, r: 22, bezel: [20, 20, 20], cut: 'dot', tone: 'graphite' },
	]);
	const remembered = (() => {
		try {
			return JSON.parse(localStorage.getItem('orbit.preview.models') || '{}');
		} catch {
			return {};
		}
	})();
	/** Chosen model per kind, and orientation. */
	const choice = { mobile: remembered.mobile || 'iphone-16-pro', tablet: remembered.tablet || 'ipad-air-11', landscape: false };
	let device = DEVICES[0];
	let focused = false;

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="bar">
			<button class="icon" data-nav="back" title="Précédent">${icon('back')}</button>
			<button class="icon" data-nav="forward" title="Suivant">${icon('forward')}</button>
			<button class="icon" data-nav="reload" title="Recharger">${icon('refresh')}</button>
			<div class="address"><span class="dot"></span><input id="address" spellcheck="false" /></div>
			<div class="devices">${DEVICES.map(d => `<button data-device="${d.id}" class="${d.id === 'desktop' ? 'on' : ''}" title="${d.label}${d.width ? ` · ${d.width} px` : ''}">${icon(d.id)}</button>`).join('')}</div>
			<div class="models" id="models" hidden><select id="model" title="Modèle"></select><button class="icon" id="rotate" title="Pivoter">${icon('rotate')}</button></div>
			<button class="icon" id="focus" title="Voir en grand (F)">${icon('expand')}</button>
			<button id="errors" class="errors" title="Erreurs de la page" hidden>${icon('alert')}<b id="errorCount">0</b></button>
			<button id="select" class="select" title="Sélectionner un élément (S)"><span class="cursor"></span>Sélectionner</button>
			<button class="icon" id="pick" title="Changer de page ou de serveur">${icon('more')}</button>
		</header>
		<main class="stage" id="stage">
			<div class="backdrop" id="backdrop"></div>
			<div class="frame-wrap" id="wrap"><div class="shell" id="shell"><div class="screen" id="screen"><iframe id="frame" title="Vue vivante"></iframe><i class="cutout" id="cutout"></i></div><i class="home-button"></i></div><span class="size" id="size"></span><button class="modal-close" id="unfocus" title="Fermer (Échap)">${icon('close')}</button></div>
			<div class="hint" id="hint"><span>Clique <b>Sélectionner</b>, puis un élément de la page : Claude le modifie pour toi, ou tu sautes à son code.</span><button class="hint-close" id="hintClose" title="Ne plus afficher">${icon('close')}</button></div>
		</main>
		<section class="panel" id="panel" hidden>
			<div class="head">
				<span class="tag" id="tag"></span>
				<span class="comp" id="comp"></span>
				<button class="close" id="close" title="Fermer (Échap)">${icon('close')}</button>
			</div>
			<button class="where" id="where" title="Aller au code"><span class="pin">${icon('target')}</span><span id="whereText">Recherche du code…</span></button>
			<div class="chips">${QUICK.map(q => `<button class="chip">${q}</button>`).join('')}</div>
			<div class="ask">
				<textarea id="ask" rows="2" placeholder="Que veux-tu changer sur cet élément ?"></textarea>
				<div class="actions">
					<button id="code" class="ghost">Aller au code</button>
					<button id="send" class="primary"><span class="claude-mark light"></span> Envoyer à Claude <kbd>${mac ? '⌘⏎' : 'Ctrl+⏎'}</kbd></button>
				</div>
			</div>
			<div class="status" id="status"></div>
		</section>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	const frame = /** @type {HTMLIFrameElement} */ ($('frame'));
	let base = '';
	let selecting = false;
	/** @type {any} */
	let selected;

	const toFrame = (/** @type {any} */ msg) => frame.contentWindow?.postMessage({ source: 'orbit-preview', ...msg }, '*');

	function setSelecting(/** @type {boolean} */ value) {
		selecting = value;
		$('select').classList.toggle('on', value);
		toFrame({ type: 'mode', selecting: value });
	}

	function showPanel(/** @type {any} */ info) {
		selected = info;
		$('panel').hidden = false;
		$('hint').hidden = true;
		$('tag').textContent = `<${info.label}>`;
		$('comp').textContent = info.component ? `${info.component}${info.framework ? ` · ${info.framework}` : ''}` : (info.text ? `« ${info.text.slice(0, 48)}${info.text.length > 48 ? '…' : ''} »` : '');
		$('whereText').textContent = 'Recherche du code…';
		$('where').className = 'where';
		$('status').textContent = '';
		vscode.postMessage({ type: 'locate', info });
		setTimeout(() => $('ask').focus(), 0);
	}

	const modelOf = () => device.id === 'desktop' ? undefined : MODELS.find(m => m.id === choice[/** @type {'mobile' | 'tablet'} */ (device.id)]) ?? MODELS.find(m => m.kind === device.id);

	/**
	 * Lay out the chosen device: the page gets the model's exact screen size, and the whole
	 * device is scaled down (never up) to fit the space, in the page or in the large view.
	 */
	function sizeFrame() {
		const wrap = $('wrap');
		const shell = $('shell');
		const screen = $('screen');
		const model = modelOf();
		wrap.classList.toggle('device', !!model);
		$('models').hidden = !model;
		toFrame({ type: 'device', on: !!model });
		if (!model) {
			shell.removeAttribute('style');
			screen.removeAttribute('style');
			shell.className = 'shell';
			$('size').textContent = '';
			return;
		}
		const land = choice.landscape;
		const w = land ? model.h : model.w;
		const h = land ? model.w : model.h;
		const [top, side, bottom] = model.bezel;
		// Bezels follow the device when it turns: the thick ones of an iPhone SE go left and right.
		const pad = land ? [side, bottom, side, top] : [top, side, bottom, side];
		const outerW = w + pad[1] + pad[3];
		const outerH = h + pad[0] + pad[2];
		const room = wrap.getBoundingClientRect();
		const fit = Math.min(1, (room.width - 40) / outerW, (room.height - 56) / outerH);
		// A device placed on half a pixel, or scaled to a width that is not a whole number of
		// pixels, shows its page blurred: both are rounded.
		// Whole pixels of the screen, not of the page: Orbit's zoom makes the two differ.
		const dpr = window.devicePixelRatio || 1;
		const snap = (/** @type {number} */ n) => Math.round(n * dpr) / dpr;
		const scale = fit < 1 ? Math.max(1, Math.floor(outerW * fit * dpr)) / dpr / outerW : 1;
		shell.className = `shell ${model.kind} cut-${model.cut} tone-${model.tone}${land ? ' landscape' : ''}`;
		shell.style.width = `${outerW}px`;
		shell.style.height = `${outerH}px`;
		shell.style.padding = pad.map(p => `${p}px`).join(' ');
		shell.style.borderRadius = `${model.r ? model.r + Math.min(...model.bezel) : 46}px`;
		shell.style.left = `${snap((room.width - outerW * scale) / 2)}px`;
		shell.style.top = `${snap((room.height - outerH * scale) / 2 + 6)}px`;
		shell.style.transform = scale < 1 ? `scale(${scale})` : 'none';
		screen.style.width = `${w}px`;
		screen.style.height = `${h}px`;
		screen.style.borderRadius = `${model.r}px`;
		$('size').textContent = `${model.name} · ${w} × ${h}${scale < 1 ? ` · ${Math.round(scale * 100)} %` : ''}`;
	}

	function fillModels() {
		const model = modelOf();
		if (!model) {
			return;
		}
		const brands = [['Apple', 'apple', /^(iPhone|iPad)/], ['Samsung', 'samsung', /^Galaxy/], ['Google', 'google', /^Pixel/]];
		$('model').innerHTML = brands.map(([label, mark, test]) => {
			const list = MODELS.filter(m => m.kind === model.kind && /** @type {RegExp} */ (test).test(m.name));
			// The Samsung wordmark already says the name.
			return list.length ? `<optgroup label="${mark === 'samsung' ? '' : label}" data-icon="brand:${mark}">${list.map(m => `<option value="${m.id}" data-label="${escape(m.name)}" ${m.id === model.id ? 'selected' : ''}>${escape(m.name)} — ${m.w} × ${m.h}</option>`).join('')}</optgroup>` : '';
		}).join('');
	}

	new ResizeObserver(() => sizeFrame()).observe($('wrap'));

	/**
	 * The large view: the same frame (never reloaded) floats in the middle, over a blurred
	 * backdrop, with Orbit's editor area maximized around it. Escape or × brings it back.
	 */
	function setFocused(/** @type {boolean} */ value) {
		if (focused === value) {
			return;
		}
		focused = value;
		const wrap = $('wrap');
		wrap.classList.remove('opening', 'closing');
		if (value) {
			$('stage').classList.add('focus');
			sizeFrame();
			void wrap.offsetWidth;
			wrap.classList.add('opening');
			// Left in place, the animation keeps a transform on the frame, and a transformed
			// frame is no longer drawn on whole pixels: the page under it looks blurred.
			wrap.addEventListener('animationend', () => wrap.classList.remove('opening'), { once: true });
		} else {
			wrap.classList.add('closing');
			$('stage').classList.add('leaving');
			setTimeout(() => {
				wrap.classList.remove('closing');
				$('stage').classList.remove('focus', 'leaving');
				sizeFrame();
			}, 200);
		}
		$('focus').classList.toggle('on', value);
		vscode.postMessage({ type: 'focus', on: value });
	}

	// Runtime errors of the page (exceptions, rejected promises, console.error, failed requests).
	/** @type {{ kind: string, message: string, source?: string, line?: number, stack?: string, at: number }[]} */
	let pageErrors = [];
	const KINDS = /** @type {Record<string, string>} */ ({ error: 'Erreur', promise: 'Promesse rejetée', console: 'console.error', network: 'Réseau', resource: 'Ressource' });

	function renderErrors() {
		$('errors').hidden = !pageErrors.length;
		$('errorCount').textContent = String(pageErrors.length);
		if (!pageErrors.length) {
			document.getElementById('errorList')?.remove();
		} else if (document.getElementById('errorList')) {
			showErrors();
		}
	}

	function showErrors() {
		document.getElementById('errorList')?.remove();
		const list = document.createElement('section');
		list.id = 'errorList';
		list.className = 'error-list';
		list.innerHTML = `
			<div class="head"><b>${pageErrors.length} erreur${pageErrors.length > 1 ? 's' : ''} dans la page</b><span class="spacer"></span><button class="ghost" id="clearErrors">Effacer</button><button class="close" id="closeErrors" title="Fermer">${icon('close')}</button></div>
			<ul>${pageErrors.slice(-30).map(e => `<li><span class="kind ${e.kind}">${KINDS[e.kind] ?? e.kind}</span><span class="msg">${escape(e.message)}</span>${e.source ? `<span class="src">${escape(String(e.source).replace(/^https?:\/\/[^/]+/, ''))}${e.line ? `:${e.line}` : ''}</span>` : ''}</li>`).join('')}</ul>
			<div class="actions"><button id="sendErrors" class="primary"><span class="claude-mark light"></span> Faire corriger par Claude</button></div>`;
		document.body.appendChild(list);
		$('closeErrors').onclick = () => list.remove();
		$('clearErrors').onclick = () => {
			pageErrors = [];
			renderErrors();
		};
		$('sendErrors').onclick = () => {
			vscode.postMessage({ type: 'errors', errors: pageErrors.slice(-30), path: $('address').value });
			list.remove();
			pageErrors = [];
			renderErrors();
		};
	}

	function closePanel() {
		selected = undefined;
		$('panel').hidden = true;
		toFrame({ type: 'clear' });
	}

	function send() {
		const instruction = $('ask').value.trim();
		if (!selected || !instruction) {
			$('ask').focus();
			return;
		}
		vscode.postMessage({ type: 'ask', info: selected, instruction });
		$('ask').value = '';
		$('status').textContent = 'Envoi à Claude…';
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const nav = target.closest('[data-nav]');
		if (nav) {
			toFrame({ type: 'navigate', action: nav.getAttribute('data-nav') });
			if (nav.getAttribute('data-nav') === 'reload' && frame.src) {
				frame.src = frame.src; // also recovers a page that failed to load
			}
			return;
		}
		const button = target.closest('[data-device]');
		if (button) {
			device = DEVICES.find(x => x.id === button.getAttribute('data-device')) ?? DEVICES[0];
			document.querySelectorAll('[data-device]').forEach(b => b.classList.toggle('on', b === button));
			fillModels();
			sizeFrame();
			return;
		}
		if (target.closest('.chip')) {
			$('ask').value = target.textContent;
			send();
		}
	});
	$('select').addEventListener('click', () => setSelecting(!selecting));
	$('errors').addEventListener('click', () => document.getElementById('errorList') ? document.getElementById('errorList')?.remove() : showErrors());
	$('focus').addEventListener('click', () => setFocused(!focused));
	// The hint is for the first visits: once closed, it stays closed.
	try {
		if (localStorage.getItem('orbit.preview.hint') === 'off') {
			$('hint').hidden = true;
		}
	} catch {
		// storage unavailable: show it
	}
	$('hintClose').addEventListener('click', () => {
		$('hint').hidden = true;
		try {
			localStorage.setItem('orbit.preview.hint', 'off');
		} catch {
			// storage unavailable: hidden for this session
		}
	});
	$('model').addEventListener('change', () => {
		const model = MODELS.find(m => m.id === $('model').value);
		if (model) {
			choice[/** @type {'mobile' | 'tablet'} */ (model.kind)] = model.id;
			try {
				localStorage.setItem('orbit.preview.models', JSON.stringify({ mobile: choice.mobile, tablet: choice.tablet }));
			} catch {
				// storage unavailable: the choice lasts for this session
			}
			sizeFrame();
		}
	});
	$('rotate').addEventListener('click', () => {
		choice.landscape = !choice.landscape;
		$('rotate').classList.toggle('on', choice.landscape);
		sizeFrame();
	});
	$('unfocus').addEventListener('click', () => setFocused(false));
	$('backdrop').addEventListener('click', () => setFocused(false));
	$('pick').addEventListener('click', () => vscode.postMessage({ type: 'pick' }));
	$('close').addEventListener('click', closePanel);
	$('send').addEventListener('click', send);
	$('code').addEventListener('click', () => selected && vscode.postMessage({ type: 'code', info: selected }));
	$('where').addEventListener('click', () => selected && vscode.postMessage({ type: 'code', info: selected }));
	$('ask').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			send();
		}
	});
	$('address').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter' && base) {
			const value = $('address').value.trim();
			frame.src = `${base}${value.startsWith('/') ? value : `/${value}`}`;
		}
	});
	document.addEventListener('keydown', e => {
		const typing = /** @type {HTMLElement} */ (e.target).closest('textarea, input');
		if (e.key === 'Escape') {
			// One step back at a time: selection, then the element panel, then the large view.
			selecting ? setSelecting(false) : selected ? closePanel() : setFocused(false);
		} else if (!typing && e.key.toLowerCase() === 's') {
			setSelecting(!selecting);
		} else if (!typing && e.key.toLowerCase() === 'f') {
			setFocused(!focused);
		}
	});

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.source === 'orbit-inspector') {
			if (msg.type === 'ready') {
				// A fresh page: errors of the previous one no longer apply (those raised while it
				// was loading arrive just before `ready`, so keep the very recent ones).
				pageErrors = pageErrors.filter(e => Date.now() - e.at < 4000);
				renderErrors();
				try {
					const url = new URL(msg.url);
					$('address').value = `${url.pathname}${url.search}${url.hash}`;
				} catch {
					// keep the previous address
				}
				$('address').title = msg.title || '';
				if (selecting) {
					toFrame({ type: 'mode', selecting: true });
				}
				// A page that just loaded learns again that it is shown on a device.
				toFrame({ type: 'device', on: !!modelOf() });
			} else if (msg.type === 'selected') {
				showPanel(msg.info);
			} else if (msg.type === 'mode') {
				setSelecting(!!msg.selecting);
			} else if (msg.type === 'escape') {
				selected ? closePanel() : setFocused(false);
			} else if (msg.type === 'pageError') {
				pageErrors.push(msg.error);
				renderErrors();
			}
			return;
		}
		switch (msg?.type) {
			case 'load':
				base = msg.base;
				frame.src = msg.src;
				$('address').value = msg.src.slice(base.length) || '/';
				closePanel();
				break;
			case 'located':
				if (msg.location) {
					$('whereText').innerHTML = `${escape(msg.location.relative)}<b>:${msg.location.line}</b>${msg.location.confidence === 'probable' ? '<i>probable</i>' : ''}`;
					$('where').className = 'where found';
				} else {
					$('whereText').textContent = 'Code introuvable : Claude le retrouvera';
					$('where').className = 'where missing';
				}
				break;
			case 'sent':
				$('status').textContent = `Envoyé à ${msg.terminal} : la vue se mettra à jour dès que le code change.`;
				break;
		}
	});
})();
