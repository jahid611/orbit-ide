/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { escape, render: markdown } = window.OrbitMarkdown;
	// @ts-ignore
	const { icon } = window.OrbitIcons;

	const COLUMNS = [
		{ id: 'todo', label: 'À faire', hint: 'Dépose tes idées ici' },
		{ id: 'doing', label: 'En cours', hint: 'Glisse une carte ici pour la confier à un agent' },
		{ id: 'review', label: 'À vérifier', hint: 'Le travail fini des agents arrive ici' },
		{ id: 'done', label: 'Fait', hint: 'Ce que tu as validé' },
	];
	const BOARD = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 4h4.5v15H4zM9.75 4h4.5v10h-4.5zM15.5 4H20v7h-4.5z"/></svg>';

	/** @type {any} */
	let data;
	const view = { /** @type {string | undefined} */ adding: undefined, /** @type {string | undefined} */ open: undefined, /** @type {string | undefined} */ editing: undefined, /** @type {string | undefined} */ dragging: undefined };
	let drawn = '';

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `<header class="top" id="top"></header><main class="board" id="board"></main>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function since(/** @type {number} */ from, /** @type {number} */ to = Date.now()) {
		const minutes = Math.max(0, Math.round((to - from) / 60000));
		return minutes < 1 ? 'moins d\'une minute' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
	}

	function card(/** @type {any} */ c) {
		const open = view.open === c.id;
		if (view.editing === c.id) {
			return `<article class="card form" data-id="${c.id}"><input id="editTitle" type="text" value="${escape(c.title)}" placeholder="Titre" /><textarea id="editDetail" rows="4" placeholder="Détails pour l'agent (facultatif)">${escape(c.detail)}</textarea><div class="formrow"><button data-act="saveEdit" class="btn accent">Enregistrer</button><button data-act="cancel" class="btn">Annuler</button></div></article>`;
		}
		const status = c.column === 'doing'
			? c.live ? (c.waiting ? `<span class="chip wait"><i></i>attend ta réponse</span>` : `<span class="chip run"><i></i>${escape(c.tool ? c.tool : 'travaille')}</span>`) : c.key ? `<span class="chip stop">interrompue</span>` : `<span class="chip run"><i></i>prise par ${escape(c.agent ?? 'un agent')}</span>`
			: '';
		const time = c.column === 'doing' && c.startedAt ? `depuis ${since(c.startedAt)}` : c.endedAt && c.startedAt ? `faite en ${since(c.startedAt, c.endedAt)}` : '';
		const actions = [
			c.column === 'todo' ? `<button data-start="${c.id}" class="btn accent small">${icon('play')}Lancer</button>` : '',
			c.column === 'doing' && c.live ? `<button data-goto="${c.id}" class="btn small">Voir l'agent</button>` : '',
			c.column === 'doing' && !c.live && c.key ? `<button data-start="${c.id}" class="btn accent small">Relancer</button>` : '',
			c.column === 'review' ? `<button data-move="${c.id}" data-to="done" class="btn accent small">${icon('check')}Valider</button><button data-start="${c.id}" class="btn small" title="Un nouvel agent refait la tâche">Refaire</button>` : '',
			c.column === 'review' && c.key ? `<button data-goto="${c.id}" class="btn small">Voir l'agent</button>` : '',
			`<span class="spacer"></span><button data-edit="${c.id}" class="iconbtn" title="Modifier">${icon('code')}</button><button data-remove="${c.id}" class="iconbtn" title="Supprimer">${icon('close')}</button>`,
		].join('');
		return `<article class="card ${open ? 'open' : ''} ${c.waiting ? 'waiting' : ''}" data-id="${c.id}" draggable="true">
			<div class="title" data-open="${c.id}">${escape(c.title)}</div>
			${status || time ? `<div class="meta">${status}${time ? `<span>${time}</span>` : ''}</div>` : ''}
			${open ? `${c.detail ? `<div class="detail">${escape(c.detail)}</div>` : ''}${c.summary ? `<div class="summary"><b>Compte rendu de l'agent</b><div class="md">${markdown(c.summary)}</div></div>` : ''}<div class="actions">${actions}</div>` : c.summary && c.column === 'review' ? `<div class="peek" data-open="${c.id}">${escape(c.summary.replace(/\s+/g, ' ').slice(0, 110))}…</div>` : ''}
		</article>`;
	}

	function render() {
		if (!data) {
			return;
		}
		const todo = data.cards.filter((/** @type {any} */ c) => c.column === 'todo').length;
		const html = COLUMNS.map(column => {
			const cards = data.cards.filter((/** @type {any} */ c) => c.column === column.id);
			const adder = view.adding === column.id
				? `<article class="card form"><input id="newTitle" type="text" placeholder="Ce qu'il faut faire" /><textarea id="newDetail" rows="3" placeholder="Détails pour l'agent (facultatif)"></textarea><div class="formrow"><button data-act="create" class="btn accent">Ajouter</button><button data-act="cancel" class="btn">Annuler</button></div></article>`
				: column.id === 'todo' ? `<button data-add="todo" class="adder">${icon('plus')}Nouvelle carte</button>` : '';
			return `<section class="column c-${column.id}" data-column="${column.id}">
				<header><i></i><b>${column.label}</b><em>${cards.length}</em>${column.id === 'done' && cards.length ? `<button data-act="clearDone" class="iconbtn" title="Retirer les cartes terminées">${icon('close')}</button>` : ''}</header>
				<div class="cards">${cards.map(card).join('')}${!cards.length && view.adding !== column.id ? `<div class="hint">${column.hint}</div>` : ''}${adder}</div>
			</section>`;
		}).join('');
		const top = `
			<div class="mark">${BOARD}</div>
			<div class="titles"><h1>Tableau de tâches</h1><p>Projet « ${escape(data.project)} » · tes agents prennent les cartes, toi tu valides</p></div>
			<span class="spacer"></span>
			<label class="para" title="Nombre d'agents qui travaillent en même temps">Agents en même temps<select id="parallel">${[1, 2, 3, 4, 6].map(n => `<option value="${n}" ${n === data.parallel ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
			<button data-act="runAll" class="btn ${data.autoRun ? 'stop' : 'accent'}" ${todo || data.autoRun ? '' : 'disabled'}>${data.autoRun ? `${icon('close')}Arrêter d'enchaîner` : `${icon('play')}Tout lancer${todo ? ` · ${todo}` : ''}`}</button>`;
		if ($('top')._html !== top) {
			$('top')._html = top;
			$('top').innerHTML = top;
		}
		if (drawn !== html && !view.dragging) {
			drawn = html;
			$('board').innerHTML = html;
			const focus = $('newTitle') ?? $('editTitle');
			if (focus) {
				focus.focus();
			}
		}
	}

	function create() {
		const title = $('newTitle')?.value.trim();
		if (title) {
			vscode.postMessage({ type: 'add', title, detail: $('newDetail').value });
			drawn = '';
			$('newTitle').value = '';
			$('newDetail').value = '';
			$('newTitle').focus();
		}
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const attr = (/** @type {string} */ name) => target.closest(`[${name}]`)?.getAttribute(name);
		const act = target.closest('[data-act]');
		if (attr('data-start')) {
			vscode.postMessage({ type: 'start', id: attr('data-start') });
		} else if (attr('data-goto')) {
			vscode.postMessage({ type: 'goto', id: attr('data-goto') });
		} else if (attr('data-move')) {
			vscode.postMessage({ type: 'move', id: attr('data-move'), column: attr('data-to') });
		} else if (attr('data-edit')) {
			view.editing = String(attr('data-edit'));
			render();
		} else if (attr('data-remove')) {
			vscode.postMessage({ type: 'remove', id: attr('data-remove') });
		} else if (attr('data-add')) {
			view.adding = String(attr('data-add'));
			view.editing = undefined;
			render();
		} else if (act && !act.hasAttribute('disabled')) {
			const name = act.getAttribute('data-act');
			if (name === 'create') {
				create();
			} else if (name === 'cancel') {
				view.adding = undefined;
				view.editing = undefined;
				render();
			} else if (name === 'saveEdit') {
				vscode.postMessage({ type: 'edit', id: view.editing, title: $('editTitle').value, detail: $('editDetail').value });
				view.editing = undefined;
			} else {
				vscode.postMessage({ type: name });
			}
		} else if (attr('data-open')) {
			view.open = view.open === attr('data-open') ? undefined : String(attr('data-open'));
			render();
		}
	});
	document.addEventListener('keydown', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		if (e.key === 'Escape' && (view.adding || view.editing)) {
			view.adding = undefined;
			view.editing = undefined;
			render();
		} else if (e.key === 'Enter' && (target.id === 'newTitle' || (target.id === 'newDetail' && (e.ctrlKey || e.metaKey)))) {
			e.preventDefault();
			create();
		}
	});
	document.addEventListener('change', e => {
		const target = /** @type {HTMLSelectElement} */ (e.target);
		if (target.id === 'parallel') {
			vscode.postMessage({ type: 'parallel', value: Number(target.value) });
		}
	});

	// Cards are moved by hand from one column to another, and reordered inside a column.
	document.addEventListener('dragstart', e => {
		const el = /** @type {HTMLElement} */ (e.target).closest?.('.card[data-id]');
		if (!el || el.classList.contains('form')) {
			return;
		}
		view.dragging = String(el.getAttribute('data-id'));
		e.dataTransfer?.setData('text/plain', view.dragging);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
		}
		requestAnimationFrame(() => el.classList.add('ghost'));
	});
	document.addEventListener('dragover', e => {
		const column = /** @type {HTMLElement} */ (e.target).closest?.('.column');
		if (!view.dragging || !column) {
			return;
		}
		e.preventDefault();
		document.querySelectorAll('.column.over').forEach(c => c !== column && c.classList.remove('over'));
		column.classList.add('over');
	});
	document.addEventListener('drop', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const column = target.closest?.('.column');
		if (view.dragging && column) {
			e.preventDefault();
			const before = target.closest('.card[data-id]')?.getAttribute('data-id');
			vscode.postMessage({ type: 'move', id: view.dragging, column: column.getAttribute('data-column'), before: before !== view.dragging ? before : undefined });
		}
	});
	document.addEventListener('dragend', () => {
		view.dragging = undefined;
		document.querySelectorAll('.over, .ghost').forEach(el => el.classList.remove('over', 'ghost'));
		drawn = '';
		render();
	});

	window.addEventListener('message', e => {
		if (e.data?.type === 'state') {
			data = e.data;
			render();
		}
	});
	// Durations on the cards keep moving.
	setInterval(() => !view.adding && !view.editing && render(), 30000);
	vscode.postMessage({ type: 'ready' });
})();
