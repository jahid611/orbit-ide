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

	const MARK = '<svg viewBox="0 0 24 24" class="vercel-mark"><path d="m12 1.608 12 20.784H0Z" fill="currentColor"/></svg>';
	const BRANCH = '<svg viewBox="0 0 16 16" class="glyph"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4.75 5.5v5m0-5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm0 5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm6.5-3a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm0 0c0 2-2.5 2.25-6.5 3"/></svg>';
	const COMMIT = '<svg viewBox="0 0 16 16" class="glyph"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 10.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM1 8h4.25m5.5 0H15"/></svg>';
	const OUT = '<svg viewBox="0 0 16 16" class="glyph"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4m0-4L7.5 8.5"/></svg>';
	const LEAVE = '<svg viewBox="0 0 16 16" class="glyph"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13 8H6.5"/></svg>';
	const LINES = '<svg viewBox="0 0 16 16" class="glyph"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M2.5 4h11M2.5 8h11M2.5 12h7"/></svg>';

	const STATES = /** @type {Record<string, string>} */ ({ READY: 'Prêt', ERROR: 'Erreur', BUILDING: 'Construction', QUEUED: 'En file', INITIALIZING: 'Démarrage', CANCELED: 'Annulé' });
	const TABS = [['overview', 'Projet'], ['deployments', 'Déploiements'], ['logs', 'Journal']];

	/** @type {any} */
	let data;
	const view = { tab: 'overview', /** @type {string | undefined} */ logsFor: undefined, /** @type {Record<string, any[]>} */ logs: {}, /** @type {any} */ shot: undefined, wasBusy: false };
	/** What each zone last showed: a zone is only redrawn when it changes, so a button never vanishes under the pointer. */
	const drawn = /** @type {Record<string, string>} */ ({});

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `<header class="vbar" id="bar"></header><nav class="vtabs" id="tabs"></nav><main id="main"></main>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function draw(/** @type {string} */ id, /** @type {string} */ html) {
		if (drawn[id] !== html) {
			drawn[id] = html;
			$(id).innerHTML = html;
			return true;
		}
		return false;
	}

	function ago(/** @type {number} */ at) {
		const minutes = Math.round((Date.now() - at) / 60000);
		if (minutes < 1) {
			return 'à l\'instant';
		}
		if (minutes < 60) {
			return `il y a ${minutes} min`;
		}
		const hours = Math.round(minutes / 60);
		return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
	}

	function duration(/** @type {number | undefined} */ seconds) {
		if (!seconds) {
			return '';
		}
		return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
	}

	function status(/** @type {any} */ d) {
		return `<span class="st st-${escape(String(d.state).toLowerCase())}"><i></i>${STATES[d.state] ?? escape(d.state)}</span>`;
	}

	function source(/** @type {any} */ d) {
		const branch = d.branch ? `<span class="src">${BRANCH}<span>${escape(d.branch)}</span></span>` : '';
		const commit = d.sha || d.message ? `<span class="src">${COMMIT}<span>${d.sha ? `<code>${escape(d.sha.slice(0, 7))}</code> ` : ''}${escape(d.message ?? '')}</span></span>` : '';
		return branch + commit || '<span class="src dim">Envoyé depuis cet ordinateur</span>';
	}

	function check(/** @type {boolean} */ ok, /** @type {string} */ label, /** @type {string} */ detail, /** @type {string} */ action = '') {
		return `<li class="${ok ? 'ok' : 'todo'}"><i>${ok ? icon('check') : ''}</i><div><b>${label}</b><span>${detail}</span></div>${action}</li>`;
	}

	function checksList(/** @type {any} */ c) {
		const repo = c.remote ? c.remote.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') : '';
		// A set-up step running in the background shows on its own line, in place of the button.
		const s = data.setup;
		const wait = `<span class="working">${icon('refresh')}</span>`;
		const signing = s && c.cli && !c.account;
		return `<ul class="checks">
			${check(!!c.cli, 'Outil Vercel', c.cli ? `version ${escape(c.cli)}` : s ? escape(s.text) : 'Pas encore installé sur cette machine.', c.cli ? '' : s ? wait : `<button data-act="install" class="btn white">Installer</button>`)}
			${check(!!c.account, 'Compte Vercel', c.account ? `connecté : ${escape(c.account)}` : signing ? `${escape(s.text)}${s.code ? ` Code : <b class="code">${escape(s.code)}</b>` : ''}` : 'Connecte-toi une fois : le navigateur s\'ouvre sur Vercel.', c.account || !c.cli ? '' : signing ? (s.url ? `<button data-open="${escape(s.url)}" class="btn">Rouvrir la page</button>` : wait) : `<button data-act="login" class="btn white">Me connecter</button>`)}
			${check(!!c.remote, 'Dépôt GitHub', c.remote ? `${escape(repo)}${c.branch ? ` · branche ${escape(c.branch)}` : ''}` : c.github ? 'Créé à la première publication, en privé.' : 'GitHub n\'est pas connecté : lance « gh auth login » dans un terminal.')}
			${check(!!c.linked, 'Projet Vercel', c.linked ? `${escape(c.linked)} · chaque envoi sur GitHub republie` : 'Créé et relié au dépôt à la première publication.')}
		</ul>`;
	}

	/** The publication under way (or the one that just failed): its steps, then its live log. */
	function progress() {
		if (!data.steps?.length && !data.failure) {
			return '';
		}
		const steps = `<ol class="steps">${(data.steps ?? []).map((/** @type {any} */ s) => `<li class="${s.state}"><i>${s.state === 'done' ? icon('check') : s.state === 'failed' ? icon('close') : ''}</i>${escape(s.label)}</li>`).join('')}</ol>`;
		const failure = data.failure ? `<div class="failure"><b>La publication s'est arrêtée</b><span>${escape(data.failure)}</span><button data-act="fix" class="btn white"><span class="claude-mark"></span>Faire corriger par ${escape(data.assistant)}</button></div>` : '';
		const done = !data.busy && !data.failure;
		return `<section class="card ${data.failure ? 'bad' : ''}">
			<div class="card-head"><h2>${data.busy ? 'Publication en cours' : data.failure ? 'Publication interrompue' : 'Publication terminée'}</h2><span class="spacer"></span>${data.busy ? '<span class="st st-building"><i></i>En cours</span>' : done ? '<span class="st st-ready"><i></i>En ligne</span>' : ''}</div>
			${failure}${steps}
			<details class="log" ${data.failure || data.busy ? 'open' : ''}><summary>Journal</summary><pre id="live"></pre></details>
		</section>`;
	}

	function row(/** @type {any} */ d) {
		return `<div class="dep">
			<div class="c1"><a data-open="https://${escape(d.url)}" title="${escape(d.url)}">${escape(d.id.replace(/^dpl_/, '').slice(0, 9))}</a><span>${d.production ? 'Production' : 'Aperçu'}${d.current ? '<em class="pill">Actuel</em>' : ''}</span></div>
			<div class="c2">${status(d)}<span>${duration(d.seconds)}</span></div>
			<div class="c3">${source(d)}</div>
			<div class="c4"><span>${ago(d.created)}${d.creator ? ` par ${escape(d.creator)}` : ''}</span><button data-logs="${escape(d.id)}" class="icon" title="Journal de construction">${LINES}</button>${d.inspector ? `<button data-open="${escape(d.inspector)}" class="icon" title="Ouvrir sur vercel.com">${OUT}</button>` : ''}</div>
		</div>`;
	}

	function overview() {
		const r = data.remote;
		const prod = r.deployments.find((/** @type {any} */ d) => d.current) ?? r.deployments.find((/** @type {any} */ d) => d.production);
		const site = r.domains[0] ? `https://${r.domains[0]}` : prod ? `https://${prod.url}` : '';
		const shot = view.shot && prod && view.shot.id === prod.id ? `<img src="${view.shot.data}" alt="" />` : `<div class="noshot">${MARK}<span>${prod?.state === 'READY' ? 'Capture du site…' : 'Pas encore de capture'}</span></div>`;
		const production = prod ? `<section class="card prod">
				<div class="card-head"><h2>Déploiement en production</h2><span class="spacer"></span>
					<button data-logs="${escape(prod.id)}" class="btn">${LINES}Journal de construction</button>
					${prod.inspector ? `<button data-open="${escape(prod.inspector)}" class="btn">${OUT}vercel.com</button>` : ''}
					<button data-open="${escape(site)}" class="btn white">Visiter</button>
				</div>
				<div class="prod-body">
					<a class="shot" data-open="${escape(site)}" title="Ouvrir le site">${shot}</a>
					<dl>
						<dt>Déploiement</dt><dd><a data-open="https://${escape(prod.url)}">${escape(prod.url)}</a></dd>
						<dt>Domaines</dt><dd class="domains">${r.domains.map((/** @type {string} */ d) => `<a data-open="https://${escape(d)}">${escape(d)}${OUT}</a>`).join('') || '<span class="dim">Aucun</span>'}</dd>
						<div class="pair"><div><dt>Statut</dt><dd>${status(prod)}</dd></div><div><dt>Créé</dt><dd>${ago(prod.created)}${prod.creator ? ` par ${escape(prod.creator)}` : ''}</dd></div></div>
						<dt>Source</dt><dd class="sources">${source(prod)}</dd>
					</dl>
				</div>
			</section>` : `<section class="card"><div class="none">${MARK}<b>Aucun déploiement en production</b><span>Clique sur « Publier » : le site reçoit son adresse, et cette page se remplit.</span></div></section>`;
		const facts = [
			['Framework', r.framework],
			['Node.js', r.node],
			['Dépôt', r.repo],
			['Branche de production', r.productionBranch],
		].filter(f => f[1]).map(f => `<div><span>${f[0]}</span><b>${escape(f[1])}</b></div>`).join('');
		const others = r.deployments.slice(0, 5);
		return `${progress()}${production}
			${facts ? `<section class="facts">${facts}</section>` : ''}
			${others.length ? `<section class="card list"><div class="card-head"><h2>Derniers déploiements</h2><span class="spacer"></span><button data-tab="deployments" class="btn">Tout voir</button></div>${others.map(row).join('')}</section>` : ''}`;
	}

	function deployments() {
		const list = data.remote.deployments;
		return list.length
			? `<section class="card list">${list.map(row).join('')}</section>`
			: `<section class="card"><div class="none">${MARK}<b>Aucun déploiement</b><span>Ils apparaîtront ici dès la première publication.</span></div></section>`;
	}

	function logs() {
		const list = data.remote.deployments;
		const id = view.logsFor ?? list[0]?.id;
		const lines = id ? view.logs[id] : undefined;
		const options = list.map((/** @type {any} */ d) => `<option value="${escape(d.id)}" ${d.id === id ? 'selected' : ''}>${escape(d.id.replace(/^dpl_/, '').slice(0, 9))} · ${d.production ? 'Production' : 'Aperçu'} · ${STATES[d.state] ?? escape(d.state)} · ${ago(d.created)}</option>`).join('');
		const body = !id ? '<div class="none"><b>Aucun déploiement</b></div>'
			: !lines ? `<div class="waiting">${icon('refresh')}<span>Lecture du journal…</span></div>`
				: lines.length ? `<pre class="build">${lines.map((/** @type {any} */ l) => `<span class="${l.error ? 'err' : ''}"><time>${new Date(l.at).toLocaleTimeString('fr-FR')}</time>${escape(l.text)}</span>`).join('')}</pre>`
					: '<div class="none"><b>Journal vide</b><span>Vercel ne garde pas indéfiniment le journal des anciens déploiements.</span></div>';
		return `<section class="card logs"><div class="card-head"><h2>Journal de construction</h2><span class="spacer"></span><select id="logsFor">${options}</select><button data-act="reloadLogs" class="icon" title="Relire">${icon('refresh')}</button></div>${body}</section>`;
	}

	function setup() {
		const c = data.checks;
		const ready = !!c.cli && !!c.account;
		return `<div class="setup">
			<div class="intro"><div class="big">${MARK}</div><h1>${ready ? 'Prêt à publier' : 'Relie Vercel à Orbit'}</h1><p>${ready ? `Un clic sur « Publier » : Orbit enregistre les changements (${escape(data.assistant)} écrit le message), les envoie sur GitHub, puis Vercel construit et met en ligne. Ensuite, chaque envoi sur GitHub republie tout seul.` : 'Deux étapes, une seule fois. Cette page avance toute seule dès que c\'est fait.'}</p></div>
			${checksList(c)}
			${progress()}
		</div>`;
	}

	function render() {
		if (!data) {
			return;
		}
		const c = data.checks;
		const r = data.remote;
		if (data.busy && !view.wasBusy) {
			view.tab = 'overview';
		}
		view.wasBusy = !!data.busy;
		const ready = !!c?.cli && !!c?.account;
		const repo = c?.remote && /^https:\/\/github\.com\//.test(c.remote) ? c.remote.replace(/\.git$/, '') : '';
		draw('bar', `
			<div class="crumbs">${MARK}<i>/</i><span>${escape(c?.account ?? 'Vercel')}</span><i>/</i><b>${escape(r?.name ?? data.project)}</b>${r?.framework ? `<em class="pill">${escape(r.framework)}</em>` : ''}</div>
			<span class="spacer"></span>
			<button data-act="refresh" class="icon ${data.checking ? 'spin' : ''}" title="Actualiser">${icon('refresh')}</button>
			${c?.account ? `<button data-act="logout" class="icon" title="Se déconnecter de Vercel (${escape(c.account)})" ${data.setup || data.busy ? 'disabled' : ''}>${LEAVE}</button>` : ''}
			${repo ? `<button data-open="${escape(repo)}" class="btn">Dépôt</button>` : ''}
			${r?.dashboard ? `<button data-open="${escape(r.dashboard)}" class="btn">${OUT}vercel.com</button>` : ''}
			<button data-act="preview" class="btn" ${ready && !data.busy ? '' : 'disabled'} title="Une adresse d'essai, sans toucher au site en production">Aperçu</button>
			<button data-act="publish" class="btn white" ${ready && !data.busy ? '' : 'disabled'}>${MARK}${data.busy ? 'Publication…' : c?.dirty ? `Publier · ${c.dirty} changement${c.dirty > 1 ? 's' : ''}` : 'Publier'}</button>`);
		$('tabs').hidden = !r;
		draw('tabs', r ? TABS.map(t => `<button data-tab="${t[0]}" class="${view.tab === t[0] ? 'on' : ''}">${t[1]}${t[0] === 'deployments' && r.deployments.length ? `<em>${r.deployments.length}</em>` : ''}</button>`).join('') : '');
		const html = !c ? `<div class="waiting">${icon('refresh')}<span>Vérification du projet…</span></div>`
			: !r ? setup()
				: view.tab === 'deployments' ? deployments() : view.tab === 'logs' ? logs() : overview();
		if (draw('main', html)) {
			const build = document.querySelector('pre.build');
			if (build) {
				build.scrollTop = build.scrollHeight;
			}
		}
		const live = $('live');
		if (live) {
			const text = (data.log ?? []).join('\n');
			if (live.textContent !== text) {
				live.textContent = text;
				live.scrollTop = live.scrollHeight;
			}
		}
	}

	function openLogs(/** @type {string} */ id, force = false) {
		view.tab = 'logs';
		view.logsFor = id;
		if (force) {
			delete view.logs[id];
		}
		if (!view.logs[id]) {
			vscode.postMessage({ type: 'logs', id });
		}
		render();
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const open = target.closest('[data-open]');
		const logsOf = target.closest('[data-logs]');
		const tab = target.closest('[data-tab]');
		const act = target.closest('[data-act]');
		if (logsOf) {
			openLogs(String(logsOf.getAttribute('data-logs')));
		} else if (open) {
			vscode.postMessage({ type: 'open', url: open.getAttribute('data-open') });
		} else if (tab) {
			const name = String(tab.getAttribute('data-tab'));
			if (name === 'logs') {
				const first = view.logsFor ?? data?.remote?.deployments[0]?.id;
				if (first) {
					openLogs(first);
					return;
				}
			}
			view.tab = name;
			render();
		} else if (act && !act.hasAttribute('disabled')) {
			const name = act.getAttribute('data-act');
			if (name === 'reloadLogs') {
				if (view.logsFor ?? data?.remote?.deployments[0]?.id) {
					openLogs(view.logsFor ?? data.remote.deployments[0].id, true);
				}
				return;
			}
			vscode.postMessage(name === 'preview' ? { type: 'publish', production: false } : name === 'publish' ? { type: 'publish', production: true } : { type: name });
		}
	});
	document.addEventListener('change', e => {
		const target = /** @type {HTMLSelectElement} */ (e.target);
		if (target.id === 'logsFor') {
			openLogs(target.value);
		}
	});
	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'state') {
			data = msg;
			render();
		} else if (msg?.type === 'shot') {
			view.shot = msg.shot;
			render();
		} else if (msg?.type === 'logs') {
			view.logs[msg.id] = msg.lines;
			render();
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
