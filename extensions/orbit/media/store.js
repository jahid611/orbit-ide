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

	const BAG = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 8h14l-1 12H6L5 8Zm4 0V6.5a3 3 0 0 1 6 0V8"/></svg>';
	const TABS = [['connectors', 'Connecteurs'], ['recipes', 'Recettes'], ['community', 'Communauté']];

	/** @type {any} */
	let data;
	const view = { tab: 'connectors', query: '', asked: false };
	let drawn = '';

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `<header class="top"><div class="mark">${BAG}</div><div class="titles"><h1>Magasin de compétences</h1><p>Donne de nouveaux outils et de nouvelles consignes à ton agent, en un clic</p></div><span class="spacer"></span><div class="search">${icon('search')}<input id="query" type="text" placeholder="Chercher…" spellcheck="false" /></div></header><nav class="tabs" id="tabs"></nav><main id="main"></main><div id="toast" class="toast" hidden></div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function toast(/** @type {string} */ text) {
		const t = $('toast');
		t.textContent = text;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, 3200);
	}

	function logo(/** @type {any} */ c) {
		const light = /^#(f|e|d)/i.test(c.color);
		const letter = `<b>${escape(c.name.slice(0, 1))}</b>`;
		return `<div class="logo" style="background:${escape(c.color)};color:${light ? '#0a0a0a' : '#fff'}">${c.logo ? `<img src="https://cdn.simpleicons.org/${escape(c.logo)}/${light ? '0a0a0a' : 'ffffff'}" alt="" />` : ''}${letter}</div>`;
	}

	function connectors() {
		const q = view.query.toLowerCase();
		const list = data.connectors.filter((/** @type {any} */ c) => !q || `${c.name} ${c.category} ${c.description}`.toLowerCase().includes(q));
		const banner = data.working ? `<div class="working">${icon('refresh')}<span>${escape(data.working)}</span></div>` : '';
		// What is already installed comes first.
		const sorted = [...list].sort((x, y) => Number(!!y.installed) - Number(!!x.installed));
		return banner + (sorted.length ? `<div class="grid">${sorted.map(c => `
			<article class="item ${c.installed ? 'has' : ''}">
				${logo(c)}
				<div class="text"><b>${escape(c.name)}<i class="tag">${escape(c.category)}</i>${c.local ? '<i class="tag" title="Tourne sur cette machine, sans compte">local</i>' : ''}</b><span>${escape(c.description)}</span></div>
				<div class="act">${c.installed === undefined ? `<span class="dots">…</span>` : c.installed
					? `<span class="ok">${icon('check')}Installé</span><button data-remove="${escape(c.id)}" class="iconbtn" title="Retirer" ${data.working ? 'disabled' : ''}>${icon('close')}</button>`
					: `<button data-install="${escape(c.id)}" class="btn accent" ${data.working ? 'disabled' : ''} title="${c.listed ? 'Déjà ajouté à ton assistant : il reste à te connecter' : ''}">${c.listed ? 'Connecter' : 'Installer'}</button>`}</div>
			</article>`).join('')}</div>` : `<div class="none">Aucun connecteur ne correspond à « ${escape(view.query)} ».</div>`);
	}

	function recipes() {
		const q = view.query.toLowerCase();
		return `<p class="lead">Une recette est une consigne prête à l'emploi. Un paquet s'ajoute à « Mes recettes », où tu peux les modifier. <a data-act="recipes">Ouvrir mes recettes</a></p><div class="packs">${data.packs.filter((/** @type {any} */ p) => !q || `${p.name} ${p.description} ${p.recipes.map((/** @type {any} */ r) => r.name).join(' ')}`.toLowerCase().includes(q)).map((/** @type {any} */ p) => {
			const all = p.recipes.every((/** @type {any} */ r) => r.installed);
			return `<article class="pack"><header><div><b>${escape(p.name)}</b><span>${escape(p.description)}</span></div>${all ? `<span class="ok">${icon('check')}Installé</span>` : `<button data-pack="${escape(p.id)}" class="btn accent">Installer</button>`}</header><ul>${p.recipes.map((/** @type {any} */ r) => `<li class="${r.installed ? 'has' : ''}"><b>${escape(r.name)}</b><span>${escape(r.description)}</span></li>`).join('')}</ul></article>`;
		}).join('')}</div>`;
	}

	function community() {
		if (!data.community) {
			return `<div class="none">${icon('refresh')} Recherche sur GitHub…</div>`;
		}
		const q = view.query.toLowerCase();
		const list = data.community.filter((/** @type {any} */ r) => !q || `${r.repo} ${r.description}`.toLowerCase().includes(q));
		const how = `<div class="how"><b>Partager les tiennes</b><span>Crée un dépôt GitHub public avec le sujet <code>${escape(data.topic)}</code> et un fichier <code>.orbit/skill.json</code> : <code>{ "recipes": [{ "name", "description", "prompt" }], "connectors": [{ "id", "name", "url" }] }</code>. Il apparaît ici pour tout le monde.</span></div>`;
		if (data.communityError) {
			return `<div class="none">${escape(data.communityError)}</div>${how}`;
		}
		return (list.length ? `<div class="grid">${list.map((/** @type {any} */ r) => `<article class="item">
			<div class="logo round">${r.avatar ? `<img class="keep" src="${escape(r.avatar)}&s=80" alt="" />` : ''}<b>${escape(r.owner.slice(0, 1))}</b></div>
			<div class="text"><b>${escape(r.repo)}</b><span>${escape(r.description || 'Sans description')}</span></div>
			<div class="act"><button data-open="https://github.com/${escape(r.repo)}" class="iconbtn" title="Voir sur GitHub">${icon('link')}</button><button data-skill="${escape(r.repo)}" data-branch="${escape(r.branch)}" class="btn accent">Voir et installer</button></div>
		</article>`).join('')}</div>` : `<div class="none"><b>Rien encore dans la communauté</b><br/>Sois la première personne à publier une compétence.</div>`) + how;
	}

	function render() {
		if (!data) {
			return;
		}
		const count = data.connectors.filter((/** @type {any} */ c) => c.installed).length;
		$('tabs').innerHTML = TABS.map(t => `<button data-tab="${t[0]}" class="${view.tab === t[0] ? 'on' : ''}">${t[1]}${t[0] === 'connectors' && count ? `<em>${count}</em>` : ''}</button>`).join('');
		const html = view.tab === 'recipes' ? recipes() : view.tab === 'community' ? community() : connectors();
		if (drawn !== html) {
			drawn = html;
			$('main').innerHTML = html;
		}
	}

	// A logo that fails to load (no network) leaves the letter behind it.
	document.addEventListener('error', e => {
		const image = /** @type {HTMLElement} */ (e.target);
		if (image.tagName === 'IMG') {
			image.remove();
		}
	}, true);
	document.addEventListener('load', e => {
		const image = /** @type {HTMLElement} */ (e.target);
		if (image.tagName === 'IMG' && image.parentElement?.classList.contains('logo')) {
			image.parentElement.classList.add('drawn');
		}
	}, true);

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const attr = (/** @type {string} */ name) => target.closest(`[${name}]`)?.getAttribute(name);
		if (target.closest('[disabled]')) {
			return;
		}
		if (attr('data-tab')) {
			view.tab = String(attr('data-tab'));
			if (view.tab === 'community' && !view.asked) {
				view.asked = true;
				vscode.postMessage({ type: 'community' });
			}
			render();
		} else if (attr('data-install')) {
			vscode.postMessage({ type: 'install', id: attr('data-install') });
		} else if (attr('data-remove')) {
			vscode.postMessage({ type: 'remove', id: attr('data-remove') });
		} else if (attr('data-pack')) {
			vscode.postMessage({ type: 'pack', id: attr('data-pack') });
		} else if (attr('data-skill')) {
			vscode.postMessage({ type: 'skill', repo: attr('data-skill'), branch: attr('data-branch') });
		} else if (attr('data-open')) {
			vscode.postMessage({ type: 'open', url: attr('data-open') });
		} else if (attr('data-act')) {
			vscode.postMessage({ type: attr('data-act') });
		}
	});
	$('query').addEventListener('input', () => {
		view.query = $('query').value.trim();
		render();
	});
	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'state') {
			data = msg;
			render();
		} else if (msg?.type === 'toast') {
			toast(msg.text);
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
