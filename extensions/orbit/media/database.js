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
	const KEY = mac ? '⌘⏎' : 'Ctrl+⏎';

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="top">
			<span class="page-logo small">${icon('database')}</span>
			<select id="connection" title="Connexion"></select>
			<span id="kind" class="kind"></span>
			<button id="add" class="ghost">${icon('plus')} Connexion</button>
			<button id="refresh" class="ghost icon" title="Recharger le schéma">${icon('refresh')}</button>
			<span class="spacer"></span>
			<nav class="tabs">
				<button data-tab="data" class="on">Données</button>
				<button data-tab="schema">Schéma</button>
				<button data-tab="sql">SQL</button>
			</nav>
		</header>
		<div class="body">
			<aside class="side">
				<input id="search" placeholder="Rechercher une table…" spellcheck="false" />
				<ul id="tables" class="tables"></ul>
			</aside>
			<main class="main">
				<section id="tab-data" class="tab">
					<div class="toolbar">
						<b id="tableName">Choisis une table</b><span id="tableInfo" class="muted"></span>
						<input id="where" placeholder="Filtre SQL, ex. : age > 30 AND ville = 'Paris'" spellcheck="false" />
						<button id="prev" class="ghost icon" title="Page précédente">${icon('back')}</button><span id="pageLabel" class="muted"></span><button id="next" class="ghost icon" title="Page suivante">${icon('forward')}</button>
						<button id="addRow" class="ghost">+ Ligne</button>
					</div>
					<div id="changes" class="changes" hidden><span id="changesText"></span><span class="spacer"></span><button id="discard" class="ghost">Annuler</button><button id="apply" class="primary">Appliquer</button></div>
					<div class="grid-wrap" id="gridWrap"><table id="grid" class="grid"></table></div>
				</section>
				<section id="tab-schema" class="tab" hidden>
					<div class="canvas" id="canvas"><svg id="links" class="links"></svg><div id="cards" class="cards"></div></div>
					<div class="canvas-hint muted">Glisse les tables pour les ranger · molette + Ctrl pour zoomer · glisse le fond pour te déplacer</div>
				</section>
				<section id="tab-sql" class="tab" hidden>
					<textarea id="sql" class="sql" spellcheck="false" placeholder="SELECT * FROM …"></textarea>
					<div class="toolbar"><button id="runSql" class="primary">Exécuter <kbd>${KEY}</kbd></button><span id="sqlInfo" class="muted"></span></div>
					<div class="grid-wrap"><table id="sqlGrid" class="grid"></table></div>
				</section>
				<div id="suggestion" class="suggestion" hidden></div>
			</main>
		</div>
		<footer class="claude">
			<span class="claude-mark" title="Claude"></span>
			<input id="ask" placeholder="Demande à Claude : « les 10 clients qui commandent le plus », « ajoute une colonne avatar », « génère 20 lignes de test »…" spellcheck="false" />
			<button id="askBtn" class="primary"><span class="claude-mark light"></span> Proposer la requête</button>
			<button id="delegate" class="ghost" title="Pour les gros chantiers : migrations, scripts, refonte du schéma">Confier à Claude</button>
		</footer>
		<div id="modal" class="modal" hidden></div>
		<div id="toast" class="toast" hidden></div>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	/** @type {any[]} */
	let tables = [];
	/** @type {any} */
	let current;
	let view = { table: '', page: 0, /** @type {{column: string, desc: boolean} | undefined} */ sort: undefined, where: '' };
	/** @type {{ columns: string[], rows: any[][], more: boolean }} */
	let data = { columns: [], rows: [], more: false };
	/** Staged edits, applied in one transaction. @type {Map<string, any>} */
	const changes = new Map();
	/** @type {any[]} */
	let added = [];
	const saved = /** @type {any} */ (vscode.getState() || {});
	/** @type {Record<string, {x: number, y: number}>} */
	const positions = saved.positions || {};
	let zoom = saved.zoom || 1;
	let pan = saved.pan || { x: 24, y: 24 };

	const persist = () => vscode.setState({ positions, zoom, pan });
	const tableId = (/** @type {any} */ t) => t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
	const tableOf = (/** @type {string} */ id) => tables.find(t => tableId(t) === id);
	const fmt = (/** @type {number} */ n) => new Intl.NumberFormat('fr-FR').format(n);

	function toast(/** @type {string} */ text, error = false) {
		const t = $('toast');
		t.textContent = text;
		t.className = `toast${error ? ' error' : ''}`;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, error ? 7000 : 3500);
	}

	function setTab(/** @type {string} */ tab) {
		document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.getAttribute('data-tab') === tab));
		for (const name of ['data', 'schema', 'sql']) {
			$(`tab-${name}`).hidden = name !== tab;
		}
		if (tab === 'schema') {
			drawSchema();
		}
	}

	// --- tables list

	function renderTables() {
		const q = $('search').value.trim().toLowerCase();
		$('tables').innerHTML = tables.filter(t => tableId(t).toLowerCase().includes(q)).map(t => `
			<li class="${tableId(t) === view.table ? 'on' : ''}" data-table="${escape(tableId(t))}">
				<span class="ti">${icon('table')}</span><span class="tn">${escape(tableId(t))}</span><span class="tc">${fmt(t.rows)}</span>
			</li>`).join('') || `<li class="empty muted">${current ? 'Aucune table' : 'Aucune base trouvée : ajoute une connexion'}</li>`;
	}

	function openTable(/** @type {string} */ id) {
		if (changes.size || added.length) {
			toast('Applique ou annule d\'abord tes modifications en attente.', true);
			return;
		}
		view = { table: id, page: 0, sort: undefined, where: '' };
		$('where').value = '';
		setTab('data');
		renderTables();
		load();
	}

	function load() {
		vscode.postMessage({ type: 'browse', table: view.table, page: view.page, sort: view.sort, where: view.where });
	}

	// --- data grid

	function keyOf(/** @type {any[]} */ row) {
		const table = tableOf(view.table);
		const pk = table?.columns.filter((/** @type {any} */ c) => c.primary).map((/** @type {any} */ c) => c.name) ?? [];
		if (!pk.length) {
			return undefined;
		}
		return Object.fromEntries(pk.map((/** @type {string} */ name) => [name, row[data.columns.indexOf(name)]]));
	}

	function renderGrid() {
		const table = tableOf(view.table);
		const editable = !!table?.columns.some((/** @type {any} */ c) => c.primary);
		$('tableName').textContent = view.table || 'Choisis une table';
		$('tableInfo').textContent = table ? `${fmt(table.rows)} lignes${editable ? '' : ' · lecture seule (pas de clé primaire)'}` : '';
		$('pageLabel').textContent = view.table ? `page ${view.page + 1}` : '';
		$('addRow').disabled = !editable;
		const columns = data.columns;
		const head = `<thead><tr><th class="rowh"></th>${columns.map(name => {
			const col = table?.columns.find((/** @type {any} */ c) => c.name === name);
			const arrow = view.sort?.column === name ? icon('chevronDown', view.sort.desc ? 'sort' : 'sort up') : '';
			return `<th data-sort="${escape(name)}"><span class="cn">${col?.primary ? `<i class="pk" title="Clé primaire">${icon('key')}</i>` : ''}${col?.references ? `<i class="fk" title="Référence ${escape(col.references)}">${icon('link')}</i>` : ''}${escape(name)}${arrow}</span><span class="ct">${escape(col?.type ?? '')}</span></th>`;
		}).join('')}</tr></thead>`;
		const body = data.rows.map((row, r) => {
			const key = keyOf(row);
			const id = key ? JSON.stringify(key) : `row-${r}`;
			const change = changes.get(id);
			const cls = change?.kind === 'delete' ? 'deleted' : '';
			return `<tr class="${cls}" data-row="${r}">
				<td class="rowh">${editable ? `<button class="del" title="${change?.kind === 'delete' ? 'Restaurer' : 'Supprimer la ligne'}">${icon(change?.kind === 'delete' ? 'undo' : 'close')}</button>` : ''}</td>
				${row.map((value, c) => {
					const edited = change?.values && columns[c] in change.values;
					const shown = edited ? change.values[columns[c]] : value;
					return `<td class="${edited ? 'edited' : ''}${shown === null ? ' null' : ''}" data-col="${c}" title="${escape(String(shown ?? 'NULL')).slice(0, 400)}">${shown === null ? 'NULL' : escape(String(shown)).slice(0, 200)}</td>`;
				}).join('')}
			</tr>`;
		}).join('');
		const fresh = added.map((values, a) => `<tr class="added" data-added="${a}"><td class="rowh"><button class="del" title="Retirer">${icon('close')}</button></td>${columns.map(name => `<td data-new="${escape(name)}" class="${values[name] === undefined ? 'null' : ''}">${values[name] === undefined ? 'défaut' : escape(String(values[name]))}</td>`).join('')}</tr>`).join('');
		$('grid').innerHTML = columns.length ? head + `<tbody>${fresh}${body}</tbody>` : `<tbody><tr><td class="empty muted">${view.table ? 'Table vide.' : 'Choisis une table à gauche, ou demande à Claude en bas.'}</td></tr></tbody>`;
		const count = changes.size + added.length;
		$('changes').hidden = !count;
		$('changesText').textContent = `${count} modification${count > 1 ? 's' : ''} en attente`;
		$('next').disabled = !data.more;
		$('prev').disabled = view.page === 0;
	}

	function editCell(/** @type {HTMLTableCellElement} */ td) {
		if (td.querySelector('input')) {
			return;
		}
		const tr = /** @type {HTMLElement} */ (td.parentElement);
		const isNew = tr.hasAttribute('data-added');
		// Edit the real value, never the cell's text (cut at 200 characters and escaped).
		const row = isNew ? undefined : data.rows[Number(tr.getAttribute('data-row'))];
		const column = isNew ? (td.getAttribute('data-new') ?? '') : data.columns[Number(td.getAttribute('data-col'))];
		const key = row && keyOf(row);
		const id = key ? JSON.stringify(key) : '';
		const pending = changes.get(id);
		const stored = isNew
			? added[Number(tr.getAttribute('data-added'))][column]
			: pending?.values && column in pending.values ? pending.values[column] : row?.[Number(td.getAttribute('data-col'))];
		const before = stored === null || stored === undefined ? '' : String(stored);
		const input = document.createElement('input');
		input.className = 'cell-input';
		input.value = before;
		td.textContent = '';
		td.appendChild(input);
		input.focus();
		input.select();
		let done = false;
		const commit = (/** @type {boolean} */ keep) => {
			if (done) {
				return;
			}
			done = true;
			const value = input.value;
			// Nothing typed: nothing staged, whatever the cell showed.
			if (keep && value !== before) {
				const parsed = value.toUpperCase() === 'NULL' ? null : value;
				if (isNew) {
					added[Number(tr.getAttribute('data-added'))][column] = parsed ?? undefined;
				} else if (key && row) {
					const original = row[Number(td.getAttribute('data-col'))];
					const change = changes.get(id) ?? { kind: 'update', key, values: {} };
					if (change.kind === 'update' && (original === null ? parsed === null : parsed !== null && String(original) === parsed)) {
						delete change.values[column]; // back to the value in the database
					} else {
						change.values[column] = parsed;
					}
					if (change.kind === 'update' && !Object.keys(change.values).length) {
						changes.delete(id);
					} else {
						changes.set(id, change);
					}
				}
			}
			renderGrid();
		};
		input.addEventListener('keydown', e => {
			if (e.key === 'Enter') { commit(true); } else if (e.key === 'Escape') { commit(false); }
		});
		input.addEventListener('blur', () => commit(true));
	}

	// --- schema diagram

	function drawSchema() {
		const cards = $('cards');
		const perRow = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
		cards.innerHTML = tables.map((t, i) => {
			const id = tableId(t);
			const pos = positions[id] ?? { x: (i % perRow) * 360, y: Math.floor(i / perRow) * (60 + 26 * Math.max(...tables.map(x => x.columns.length))) };
			positions[id] = pos;
			return `<div class="card" data-card="${escape(id)}" style="left:${pos.x}px;top:${pos.y}px">
				<div class="card-head"><span>${escape(id)}</span><b>${fmt(t.rows)}</b></div>
				${t.columns.map((/** @type {any} */ c) => `<div class="card-col ${c.primary ? 'pk' : ''}" data-column="${escape(c.name)}"><span class="mark">${c.primary ? icon('key') : c.references ? icon('link') : ''}</span><span class="name">${escape(c.name)}</span><span class="type">${escape(c.type)}</span></div>`).join('')}
			</div>`;
		}).join('');
		applyTransform();
		requestAnimationFrame(drawLinks);
	}

	function applyTransform() {
		$('cards').style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
		$('links').style.transform = $('cards').style.transform;
	}

	function drawLinks() {
		const svg = $('links');
		const paths = [];
		for (const t of tables) {
			for (const c of t.columns) {
				if (!c.references) {
					continue;
				}
				const [targetTable, targetColumn] = c.references.split('.');
				const target = tables.find(x => x.name === targetTable);
				const from = document.querySelector(`[data-card="${CSS.escape(tableId(t))}"] [data-column="${CSS.escape(c.name)}"]`);
				const to = target && (document.querySelector(`[data-card="${CSS.escape(tableId(target))}"] [data-column="${CSS.escape(targetColumn)}"]`) || document.querySelector(`[data-card="${CSS.escape(tableId(target))}"] .card-head`));
				if (!(from instanceof HTMLElement) || !(to instanceof HTMLElement)) {
					continue;
				}
				const a = offset(from);
				const b = offset(to);
				const leftToRight = a.x + a.w < b.x;
				const x1 = leftToRight ? a.x + a.w : a.x;
				const x2 = leftToRight ? b.x : b.x + b.w;
				const y1 = a.y + a.h / 2;
				const y2 = b.y + b.h / 2;
				const bend = Math.max(40, Math.abs(x2 - x1) / 2);
				const d = `M${x1},${y1} C${x1 + (leftToRight ? bend : -bend)},${y1} ${x2 + (leftToRight ? -bend : bend)},${y2} ${x2},${y2}`;
				paths.push(`<path d="${d}" /><circle cx="${x2}" cy="${y2}" r="3.5" />`);
			}
		}
		svg.innerHTML = paths.join('');
	}

	/** Position of an element inside the (untransformed) diagram plane. */
	function offset(/** @type {HTMLElement} */ el) {
		const card = /** @type {HTMLElement} */ (el.closest('.card'));
		return { x: card.offsetLeft + el.offsetLeft, y: card.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
	}

	const canvas = $('canvas');
	/** @type {{ kind: 'card' | 'pan', id?: string, x: number, y: number, ox: number, oy: number } | undefined} */
	let drag;
	canvas.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
		const head = /** @type {HTMLElement} */ (e.target).closest('.card-head');
		if (head) {
			const id = head.parentElement?.getAttribute('data-card') ?? '';
			drag = { kind: 'card', id, x: e.clientX, y: e.clientY, ox: positions[id].x, oy: positions[id].y };
		} else if (!(/** @type {HTMLElement} */ (e.target).closest('.card'))) {
			drag = { kind: 'pan', x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y };
		}
		if (drag) {
			canvas.setPointerCapture(e.pointerId);
		}
	});
	canvas.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
		if (!drag) {
			return;
		}
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (drag.kind === 'card' && drag.id) {
			positions[drag.id] = { x: drag.ox + dx / zoom, y: drag.oy + dy / zoom };
			const card = /** @type {HTMLElement} */ (document.querySelector(`[data-card="${CSS.escape(drag.id)}"]`));
			card.style.left = `${positions[drag.id].x}px`;
			card.style.top = `${positions[drag.id].y}px`;
			drawLinks();
		} else {
			pan = { x: drag.ox + dx, y: drag.oy + dy };
			applyTransform();
		}
	});
	canvas.addEventListener('pointerup', () => { drag = undefined; persist(); });
	canvas.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
		if (!e.ctrlKey && !e.metaKey) {
			pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
		} else {
			e.preventDefault();
			zoom = Math.min(2, Math.max(0.3, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
		}
		applyTransform();
		persist();
	}, { passive: false });
	canvas.addEventListener('dblclick', (/** @type {MouseEvent} */ e) => {
		const card = /** @type {HTMLElement} */ (e.target).closest('[data-card]');
		if (card) {
			openTable(card.getAttribute('data-card') ?? '');
		}
	});

	// --- results, suggestions, confirmations

	function resultTable(/** @type {string[]} */ columns, /** @type {any[][]} */ rows) {
		if (!columns.length) {
			return '';
		}
		return `<thead><tr>${columns.map(c => `<th><span class="cn">${escape(c)}</span></th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td class="${v === null ? 'null' : ''}" title="${escape(String(v ?? 'NULL')).slice(0, 400)}">${v === null ? 'NULL' : escape(String(v)).slice(0, 200)}</td>`).join('')}</tr>`).join('')}</tbody>`;
	}

	function showSuggestion(/** @type {any} */ s) {
		const box = $('suggestion');
		box.hidden = false;
		box.innerHTML = `
			<div class="s-head"><span class="claude-mark" title="Claude"></span><b>Proposition de Claude</b><span class="badge ${s.writes ? 'write' : 'read'}">${s.writes ? 'Modifie la base' : 'Lecture seule'}</span><span class="spacer"></span><button class="ghost icon" id="sClose">${icon('close')}</button></div>
			<p>${escape(s.explanation)}</p>
			<textarea id="sSql" class="sql small" spellcheck="false">${escape(s.sql)}</textarea>
			<div class="s-actions"><button class="ghost" id="sEdit">Ouvrir dans l'onglet SQL</button><button class="${s.writes ? 'danger' : 'primary'}" id="sRun">${s.writes ? 'Exécuter (modifie la base)' : 'Exécuter'}</button></div>`;
		$('sClose').onclick = () => { box.hidden = true; };
		$('sEdit').onclick = () => { $('sql').value = $('sSql').value; box.hidden = true; setTab('sql'); };
		$('sRun').onclick = () => { $('sql').value = $('sSql').value; box.hidden = true; setTab('sql'); runSql(); };
	}

	function confirmWrite(/** @type {string} */ sql, /** @type {number} */ count) {
		const modal = $('modal');
		modal.hidden = false;
		modal.innerHTML = `<div class="dialog">
			<h3>Cette requête modifie la base</h3>
			<p class="muted">${count > 1 ? `${count} instructions vont être exécutées, dans l'ordre.` : 'Vérifie-la avant de continuer : elle ne pourra pas être annulée depuis Orbit.'}</p>
			<pre>${escape(sql.slice(0, 1500))}</pre>
			<div class="s-actions"><button class="ghost" id="mNo">Annuler</button><button class="danger" id="mYes">Exécuter</button></div></div>`;
		$('mNo').onclick = () => { modal.hidden = true; };
		$('mYes').onclick = () => { modal.hidden = true; vscode.postMessage({ type: 'run', sql, confirmed: true }); };
	}

	function runSql() {
		const sql = $('sql').value.trim();
		if (sql) {
			$('sqlInfo').textContent = 'Exécution…';
			vscode.postMessage({ type: 'run', sql });
		}
	}

	function ask() {
		const prompt = $('ask').value.trim();
		if (!prompt) {
			$('ask').focus();
			return;
		}
		if (!current) {
			toast('Connecte d\'abord une base.', true);
			return;
		}
		vscode.postMessage({ type: 'ask', prompt });
	}

	// --- events

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const tab = target.closest('[data-tab]');
		if (tab) {
			setTab(tab.getAttribute('data-tab') ?? 'data');
			return;
		}
		const item = target.closest('[data-table]');
		if (item) {
			openTable(item.getAttribute('data-table') ?? '');
			return;
		}
		const sort = target.closest('[data-sort]');
		if (sort && !changes.size) {
			const column = sort.getAttribute('data-sort') ?? '';
			view.sort = view.sort?.column === column ? (view.sort.desc ? undefined : { column, desc: true }) : { column, desc: false };
			view.page = 0;
			load();
			return;
		}
		if (target.closest('.del')) {
			const tr = /** @type {HTMLElement} */ (target.closest('tr'));
			if (tr.hasAttribute('data-added')) {
				added.splice(Number(tr.getAttribute('data-added')), 1);
			} else {
				const key = keyOf(data.rows[Number(tr.getAttribute('data-row'))]);
				const id = JSON.stringify(key);
				changes.get(id)?.kind === 'delete' ? changes.delete(id) : changes.set(id, { kind: 'delete', key });
			}
			renderGrid();
		}
	});
	document.addEventListener('dblclick', e => {
		const td = /** @type {HTMLElement} */ (e.target).closest('#grid td[data-col], #grid td[data-new]');
		if (td && tableOf(view.table)?.columns.some((/** @type {any} */ c) => c.primary)) {
			editCell(/** @type {HTMLTableCellElement} */ (td));
		}
	});
	$('connection').addEventListener('change', () => vscode.postMessage({ type: 'connect', id: $('connection').value }));
	$('add').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
	$('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
	$('search').addEventListener('input', renderTables);
	$('where').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter') {
			view.where = $('where').value;
			view.page = 0;
			load();
		}
	});
	$('prev').addEventListener('click', () => { if (view.page > 0) { view.page--; load(); } });
	$('next').addEventListener('click', () => { if (data.more) { view.page++; load(); } });
	$('addRow').addEventListener('click', () => { added.unshift({}); renderGrid(); });
	$('discard').addEventListener('click', () => { changes.clear(); added = []; renderGrid(); });
	$('apply').addEventListener('click', () => {
		const list = [...changes.values(), ...added.map(values => ({ kind: 'insert', values }))];
		vscode.postMessage({ type: 'save', table: view.table, changes: list });
	});
	$('runSql').addEventListener('click', runSql);
	$('sql').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } });
	$('askBtn').addEventListener('click', ask);
	$('ask').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') { ask(); } });
	$('delegate').addEventListener('click', () => {
		const prompt = $('ask').value.trim();
		if (!prompt) {
			toast('Décris d\'abord ce que Claude doit faire.', true);
			return;
		}
		vscode.postMessage({ type: 'delegate', prompt });
		$('ask').value = '';
	});

	window.addEventListener('message', e => {
		const msg = e.data;
		switch (msg?.type) {
			case 'connections':
				$('connection').innerHTML = msg.connections.length
					? msg.connections.map((/** @type {any} */ c) => `<option value="${escape(c.id)}" ${c.id === msg.current ? 'selected' : ''}>${escape(c.label)} — ${escape(c.detail)}</option>`).join('')
					: '<option>Aucune base détectée</option>';
				if (!msg.connections.length) {
					renderTables();
				}
				break;
			case 'connecting':
				current = msg.current;
				$('kind').textContent = current.kind === 'sqlite' ? 'SQLite' : 'PostgreSQL';
				$('tables').innerHTML = '<li class="empty muted">Connexion…</li>';
				break;
			case 'connectFailed':
				current = msg.current;
				tables = [];
				$('tables').innerHTML = `<li class="empty muted">Connexion impossible : ${escape(msg.message)}</li>`;
				toast(`Connexion impossible : ${msg.message}`, true);
				break;
			case 'schema':
				current = msg.current;
				tables = msg.tables;
				for (const option of $('connection').options) {
					option.selected = option.value === current?.id;
				}
				renderTables();
				if (!$('tab-schema').hidden) {
					drawSchema();
				}
				if (view.table && tableOf(view.table)) {
					load();
				} else if (tables.length && !view.table) {
					openTable(tableId(tables[0]));
				}
				break;
			case 'rows':
				if (msg.table === view.table) {
					data = { columns: msg.columns, rows: msg.rows, more: msg.more };
					renderGrid();
				}
				break;
			case 'saved':
				changes.clear();
				added = [];
				toast(`${msg.changed} ligne${msg.changed > 1 ? 's' : ''} enregistrée${msg.changed > 1 ? 's' : ''}`);
				break;
			case 'result':
				$('sqlGrid').innerHTML = resultTable(msg.columns, msg.rows);
				$('sqlInfo').textContent = msg.changed !== undefined ? `${msg.changed} ligne${msg.changed > 1 ? 's' : ''} modifiée${msg.changed > 1 ? 's' : ''} · ${msg.ms} ms` : `${msg.rows.length}${msg.truncated ? '+' : ''} ligne${msg.rows.length > 1 ? 's' : ''} · ${msg.ms} ms`;
				setTab('sql');
				break;
			case 'confirm':
				confirmWrite(msg.sql, msg.statements);
				break;
			case 'thinking':
				$('askBtn').disabled = true;
				$('askBtn').innerHTML = '<span class="claude-mark light"></span> Claude réfléchit…';
				break;
			case 'suggestion':
				$('askBtn').disabled = false;
				$('askBtn').innerHTML = '<span class="claude-mark light"></span> Proposer la requête';
				showSuggestion(msg);
				break;
			case 'error':
				$('askBtn').disabled = false;
				$('askBtn').innerHTML = '<span class="claude-mark light"></span> Proposer la requête';
				$('sqlInfo').textContent = '';
				toast(msg.message, true);
				break;
		}
	});

	renderTables();
	renderGrid();
	vscode.postMessage({ type: 'ready' });
})();
