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

	const LOGO = '<svg viewBox="0 0 109 113" class="sb"><path d="M63.7 110.3c-2.9 3.6-8.7 1.6-8.8-3l-1-67.3h45.3c8.2 0 12.8 9.5 7.7 15.9L63.7 110.3z" fill="#249361"/><path d="M45.3 2.1c2.9-3.6 8.7-1.6 8.8 3l.4 67.3H9.8c-8.2 0-12.8-9.5-7.7-15.9L45.3 2.1z" fill="#3ecf8e"/></svg>';
	const LEAVE = '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13 8H6.5"/></svg>';
	const OUT = '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4m0-4L7.5 8.5"/></svg>';
	const SHIELD = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6L12 3Z"/></svg>';
	const STATUS = /** @type {Record<string, string>} */ ({ ACTIVE_HEALTHY: 'Actif', INACTIVE: 'En pause', COMING_UP: 'Démarrage', PAUSING: 'Mise en pause', RESTORING: 'Restauration', UNKNOWN: 'Inconnu' });

	/** @type {any} */
	let data;
	const view = { tab: 'tables', creating: false, /** @type {string | undefined} */ open: undefined };
	const drawn = /** @type {Record<string, string>} */ ({});

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `<header class="bar" id="bar"></header><main id="main"></main><div id="toast" class="toast" hidden></div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function draw(/** @type {string} */ id, /** @type {string} */ html) {
		if (drawn[id] !== html) {
			drawn[id] = html;
			$(id).innerHTML = html;
		}
	}

	function toast(/** @type {string} */ text) {
		const t = $('toast');
		t.textContent = text;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, 3400);
	}

	const number = (/** @type {number} */ n) => new Intl.NumberFormat('fr-FR').format(n);

	function connect() {
		return `<div class="center"><div class="card login">
			${LOGO}<h1>Relie Supabase à Orbit</h1>
			<p>Base de données, comptes utilisateurs et stockage pour ton projet. Orbit se sert d'un jeton d'accès que tu crées dans ton compte : il reste dans le coffre de ton système, jamais dans le projet, jamais chez l'agent.</p>
			<ol>
				<li><i>1</i><div><b>Crée un jeton d'accès</b><span>Sur la page « Access Tokens » de ton compte Supabase, bouton « Generate new token ».</span></div><button data-act="tokenPage" class="btn">${OUT}Ouvrir la page</button></li>
				<li><i>2</i><div><b>Colle-le ici</b><span>Il commence par « sbp_ ».</span><div class="row"><input id="token" type="password" spellcheck="false" autocomplete="off" placeholder="sbp_…" /><button data-act="connect" class="btn green">Relier</button></div></div></li>
			</ol>
			${data.error ? `<div class="error">${escape(data.error)}</div>` : ''}
			<p class="foot">Pas encore de compte ? <a data-open="https://supabase.com">supabase.com</a>, gratuit pour commencer.</p>
		</div></div>`;
	}

	function projects() {
		const list = data.projects ?? [];
		const form = view.creating ? `<div class="card create"><h2>Nouveau projet</h2><div class="formgrid">
				<label>Nom<input id="newName" type="text" value="${escape(data.project)}" spellcheck="false" /></label>
				<label>Organisation<select id="newOrg">${data.organizations.map((/** @type {any} */ o) => `<option value="${escape(o.id)}">${escape(o.name)}</option>`).join('')}</select></label>
				<label>Région<select id="newRegion">${data.regions.map((/** @type {string[]} */ r) => `<option value="${r[0]}">${r[1]}</option>`).join('')}</select></label>
			</div><div class="row"><button data-act="create" class="btn green" ${data.working ? 'disabled' : ''}>Créer et relier</button><button data-act="cancel" class="btn">Annuler</button></div></div>` : '';
		return `<div class="wrap">
			<div class="head"><div><h1>Choisis le projet Supabase de « ${escape(data.project)} »</h1><p>Orbit écrit son adresse et sa clé publique dans .env.local, hors de git.</p></div><span class="spacer"></span><button data-act="new" class="btn green" ${data.organizations.length ? '' : 'disabled'}>${icon('plus')}Nouveau projet</button></div>
			${data.error ? `<div class="error">${escape(data.error)}</div>` : ''}
			${data.working ? `<div class="working">${icon('refresh')}<span>${escape(data.working)}</span></div>` : ''}
			${form}
			${!data.projects ? `<div class="none">${icon('refresh')} Lecture de tes projets…</div>` : list.length ? `<div class="grid">${list.map((/** @type {any} */ p) => `<article class="card project"><div><b>${escape(p.name)}</b><span>${escape(p.region)} · ${escape(p.ref)}</span></div><span class="st ${p.status === 'ACTIVE_HEALTHY' ? 'ok' : 'off'}"><i></i>${STATUS[p.status] ?? escape(p.status)}</span><button data-link="${escape(p.ref)}" class="btn" ${data.working ? 'disabled' : ''}>Relier</button></article>`).join('')}</div>` : `<div class="none"><b>Aucun projet sur ce compte</b><br/>Crée le premier avec « Nouveau projet ».</div>`}
		</div>`;
	}

	function table(/** @type {any} */ t) {
		const open = view.open === t.name;
		return `<div class="trow ${open ? 'open' : ''}">
			<div class="line" data-table="${escape(t.name)}"><span class="chev">${icon('play')}</span><code>${escape(t.name)}</code><span class="dim">${number(t.rows)} ligne${t.rows > 1 ? 's' : ''} · ${t.columns.length} colonne${t.columns.length > 1 ? 's' : ''}</span><span class="spacer"></span>${t.rls ? `<span class="rls on">${SHIELD}RLS</span>` : `<span class="rls off" title="N'importe qui peut lire et écrire cette table avec la clé publique">${SHIELD}Sans protection</span><button data-protect="${escape(t.name)}" class="btn small">Protéger</button>`}</div>
			${open ? `<div class="cols">${t.columns.map((/** @type {any} */ c) => `<span><code>${escape(c.name)}</code><em>${escape(c.type)}</em></span>`).join('')}</div>` : ''}
		</div>`;
	}

	function result() {
		const r = data.result;
		if (!r) {
			return '';
		}
		if (r.error) {
			return `<div class="error">${escape(r.error)}</div>`;
		}
		const rows = r.rows ?? [];
		if (!rows.length) {
			return `<div class="none small">Requête exécutée, aucune ligne renvoyée.</div>`;
		}
		const keys = Object.keys(rows[0]);
		return `<div class="result"><table><thead><tr>${keys.map(k => `<th>${escape(k)}</th>`).join('')}</tr></thead><tbody>${rows.map((/** @type {any} */ row) => `<tr>${keys.map(k => `<td>${row[k] === null ? '<em>null</em>' : escape(typeof row[k] === 'object' ? JSON.stringify(row[k]) : String(row[k])).slice(0, 300)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="dim">${rows.length} ligne${rows.length > 1 ? 's' : ''}${rows.length === 200 ? ' (les 200 premières)' : ''}</p>`;
	}

	function dashboard() {
		const project = (data.projects ?? []).find((/** @type {any} */ p) => p.ref === data.linked);
		const o = data.overview;
		const open = (o?.tables ?? []).filter((/** @type {any} */ t) => !t.rls);
		const stats = `<div class="stats">
			<div><span>Tables</span><b>${o ? o.tables.length : '…'}</b></div>
			<div><span>Comptes utilisateurs</span><b>${o?.users !== undefined ? number(o.users) : '…'}</b></div>
			<div><span>Espaces de stockage</span><b>${o?.buckets !== undefined ? number(o.buckets) : '…'}</b></div>
			<div><span>Région</span><b>${escape(project?.region ?? '…')}</b></div>
		</div>`;
		const tabs = `<nav class="tabs">${[['tables', 'Tables'], ['sql', 'Éditeur SQL'], ['keys', 'Clés et variables']].map(t => `<button data-tab="${t[0]}" class="${view.tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</nav>`;
		const body = view.tab === 'sql'
			? `<div class="card sql"><textarea id="sql" rows="6" spellcheck="false" placeholder="select * from …">${escape(data.result?.sql ?? '')}</textarea><div class="row"><button data-act="run" class="btn green" ${data.working ? 'disabled' : ''}>${icon('play')}Exécuter</button><span class="dim">Ctrl+Entrée · une requête qui modifie la base te demande confirmation</span></div></div>${result()}`
			: view.tab === 'keys'
				? `<div class="card keys">
					<div class="kv"><div><b>${escape(data.prefix)}SUPABASE_URL</b><span>https://${escape(data.linked)}.supabase.co</span></div><span class="rls on">dans .env.local</span></div>
					<div class="kv"><div><b>${escape(data.prefix)}SUPABASE_ANON_KEY</b><span>La clé publique : faite pour le navigateur, protégée par les règles RLS.</span></div><span class="rls on">dans .env.local</span></div>
					<div class="kv"><div><b>SUPABASE_SERVICE_ROLE_KEY</b><span>La clé secrète : contourne toutes les protections. Côté serveur uniquement.</span></div><button data-act="secret" class="btn small">Écrire dans .env.local</button></div>
				</div><div class="row"><button data-env class="btn">Ouvrir les variables d'environnement</button><button data-act="unlink" class="btn">Délier ce projet</button></div>`
				: `${open.length ? `<div class="alert">${SHIELD}<div><b>${open.length} table${open.length > 1 ? 's' : ''} sans protection</b><span>Avec la clé publique, n'importe qui peut ${open.length > 1 ? 'les' : 'la'} lire et ${open.length > 1 ? 'les' : 'la'} modifier : ${escape(open.map((/** @type {any} */ t) => t.name).join(', '))}.</span></div></div>` : ''}
					${!o ? `<div class="none">${icon('refresh')} Lecture de la base…</div>` : o.error ? `<div class="error">${escape(o.error)}</div>` : o.tables.length ? `<div class="card list">${o.tables.map(table).join('')}</div>` : `<div class="none"><b>La base est vide</b><br/>Demande à ton agent de concevoir les tables : il te donne le SQL, tu l'exécutes ici.</div>`}`;
		return `<div class="wrap">
			<div class="head"><div><h1>${escape(project?.name ?? data.linked)}</h1><p><span class="st ${project?.status === 'ACTIVE_HEALTHY' ? 'ok' : 'off'}"><i></i>${STATUS[project?.status] ?? '…'}</span> · ${escape(data.linked)}.supabase.co</p></div><span class="spacer"></span>
				<button data-act="agent" class="btn green"><span class="claude-mark"></span>Brancher dans le projet</button>
				<button data-dash="" class="btn">${OUT}supabase.com</button></div>
			${data.error ? `<div class="error">${escape(data.error)}</div>` : ''}
			${data.working ? `<div class="working">${icon('refresh')}<span>${escape(data.working)}</span></div>` : ''}
			${stats}${tabs}${body}
		</div>`;
	}

	function render() {
		if (!data) {
			return;
		}
		draw('bar', `<div class="brand">${LOGO}<b>Supabase</b>${data.linked ? `<i>/</i><span>${escape(data.project)}</span>` : ''}</div><span class="spacer"></span>
			${data.connected ? `<button data-act="refresh" class="iconbtn" title="Actualiser">${icon('refresh')}</button><button data-act="logout" class="iconbtn" title="Se déconnecter de Supabase">${LEAVE}</button>` : ''}`);
		const sql = $('sql')?.value;
		draw('main', !data.connected ? connect() : !data.linked || !(data.projects ?? [{ ref: data.linked }]).some((/** @type {any} */ p) => p.ref === data.linked) ? projects() : dashboard());
		if (sql !== undefined && $('sql') && $('sql').value !== sql && document.activeElement !== $('sql')) {
			$('sql').value = sql;
		}
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const attr = (/** @type {string} */ name) => target.closest(`[${name}]`)?.getAttribute(name);
		if (target.closest('[disabled]')) {
			return;
		}
		const act = attr('data-act');
		if (attr('data-protect')) {
			vscode.postMessage({ type: 'protect', table: attr('data-protect') });
		} else if (attr('data-table')) {
			view.open = view.open === attr('data-table') ? undefined : String(attr('data-table'));
			render();
		} else if (attr('data-link')) {
			vscode.postMessage({ type: 'link', ref: attr('data-link') });
		} else if (attr('data-tab')) {
			view.tab = String(attr('data-tab'));
			render();
		} else if (target.closest('[data-dash]')) {
			vscode.postMessage({ type: 'dashboard', page: attr('data-dash') || undefined });
		} else if (target.closest('[data-env]')) {
			vscode.postMessage({ type: 'env' });
		} else if (attr('data-open')) {
			vscode.postMessage({ type: 'open', url: attr('data-open') });
		} else if (act === 'connect') {
			vscode.postMessage({ type: 'connect', token: $('token').value });
		} else if (act === 'new' || act === 'cancel') {
			view.creating = act === 'new';
			render();
		} else if (act === 'create') {
			vscode.postMessage({ type: 'create', name: $('newName').value, organization: $('newOrg').value, region: $('newRegion').value });
			view.creating = false;
		} else if (act === 'run') {
			vscode.postMessage({ type: 'run', sql: $('sql').value });
		} else if (act) {
			vscode.postMessage({ type: act });
		}
	});
	document.addEventListener('keydown', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		if (e.key === 'Enter' && target.id === 'token') {
			vscode.postMessage({ type: 'connect', token: $('token').value });
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && target.id === 'sql') {
			e.preventDefault();
			vscode.postMessage({ type: 'run', sql: $('sql').value });
		}
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
