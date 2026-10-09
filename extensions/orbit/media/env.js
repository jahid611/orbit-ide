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
	const SHIELD = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6L12 3Zm-3 9 2.2 2.2L15.4 10"/></svg>';
	const TRIANGLE = '<svg viewBox="0 0 24 24"><path d="m12 3.6 10.4 18H1.6Z" fill="currentColor"/></svg>';
	const TARGETS = [['production', 'Production'], ['preview', 'Aperçu'], ['development', 'Développement']];

	/** @type {any} */
	let data;
	const view = { /** @type {string | undefined} */ file: undefined, /** @type {Record<string, string>} */ shown: {}, /** @type {string | undefined} */ editing: undefined, adding: false, /** @type {Set<string>} */ picked: new Set(), /** @type {Set<string>} */ targets: new Set(['production', 'preview', 'development']) };
	const drawn = /** @type {Record<string, string>} */ ({});

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `<header class="top" id="top"></header><div class="body"><nav class="files" id="files"></nav><main id="main"></main><aside id="side"></aside></div><div id="toast" class="toast" hidden></div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function draw(/** @type {string} */ id, /** @type {string} */ html) {
		if (drawn[id] !== html) {
			drawn[id] = html;
			$(id).innerHTML = html;
			return true;
		}
		return false;
	}

	function toast(/** @type {string} */ text) {
		const t = $('toast');
		t.textContent = text;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, 3000);
	}

	const file = () => data.files.find((/** @type {any} */ f) => f.name === view.file) ?? data.files[0];

	function render() {
		if (!data) {
			return;
		}
		const current = file();
		view.file = current?.name;
		const exampleKeys = new Set(data.files.filter((/** @type {any} */ f) => f.example).flatMap((/** @type {any} */ f) => f.entries.map((/** @type {any} */ e) => e.key)));
		const remote = new Map((data.remote ?? []).map((/** @type {any} */ r) => [r.key, r.targets]));

		draw('top', `
			<div class="mark">${icon('key')}</div>
			<div class="titles"><h1>Variables d'environnement</h1><p>Projet « ${escape(data.project)} » · les valeurs restent ici, les agents ne voient que les noms</p></div>
			<span class="spacer"></span>
			<label class="switch" title="Claude Code se voit refuser la lecture des fichiers .env (sauf .env.example). S'applique aux agents lancés ensuite."><input type="checkbox" id="hide" ${data.hidden ? 'checked' : ''}/><i></i><span>${SHIELD}Cachées aux agents</span></label>
			<button data-act="names" class="btn"><span class="claude-mark"></span>Donner les noms à l'agent</button>
			<button data-act="refresh" class="iconbtn" title="Actualiser">${icon('refresh')}</button>`);

		draw('files', `
			<div class="head">Fichiers</div>
			${data.files.map((/** @type {any} */ f) => `<button data-file="${escape(f.name)}" class="${f.name === view.file ? 'on' : ''}"><span>${escape(f.name)}</span><em>${f.entries.length}</em>${f.example ? '<i class="tag">modèle</i>' : ''}</button>`).join('')}
			<button data-act="newFile" class="add">${icon('plus')}Nouveau fichier</button>
			${data.git && !data.ignored && data.files.some((/** @type {any} */ f) => !f.example) ? `<div class="warn"><b>Pas protégé</b><span>Ces fichiers peuvent partir dans le dépôt git.</span><button data-act="protect" class="btn small">Les exclure de git</button></div>` : ''}
			${data.git && data.ignored ? `<div class="safe">${SHIELD}<span>Exclus de git</span></div>` : ''}`);

		const asked = (data.asked ?? []).map((/** @type {any} */ a) => `<div class="asked"><div><b>${escape(a.key)}</b><span>Demandée par un agent : ${escape(a.why || 'il en a besoin pour continuer.')}</span></div><button data-fill="${escape(a.key)}" class="btn accent">Remplir</button></div>`).join('');
		const missing = current && !current.example ? [...exampleKeys].filter(k => !current.entries.some((/** @type {any} */ e) => e.key === k)) : [];
		const rows = (current?.entries ?? []).map((/** @type {any} */ e) => {
			const id = `${current.name}\n${e.key}`;
			const shown = view.shown[id];
			const editing = view.editing === e.key;
			const on = remote.get(e.key);
			const badges = [
				!e.length ? '<i class="badge empty">vide</i>' : '',
				!current.example && exampleKeys.size && !exampleKeys.has(e.key) ? '<i class="badge" title="Absente de .env.example : les autres développeurs ne sauront pas qu\'elle existe">hors modèle</i>' : '',
				on ? `<i class="badge vercel" title="Sur Vercel : ${escape(on.join(', '))}">${TRIANGLE}${on.length === 3 ? 'partout' : escape(on.map((/** @type {string} */ t) => t === 'production' ? 'prod' : t === 'preview' ? 'aperçu' : 'dév').join(' · '))}</i>` : '',
			].join('');
			return `<div class="row ${editing ? 'editing' : ''}">
				${data.linked && !current.example ? `<input type="checkbox" class="pick" data-pick="${escape(e.key)}" ${view.picked.has(e.key) ? 'checked' : ''} ${e.length ? '' : 'disabled'}/>` : ''}
				<code class="key">${escape(e.key)}</code>
				${editing
					? `<input class="value" id="edit" type="text" spellcheck="false" autocomplete="off" value="${escape(shown ?? '')}" placeholder="Valeur" /><button data-save="${escape(e.key)}" class="btn accent small">Enregistrer</button><button data-act="cancel" class="btn small">Annuler</button>`
					: `<span class="value ${shown !== undefined ? 'clear' : ''}">${shown !== undefined ? escape(shown) || '<em>vide</em>' : e.length ? '•'.repeat(Math.min(18, Math.max(6, e.length))) : '<em>vide</em>'}</span>
						<span class="badges">${badges}</span>
						<span class="tools">
							<button data-reveal="${escape(e.key)}" class="iconbtn ${shown !== undefined ? 'on' : ''}" title="${shown !== undefined ? 'Masquer' : 'Afficher la valeur'}">${EYE}</button>
							<button data-copy="${escape(e.key)}" class="iconbtn" title="Copier la valeur">${icon('link')}</button>
							<button data-edit="${escape(e.key)}" class="iconbtn" title="Modifier">${icon('code')}</button>
							<button data-remove="${escape(e.key)}" class="iconbtn" title="Supprimer">${icon('close')}</button>
						</span>`}
			</div>`;
		}).join('');
		const adder = view.adding
			? `<div class="row editing"><input class="key" id="newKey" type="text" spellcheck="false" autocomplete="off" placeholder="NOM_DE_LA_VARIABLE" value="${escape(typeof view.adding === 'string' ? view.adding : '')}" /><input class="value" id="newValue" type="text" spellcheck="false" autocomplete="off" placeholder="Valeur" /><button data-act="create" class="btn accent small">Ajouter</button><button data-act="cancel" class="btn small">Annuler</button></div>`
			: '';
		draw('main', !data.files.length
			? `<div class="empty"><div class="big">${icon('key')}</div><b>Aucun fichier de variables</b><span>Les clés d'API, mots de passe et adresses de services vivent dans des fichiers .env, jamais dans le code. Crée le premier : Orbit l'exclut de git tout seul.</span><button data-act="newFile" class="btn accent">${icon('plus')}Créer .env.local</button></div>`
			: `${asked}
				<div class="bar"><h2>${escape(current.name)}</h2>${current.example ? '<span class="hint">Le modèle : des noms, sans valeurs. Il part dans le dépôt pour dire aux autres ce qu\'il faut remplir.</span>' : ''}<span class="spacer"></span>
					${!current.example ? `<button data-act="example" class="btn" title="Écrit dans .env.example tous les noms connus, sans aucune valeur">Mettre à jour le modèle</button>` : ''}
					<button data-act="add" class="btn accent">${icon('plus')}Ajouter</button></div>
				${missing.length ? `<div class="missing"><b>${missing.length} variable${missing.length > 1 ? 's' : ''} du modèle à remplir</b><div>${missing.map(k => `<button data-fill="${escape(k)}">${escape(k)}</button>`).join('')}</div></div>` : ''}
				<div class="rows">${adder}${rows || (view.adding ? '' : '<div class="none">Ce fichier est vide.</div>')}</div>`);

		const local = new Set((current?.entries ?? []).map((/** @type {any} */ e) => e.key));
		const onlyRemote = (data.remote ?? []).filter((/** @type {any} */ r) => !local.has(r.key));
		draw('side', `
			<div class="vhead">${TRIANGLE}<b>Vercel</b>${data.busy ? `<span class="busy">${icon('refresh')}</span>` : ''}</div>
			${!data.linked
				? `<p class="muted">Ce projet n'est pas encore relié à Vercel. Publie-le une fois, et ses variables se synchronisent ici.</p><button data-act="vercel" class="btn wide">Ouvrir Vercel</button>`
				: `${data.busy ? `<p class="muted">${escape(data.busy)}</p>` : ''}
					<p class="muted">Coche des variables à gauche, choisis où elles servent, envoie. Les valeurs passent directement de ce fichier à Vercel.</p>
					<div class="targets">${TARGETS.map(t => `<label><input type="checkbox" data-target="${t[0]}" ${view.targets.has(t[0]) ? 'checked' : ''}/>${t[1]}</label>`).join('')}</div>
					<button data-act="push" class="btn white wide" ${view.picked.size && view.targets.size && !data.busy && !current?.example ? '' : 'disabled'}>${TRIANGLE}Envoyer ${view.picked.size ? `${view.picked.size} variable${view.picked.size > 1 ? 's' : ''}` : ''}</button>
					<button data-act="pull" class="btn wide" ${data.busy ? 'disabled' : ''}>Récupérer depuis Vercel</button>
					<div class="head">Sur Vercel${data.remote ? ` · ${data.remote.length}` : ''}</div>
					${!data.remote ? '<p class="muted">Lecture…</p>' : data.remote.length ? `<ul class="remote">${data.remote.map((/** @type {any} */ r) => `<li class="${local.has(r.key) ? '' : 'far'}"><code>${escape(r.key)}</code><em>${escape(r.targets.map((/** @type {string} */ t) => t === 'production' ? 'prod' : t === 'preview' ? 'aperçu' : 'dév').join(' · '))}</em></li>`).join('')}</ul>` : '<p class="muted">Aucune variable sur Vercel pour l\'instant.</p>'}
					${onlyRemote.length ? `<p class="muted">${onlyRemote.length} variable${onlyRemote.length > 1 ? 's' : ''} n'existe${onlyRemote.length > 1 ? 'nt' : ''} que sur Vercel (en gris).</p>` : ''}`}`);
		const focus = $('edit') ?? ($('newKey') && !$('newKey').value ? $('newKey') : $('newValue'));
		if (focus && document.activeElement !== focus && !app.contains(document.activeElement?.closest('.editing') ?? null)) {
			focus.focus();
		}
	}

	function save() {
		if (view.editing && $('edit')) {
			vscode.postMessage({ type: 'set', file: view.file, key: view.editing, value: $('edit').value });
			delete view.shown[`${view.file}\n${view.editing}`];
			view.editing = undefined;
		} else if (view.adding && $('newKey')) {
			const key = $('newKey').value.trim();
			if (!key) {
				$('newKey').focus();
				return;
			}
			vscode.postMessage({ type: 'set', file: view.file, key, value: $('newValue').value });
			view.adding = false;
		}
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const attr = (/** @type {string} */ name) => target.closest(`[${name}]`)?.getAttribute(name);
		const act = target.closest('[data-act]');
		if (attr('data-file')) {
			view.file = String(attr('data-file'));
			view.editing = undefined;
			view.adding = false;
			view.picked.clear();
			view.shown = {};
			render();
		} else if (attr('data-reveal')) {
			const key = String(attr('data-reveal'));
			const id = `${view.file}\n${key}`;
			if (view.shown[id] !== undefined) {
				delete view.shown[id];
				render();
			} else {
				vscode.postMessage({ type: 'reveal', file: view.file, key });
			}
		} else if (attr('data-copy')) {
			vscode.postMessage({ type: 'copy', file: view.file, key: attr('data-copy') });
		} else if (attr('data-edit')) {
			view.editing = String(attr('data-edit'));
			view.adding = false;
			vscode.postMessage({ type: 'reveal', file: view.file, key: view.editing });
		} else if (attr('data-remove')) {
			vscode.postMessage({ type: 'remove', file: view.file, key: attr('data-remove') });
		} else if (attr('data-save')) {
			save();
		} else if (attr('data-fill')) {
			// @ts-ignore
			view.adding = String(attr('data-fill'));
			view.editing = undefined;
			const real = data.files.find((/** @type {any} */ f) => !f.example);
			if (file()?.example && real) {
				view.file = real.name;
			}
			render();
		} else if (act && !act.hasAttribute('disabled')) {
			const name = act.getAttribute('data-act');
			if (name === 'add') {
				view.adding = true;
				view.editing = undefined;
				render();
			} else if (name === 'cancel') {
				view.adding = false;
				view.editing = undefined;
				render();
			} else if (name === 'create') {
				save();
			} else if (name === 'push') {
				vscode.postMessage({ type: 'push', file: view.file, keys: [...view.picked], targets: [...view.targets] });
				view.picked.clear();
			} else {
				vscode.postMessage({ type: name });
			}
		}
	});
	document.addEventListener('change', e => {
		const target = /** @type {HTMLInputElement} */ (e.target);
		const pick = target.getAttribute('data-pick');
		const where = target.getAttribute('data-target');
		if (pick) {
			target.checked ? view.picked.add(pick) : view.picked.delete(pick);
			render();
		} else if (where) {
			target.checked ? view.targets.add(where) : view.targets.delete(where);
			render();
		} else if (target.id === 'hide') {
			vscode.postMessage({ type: 'hide', on: target.checked });
		}
	});
	document.addEventListener('keydown', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		if (e.key === 'Enter' && target.closest('.editing')) {
			e.preventDefault();
			target.id === 'newKey' && $('newKey').value.trim() ? $('newValue').focus() : save();
		} else if (e.key === 'Escape' && (view.editing || view.adding)) {
			view.editing = undefined;
			view.adding = false;
			render();
		}
	});
	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'state') {
			data = msg;
			render();
		} else if (msg?.type === 'value') {
			view.shown[`${msg.file}\n${msg.key}`] = msg.value;
			render();
		} else if (msg?.type === 'toast') {
			toast(msg.text);
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
