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

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="top">
			<div class="brand"><span class="page-logo">${icon('users')}</span><div><h1>Communauté</h1><p class="muted">Pars du projet de quelqu'un d'autre, ou partage le tien comme template.</p></div></div>
			<span class="spacer"></span>
			<nav class="tabs">
				<button data-tab="discover" class="on">Découvrir</button>
				<button data-tab="mine">Mes partages</button>
				<button data-tab="share" class="share">${icon('plus')} Partager mon projet</button>
			</nav>
		</header>
		<section id="tab-discover" class="tab">
			<div class="search"><input id="query" placeholder="Rechercher un template : react, jeu, portfolio, api…" spellcheck="false" /><span id="account" class="muted"></span></div>
			<div id="grid" class="grid"></div>
		</section>
		<section id="tab-share" class="tab" hidden>
			<div id="share" class="share-page"></div>
		</section>
		<div id="toast" class="toast" hidden></div>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	let login = '';
	let project = '';
	let mine = false;
	/** @type {any} */
	let draft;

	function toast(/** @type {string} */ text, error = false) {
		const t = $('toast');
		t.textContent = text;
		t.className = `toast${error ? ' error' : ''}`;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, error ? 7000 : 3500);
	}

	function setTab(/** @type {string} */ tab, refresh = false) {
		document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.getAttribute('data-tab') === tab));
		$('tab-discover').hidden = tab === 'share';
		$('tab-share').hidden = tab !== 'share';
		if (tab === 'share') {
			renderShareIntro();
		} else if (refresh || (tab === 'mine') !== mine) {
			mine = tab === 'mine';
			vscode.postMessage({ type: 'search', query: $('query').value, mine });
		}
	}

	const ago = (/** @type {string} */ iso) => {
		const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
		return days < 1 ? 'aujourd\'hui' : days < 30 ? `il y a ${days} j` : new Date(iso).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
	};

	function renderTemplates(/** @type {any[]} */ templates) {
		$('grid').innerHTML = templates.length ? templates.map(t => `
			<article class="card">
				<div class="cover"><img src="${escape(t.cover)}" alt="" loading="lazy" /><div class="fallback">${escape(t.title)}</div></div>
				<div class="body">
					<h3>${escape(t.title)}</h3>
					<p>${escape(t.description || 'Pas de description.')}</p>
				</div>
				<footer>
					<img class="avatar" src="${escape(t.avatar)}" alt="" />
					<span class="owner">${escape(t.owner)}</span>
					${t.language ? `<span class="tag">${escape(t.language)}</span>` : ''}
					<span class="muted small stars">${icon('star')} ${t.stars} · ${ago(t.updated)}</span>
					<span class="spacer"></span>
					<button class="ghost small" data-open="${escape(t.url)}">GitHub</button>
					<button class="primary small" data-use="${escape(t.repo)}" data-title="${escape(t.title)}">Utiliser</button>
				</footer>
			</article>`).join('') : `<div class="empty">
				<h2>${mine ? 'Tu n\'as encore rien partagé' : 'Aucun template pour l\'instant'}</h2>
				<p class="muted">${mine ? 'Partage un projet : il apparaîtra ici et chez tous les utilisateurs d\'Orbit.' : 'Sois le premier : partage un de tes projets comme template.'}</p>
				<button class="primary" data-tab-go="share">Partager mon projet</button></div>`;
		// A cover that does not load shows the title on a gradient instead.
		$('grid').querySelectorAll('.cover img').forEach((/** @type {HTMLImageElement} */ img) => {
			img.addEventListener('error', () => img.closest('.cover')?.classList.add('missing'));
		});
	}

	function renderShareIntro() {
		if (draft) {
			renderDraft();
			return;
		}
		$('share').innerHTML = !project
			? `<div class="empty"><h2>Ouvre d'abord le projet à partager</h2><p class="muted">Le partage concerne le dossier ouvert dans cette fenêtre.</p></div>`
			: !login
				? `<div class="empty"><h2>Connecte GitHub</h2><p class="muted">Les templates sont des dépôts GitHub publics. Dans un terminal : <code>gh auth login</code>, puis rouvre cette page.</p></div>`
				: `<div class="empty"><h2>Partager « ${escape(project)} »</h2>
					<p class="muted">Orbit prépare une copie publique de ton projet : il retire tout ce qui est privé (.env, clés, mots de passe, données des bases) et te montre exactement ce qui sera publié avant que tu confirmes.</p>
					<button class="primary" id="prepare">Préparer le partage</button></div>`;
		$('prepare')?.addEventListener('click', () => vscode.postMessage({ type: 'prepare' }));
	}

	const size = (/** @type {number} */ b) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`;

	function renderDraft() {
		const d = draft;
		$('share').innerHTML = `
			<div class="form">
				<div class="left">
					<div class="cover big ${d.cover ? '' : 'missing'}" id="coverBox">${d.cover ? `<img src="${d.cover}" alt="" />` : ''}<div class="fallback">${escape(d.title)}</div><div class="capturing" id="capturing" hidden>Capture de la page d'accueil…</div></div>
					<p class="muted small" id="coverSource">${d.coverSource ? `Image : ${escape(d.coverSource)}` : ''}</p>
					<div class="row"><button class="ghost small" id="capture">Capturer la page d'accueil</button><button class="ghost small" id="pickCover">Choisir une image…</button></div>
					<label>Titre<input id="title" value="${escape(d.title)}" /></label>
					<label>Description<textarea id="description" rows="5" placeholder="À quoi sert ce projet, comment le lancer…">${escape(d.description)}</textarea></label>
					<p class="muted small">Dépôt public : <b>github.com/${escape(d.login)}/<span id="repo">${escape(d.repoName)}</span></b></p>
				</div>
				<div class="right">
					<details open><summary class="ok">${icon('check')} Partagé : ${d.fileCount} fichiers · ${size(d.bytes)}</summary><ul class="files">${d.files.map((/** @type {string} */ f) => `<li>${escape(f)}</li>`).join('')}${d.fileCount > d.files.length ? `<li class="muted">… et ${d.fileCount - d.files.length} autres</li>` : ''}</ul></details>
					<details ${d.excluded.length ? 'open' : ''}><summary class="private">${icon('lock')} Reste privé : ${d.excluded.length} fichier${d.excluded.length > 1 ? 's' : ''}</summary><ul class="files">${d.excluded.map((/** @type {any} */ e) => `<li><span>${escape(e.file)}</span><i>${escape(e.reason)}</i></li>`).join('') || '<li class="muted">Rien à retirer.</li>'}</ul></details>
					${d.secrets.length ? `<div class="alert"><b>${d.secrets.length} secret${d.secrets.length > 1 ? 's' : ''} possible${d.secrets.length > 1 ? 's' : ''} détecté${d.secrets.length > 1 ? 's' : ''}</b> : ces fichiers sont exclus. Si tu veux les partager, retire d'abord le secret du code (variable d'environnement).<ul>${d.secrets.map((/** @type {any} */ s) => `<li>${escape(s.file)}:${s.line} — ${escape(s.kind)}</li>`).join('')}</ul></div>` : ''}
					${d.envExamples.length || d.schemas.length ? `<div class="note"><b>Créé pour les autres</b><ul>${d.envExamples.map((/** @type {string} */ e) => `<li><code>${escape(e.replace(/\.env(\.[^/]*)?$/i, '.env.example'))}</code> : les noms des variables, sans leurs valeurs</li>`).join('')}${d.schemas.map((/** @type {string} */ s) => `<li><code>database/${escape(s.split('/').pop().replace(/\.[^.]+$/, ''))}.schema.sql</code> : la structure de la base, sans ses données</li>`).join('')}</ul></div>` : ''}
					<label class="check"><input type="checkbox" id="checked" /> J'ai vérifié la liste : rien de privé ne sera publié.</label>
					<button class="primary big" id="publish" disabled>Publier publiquement</button>
				</div>
			</div>`;
		$('checked').addEventListener('change', () => { $('publish').disabled = !$('checked').checked; });
		$('capture').addEventListener('click', () => vscode.postMessage({ type: 'captureCover' }));
		$('pickCover').addEventListener('click', () => vscode.postMessage({ type: 'pickCover' }));
		$('description').addEventListener('input', () => { d.description = $('description').value; });
		$('title').addEventListener('input', () => {
			d.title = $('title').value;
			$('repo').textContent = $('title').value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'projet';
		});
		$('publish').addEventListener('click', () => vscode.postMessage({ type: 'publish', title: $('title').value, description: $('description').value }));
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const tab = target.closest('[data-tab]') || target.closest('[data-tab-go]');
		if (tab) {
			setTab(tab.getAttribute('data-tab') || tab.getAttribute('data-tab-go') || 'discover');
			return;
		}
		const use = target.closest('[data-use]');
		if (use) {
			vscode.postMessage({ type: 'use', repo: use.getAttribute('data-use'), title: use.getAttribute('data-title') });
			return;
		}
		const open = target.closest('[data-open]');
		if (open) {
			vscode.postMessage({ type: 'open', url: open.getAttribute('data-open') });
		}
	});
	let timer = 0;
	$('query').addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(() => vscode.postMessage({ type: 'search', query: $('query').value, mine }), 350);
	});

	window.addEventListener('message', e => {
		const msg = e.data;
		switch (msg?.type) {
			case 'tab':
				setTab(msg.tab);
				break;
			case 'account':
				login = msg.login || '';
				project = msg.project || '';
				$('account').textContent = login ? `Connecté à GitHub : ${login}` : 'GitHub non connecté : tu peux parcourir, pas partager';
				// The share tab may have opened before the account was known.
				if (!$('tab-share').hidden) {
					renderShareIntro();
				}
				break;
			case 'loading':
				$('grid').innerHTML = '<div class="empty muted">Chargement des templates…</div>';
				break;
			case 'templates':
				// A late answer for the other tab (all templates while on « Mes partages »…) is dropped.
				if (!!msg.mine !== mine) {
					break;
				}
				renderTemplates(msg.templates);
				break;
			case 'preparing':
				$('share').innerHTML = '<div class="empty"><h2>Préparation…</h2><p class="muted">Inventaire des fichiers, recherche de secrets, capture de la page d\'accueil.</p></div>';
				break;
			case 'draft':
				draft = msg;
				renderDraft();
				break;
			case 'capturing':
				if ($('capturing')) {
					$('capturing').hidden = false;
				}
				break;
			case 'cover': {
				if (!draft) {
					break;
				}
				draft.cover = msg.cover;
				draft.coverSource = msg.source;
				// Only the image changes: the title, description and checkbox keep what was typed.
				const box = $('coverBox');
				if (!box) {
					break;
				}
				let img = box.querySelector('img');
				if (!img) {
					img = document.createElement('img');
					img.alt = '';
					box.prepend(img);
				}
				img.src = msg.cover;
				box.classList.remove('missing');
				$('capturing').hidden = true;
				$('coverSource').textContent = msg.source ? `Image : ${msg.source}` : '';
				break;
			}
			case 'published':
				draft = undefined;
				toast('Publié dans la communauté');
				setTab('mine', true);
				break;
			case 'error':
				toast(msg.message, true);
				if ($('capturing')) {
					$('capturing').hidden = true;
				}
				if (!draft && !$('tab-share').hidden) {
					renderShareIntro();
				}
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
