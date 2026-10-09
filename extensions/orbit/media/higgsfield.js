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

	const KINDS = /** @type {{ id: string, label: string, icon: string, hint: string, formats: boolean }[]} */ ([
		{ id: 'image', label: 'Image', icon: 'camera', hint: 'Illustrations, icônes, textures, visuels de site', formats: true },
		{ id: 'video', label: 'Vidéo', icon: 'play', hint: 'Plans animés, intros, boucles de fond', formats: true },
		{ id: '3d', label: 'Modèle 3D', icon: 'cube', hint: 'Un objet ou un personnage en GLB, à partir d\'une image', formats: false },
		{ id: 'audio', label: 'Audio', icon: 'audio', hint: 'Voix off, musique, bruitages', formats: false },
	]);
	/** Starting points: what people generate most for a site, an app or a game. */
	const IDEAS = /** @type {Record<string, { label: string, style: string, prompt: string }[]>} */ ({
		image: [
			{ label: 'Icône d\'app', style: 'icône d\'application, carré arrondi, 3D brillant, lisible en petit, sans texte', prompt: 'Une icône d\'application pour ' },
			{ label: 'Image d\'accueil', style: 'visuel de page d\'accueil, lumière soignée, composition aérée pour poser un titre', prompt: 'Le visuel principal d\'un site de ' },
			{ label: 'Texture de jeu', style: 'texture répétable sans raccord, vue de face, éclairage neutre', prompt: 'Une texture de ' },
			{ label: 'Personnage', style: 'personnage en pied, fond uni, style jeu vidéo stylisé', prompt: 'Un personnage : ' },
			{ label: 'Photo produit', style: 'photo de produit en studio, fond doux, ombre portée légère', prompt: 'Une photo produit de ' },
		],
		video: [
			{ label: 'Fond animé', style: 'boucle lente et discrète, pour l\'arrière-plan d\'une page', prompt: 'Un fond animé : ' },
			{ label: 'Intro', style: 'plan d\'ouverture cinématographique, mouvement de caméra doux', prompt: 'Une intro de 5 secondes : ' },
			{ label: 'Animer une image', style: 'mouvement naturel à partir de l\'image de référence', prompt: 'Anime cette image : ' },
		],
		'3d': [
			{ label: 'Objet de jeu', style: 'objet isolé, prêt pour un moteur de jeu', prompt: 'Un objet 3D : ' },
			{ label: 'Personnage', style: 'personnage en pose neutre, prêt à être animé', prompt: 'Un personnage 3D : ' },
		],
		audio: [
			{ label: 'Voix off', style: 'voix claire et posée, en français', prompt: 'Une voix off qui dit : ' },
			{ label: 'Musique de fond', style: 'musique instrumentale discrète, en boucle', prompt: 'Une musique de fond ' },
			{ label: 'Bruitage', style: 'bruitage court et net', prompt: 'Un bruitage de ' },
		],
	});
	const FORMATS = ['16:9', '1:1', '9:16', '4:3'];

	const state = { kind: 'image', format: '16:9', count: 1, style: '', /** @type {any} */ data: undefined };

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="hnav">
			<div class="brand"><div class="mark" title="Higgsfield"></div><b>Higgsfield</b></div>
			<nav class="kinds" id="kinds">${KINDS.map(k => `<button data-kind="${k.id}" title="${escape(k.hint)}">${icon(k.icon)}<span>${k.label}</span></button>`).join('')}</nav>
			<span class="spacer"></span>
			<button id="status" class="status"></button>
			<button id="logout" class="leave" title="Se déconnecter de Higgsfield" hidden><svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13 8H6.5"/></svg></button>
			<button id="balance" class="credits" title="Solde de ton compte Higgsfield · cliquer pour actualiser">${icon('key')}<b id="creditsValue">—</b><span>crédits</span></button>
		</header>
		<div class="stage">
			<section class="onboard" id="onboard" hidden></section>
			<section class="gallery" id="gallery">
				<div class="pane-head"><span id="galleryTitle">Tes créations</span><span id="galleryCount" class="muted"></span></div>
				<div class="cards" id="cards"></div>
			</section>
			<section class="composer">
				<div class="ideas" id="ideas"></div>
				<div class="box">
					<div class="reference" id="reference"></div>
					<textarea id="prompt" rows="2" spellcheck="false" placeholder="Décris ce que tu veux…"></textarea>
				</div>
				<div class="options">
					<div class="seg" id="formats">${FORMATS.map(f => `<button data-format="${f}"><i class="shape s${f.replace(':', 'x')}"></i>${f}</button>`).join('')}</div>
					<div class="stepper" title="Nombre de propositions"><button id="less">−</button><b id="count">1</b><button id="more">+</button></div>
					<p class="where" id="where"></p>
					<button id="go" class="primary" title="Générer avec Claude (Ctrl+Entrée)"><span>Générer</span>${icon('sparkle')}</button>
				</div>
			</section>
		</div>
		<div id="toast" class="toast" hidden></div>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function toast(/** @type {string} */ text) {
		const t = $('toast');
		t.textContent = text;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, 3200);
	}

	function renderComposer() {
		const kind = KINDS.find(k => k.id === state.kind) ?? KINDS[0];
		document.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b.getAttribute('data-kind') === state.kind));
		document.querySelectorAll('[data-format]').forEach(b => b.classList.toggle('on', b.getAttribute('data-format') === state.format));
		$('formats').style.display = kind.formats ? '' : 'none';
		$('count').textContent = `${state.count}/4`;
		$('ideas').innerHTML = (IDEAS[state.kind] ?? []).map((idea, i) => `<button data-idea="${i}" class="${idea.style === state.style ? 'on' : ''}">${escape(idea.label)}</button>`).join('');
		$('prompt').placeholder = `${kind.hint}. Décris ce que tu veux…`;
		const data = state.data;
		$('where').textContent = data ? `Rangé dans ${data.folder}/ · ${data.project}` : '';
		const reference = data?.reference;
		$('reference').innerHTML = reference
			? `<div class="ref" title="Image de référence : ${escape(reference.name)}"><img src="${reference.uri}" alt="" /><button id="clearReference" class="x" title="Retirer">${icon('close')}</button></div>`
			: `<button id="pickReference" class="addref" title="Partir d'une image du projet">${icon('plus')}</button>`;
	}

	function renderStatus() {
		const connected = state.data?.connected;
		const working = state.data?.working;
		$('logout').hidden = connected !== true || !!working;
		const status = $('status');
		status.className = `status ${working ? 'wait' : connected === true ? 'on' : connected === false ? 'off' : 'wait'}`;
		status.innerHTML = working ? `<i></i>${escape(working)}` : connected === true ? `<i></i>Compte Higgsfield connecté` : connected === false ? `<i></i>${state.data?.off ? 'Higgsfield coupé dans Orbit' : 'Compte Higgsfield non connecté'}` : `<i></i>Vérification…`;
		status.title = connected === false ? 'Ajoute le connecteur Higgsfield à Claude Code' : 'Vérifier à nouveau';
	}

	function renderCredits() {
		const data = state.data;
		const button = $('balance');
		button.hidden = data?.connected !== true;
		button.classList.toggle('loading', !!data?.creditsLoading);
		const credits = data?.credits;
		$('creditsValue').textContent = credits ? String(Math.round(credits.value * 10) / 10).replace('.', ',') : data?.creditsLoading ? '…' : '—';
		button.classList.toggle('low', !!credits && credits.value < 5);
		button.title = `${credits?.plan ? `Abonnement ${credits.plan} · ` : ''}Solde de ton compte Higgsfield · cliquer pour actualiser`;
	}

	/** Someone who has never linked Higgsfield: three steps, each with its button. */
	function renderOnboard() {
		const data = state.data;
		const off = data?.connected === false;
		$('onboard').hidden = !off;
		$('gallery').hidden = off;
		document.querySelector('.composer')?.classList.toggle('locked', off);
		if (!off) {
			return;
		}
		if (data.off) {
			$('onboard').innerHTML = `
				<div class="welcome">
					<div class="logo"></div>
					<h2>Higgsfield est coupé dans Orbit</h2>
					<p>Tu t'es déconnecté ici : le studio est fermé et les agents lancés depuis n'ont plus les outils Higgsfield. Ton compte, lui, est toujours relié à ton compte claude.ai.</p>
				</div>
				<ol class="steps"><li class="now"><i>${icon('sparkle')}</i><div><b>Réactiver Higgsfield</b><span>Immédiat : aucune connexion à refaire.</span></div><button data-step="switchOn" class="step">Réactiver</button></li></ol>
				<p class="foot">Pour le retirer partout : <a href="https://claude.ai/settings/connectors">claude.ai, Réglages, Connecteurs</a></p>`;
			return;
		}
		const added = !!data.added;
		// @ts-ignore
		const who = window.OrbitAssistant?.id;
		$('onboard').innerHTML = `
			<div class="welcome">
				<div class="logo"></div>
				<h2>Connecte ton compte Higgsfield</h2>
				<p>Orbit passe par Claude Code pour générer : ton compte reste le tien, Orbit ne voit ni mot de passe ni clé. Deux étapes, une seule fois.</p>
				${data.simulated ? '<p class="sim">Mode test : Orbit fait comme si ton compte n\'était pas relié.</p>' : ''}
			</div>
			${data.working
				? `<ol class="steps"><li class="now"><i class="spin">${icon('refresh')}</i><div><b>${escape(data.working)}</b><span>Rien à taper : Orbit s'en occupe, cette page avance toute seule.</span></div></li></ol>`
				: `<ol class="steps">
				<li class="${added ? 'done' : 'now'}"><i>${added ? icon('check') : '1'}</i><div><b>Relier Higgsfield à ${who === 'chatgpt' ? 'ChatGPT' : 'Claude Code'}</b><span>Orbit l'ajoute pour toi, puis ouvre la page de connexion.</span></div><button data-step="connect" class="step" ${added ? 'disabled' : ''}>${added ? 'Fait' : 'Relier'}</button></li>
				<li class="${added ? 'now' : ''}"><i>2</i><div><b>Te connecter à ton compte</b><span>Une page Higgsfield s'ouvre dans le navigateur : valide la connexion.</span></div><button data-step="login" class="step" ${added ? '' : 'disabled'}>Me connecter</button></li>
			</ol>`}
			<p class="foot">Pas encore de compte ? <a href="https://higgsfield.ai">higgsfield.ai</a></p>`;
	}

	function media(/** @type {any} */ item) {
		if (item.kind === 'video') {
			return `<video src="${item.uri}" muted loop playsinline preload="metadata"></video><span class="badge">${icon('play')}</span>`;
		}
		if (item.kind === 'audio') {
			return `<div class="sound">${icon('audio')}<audio src="${item.uri}" controls preload="none"></audio></div>`;
		}
		if (item.kind === '3d') {
			return `<div class="solid">${icon('cube')}<span>Modèle 3D</span></div>`;
		}
		return `<img src="${item.uri}" alt="" loading="lazy" />`;
	}

	function renderGallery() {
		const data = state.data;
		if (!data) {
			return;
		}
		const pending = (data.pending ?? []).flatMap((/** @type {any} */ p) => Array.from({ length: Math.max(1, p.count) }, () => `<article class="card pending"><div class="shot"><div class="shimmer"></div><span class="working">${icon(KINDS.find(k => k.id === p.kind)?.icon ?? 'sparkle')}Claude génère…</span></div><div class="meta"><b>${escape(p.prompt.slice(0, 60))}</b></div></article>`));
		const cards = data.items.map((/** @type {any} */ item) => `<article class="card ${item.fresh ? 'fresh' : ''}" data-file="${escape(item.file)}">
				<div class="shot" data-action="open">${media(item)}</div>
				<div class="meta"><b title="${escape(item.name)}">${escape(item.name)}</b>${item.prompt ? `<span title="${escape(item.prompt)}">${escape(item.prompt)}</span>` : ''}</div>
				<div class="actions">
					<button data-action="use" title="Demander à Claude de l'utiliser dans le projet"><span class="claude-mark"></span></button>
					<button data-action="insert" title="Insérer le chemin dans le fichier ouvert">${icon('code')}</button>
					<button data-action="copy" title="Copier le chemin">${icon('link')}</button>
					${item.kind === 'image' ? `<button data-action="animate" title="Animer cette image en vidéo">${icon('play')}</button><button data-action="vary" title="Créer des variantes">${icon('rotate')}</button>` : ''}
					${item.kind === 'video' || item.kind === 'audio' || item.kind === 'image' ? `<button data-action="montage" title="Ouvrir dans StarCapture">${icon('star')}</button>` : ''}
					<button data-action="reveal" title="Montrer dans l'explorateur">${icon('search')}</button>
				</div>
			</article>`);
		$('galleryCount').textContent = data.items.length ? `· ${data.items.length}` : '';
		$('cards').innerHTML = [...pending, ...cards].join('') || `<div class="empty"><div class="big">${icon('sparkle')}</div><b>Qu'est-ce qu'on crée ?</b><span>Décris une image, une vidéo, un modèle 3D ou un son : Claude le génère avec ton compte Higgsfield et le fichier apparaît ici, prêt à servir dans ton code, ton montage ou ton jeu.</span></div>`;
	}

	function generate() {
		const prompt = $('prompt').value.trim();
		if (!prompt) {
			$('prompt').focus();
			return;
		}
		if (state.data?.connected === false) {
			toast('Connecte d\'abord ton compte Higgsfield (bouton en haut à droite).');
			return;
		}
		vscode.postMessage({ type: 'generate', request: { kind: state.kind, prompt, format: state.format, count: state.count, style: state.style } });
		$('prompt').value = '';
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const kind = target.closest('[data-kind]');
		if (kind) {
			state.kind = kind.getAttribute('data-kind') ?? 'image';
			state.style = '';
			renderComposer();
			return;
		}
		const format = target.closest('[data-format]');
		if (format) {
			state.format = format.getAttribute('data-format') ?? '16:9';
			renderComposer();
			return;
		}
		const idea = target.closest('[data-idea]');
		if (idea) {
			const chosen = IDEAS[state.kind][Number(idea.getAttribute('data-idea'))];
			state.style = state.style === chosen.style ? '' : chosen.style;
			if (state.style && !$('prompt').value.trim()) {
				$('prompt').value = chosen.prompt;
			}
			renderComposer();
			$('prompt').focus();
			return;
		}
		const action = target.closest('[data-action]');
		const card = target.closest('[data-file]');
		if (action && card) {
			vscode.postMessage({ type: 'action', action: action.getAttribute('data-action'), file: card.getAttribute('data-file') });
			return;
		}
		const step = target.closest('[data-step]');
		if (step) {
			vscode.postMessage({ type: step.getAttribute('data-step') });
			return;
		}
		if (target.closest('#pickReference')) {
			vscode.postMessage({ type: 'pickReference' });
		} else if (target.closest('#clearReference')) {
			vscode.postMessage({ type: 'clearReference' });
		} else if (target.closest('#logout')) {
			vscode.postMessage({ type: 'logout' });
		} else if (target.closest('#status')) {
			vscode.postMessage({ type: 'recheck' });
		} else if (target.closest('#balance')) {
			vscode.postMessage({ type: 'balance' });
		} else if (target.closest('#go')) {
			generate();
		} else if (target.closest('#less')) {
			state.count = Math.max(1, state.count - 1);
			renderComposer();
		} else if (target.closest('#more')) {
			state.count = Math.min(4, state.count + 1);
			renderComposer();
		}
	});
	$('prompt').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			generate();
		}
	});
	// Videos play while the pointer is over them.
	$('cards').addEventListener('mouseover', (/** @type {MouseEvent} */ e) => /** @type {HTMLElement} */ (e.target).closest('.card')?.querySelector('video')?.play().catch(() => { }));
	$('cards').addEventListener('mouseout', (/** @type {MouseEvent} */ e) => /** @type {HTMLElement} */ (e.target).closest('.card')?.querySelector('video')?.pause());

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'state') {
			state.data = msg;
			if (msg.kind) {
				state.kind = msg.kind;
			}
			renderStatus();
			renderCredits();
			renderOnboard();
			renderComposer();
			renderGallery();
		} else if (msg?.type === 'sent') {
			toast(`Envoyé à ${msg.terminal}`);
		} else if (msg?.type === 'toast') {
			toast(msg.text);
		}
	});

	renderStatus();
	renderCredits();
	renderComposer();
	vscode.postMessage({ type: 'ready' });
})();
