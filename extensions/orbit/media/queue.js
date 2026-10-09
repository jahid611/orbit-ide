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

	const MODES = [
		{ id: '', label: 'Mode de mes réglages' },
		{ id: 'acceptEdits', label: 'Accepter les modifications' },
		{ id: 'auto', label: 'Automatique' },
	];
	const LABELS = /** @type {Record<string, string>} */ ({ waiting: 'en attente', running: 'en cours', blocked: 'attend ton accord', done: 'terminée', failed: 'en échec', skipped: 'passée' });

	/** @type {any} */
	let data;

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="hero">
			<div class="mark">${icon('list')}</div>
			<div class="titles"><h1>File de nuit</h1><p id="lead">Empile des tâches, lance la file, retrouve le rapport au réveil.</p></div>
			<span class="spacer"></span>
			<button id="phone" class="ghost" title="Être prévenu sur ton téléphone à la fin de la file">${icon('send')}<span id="phoneLabel">Téléphone</span></button>
			<button id="report" class="ghost" title="Ouvrir le rapport">${icon('read')}<span>Rapport</span></button>
		</header>
		<div class="grid">
			<section class="composer">
				<textarea id="prompt" rows="4" spellcheck="false" placeholder="Une tâche à confier. Un paragraphe par tâche si tu en colles plusieurs."></textarea>
				<div class="row"><button id="add" class="ghost strong">${icon('plus')}<span>Ajouter à la file</span><kbd>Ctrl ↵</kbd></button></div>
				<div class="options">
					<label>Mode des agents<select id="mode">${MODES.map(m => `<option value="${m.id}">${m.label}</option>`).join('')}</select></label>
					<label class="check"><input type="checkbox" id="stopOnFailure" /> Arrêter la file au premier échec</label>
				</div>
				<p class="hint" id="hint"></p>
				<button id="go" class="primary"></button>
			</section>
			<section class="list">
				<div class="pane-head"><span id="listTitle">Tâches</span><span class="spacer"></span><button id="clear" class="link" hidden>Vider les tâches finies</button></div>
				<ol id="tasks" class="tasks"></ol>
			</section>
		</div>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

	function duration(/** @type {any} */ task) {
		if (!task.startedAt) {
			return '';
		}
		const minutes = Math.max(1, Math.round(((task.endedAt ?? Date.now()) - task.startedAt) / 60000));
		return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
	}

	function render() {
		if (!data) {
			return;
		}
		const tasks = data.tasks;
		const name = data.assistant ?? 'l\'agent';
		const waiting = tasks.filter((/** @type {any} */ t) => t.status === 'waiting').length;
		const finished = tasks.filter((/** @type {any} */ t) => ['done', 'failed', 'skipped'].includes(t.status)).length;
		$('lead').textContent = data.running
			? `La file tourne sur « ${data.project} » : tâche ${Math.min(finished + 1, tasks.length)} sur ${tasks.length}.`
			: `Projet « ${data.project} ». Empile des tâches, lance la file, retrouve le rapport au réveil.`;
		$('mode').value = data.mode ?? '';
		$('mode').disabled = data.running;
		$('stopOnFailure').checked = !!data.stopOnFailure;
		$('phoneLabel').textContent = data.phone ? 'Téléphone relié' : 'Téléphone';
		$('phone').classList.toggle('on', !!data.phone);
		$('report').hidden = !finished;
		$('clear').hidden = !finished || data.running;
		$('listTitle').textContent = tasks.length ? `${tasks.length} tâche${tasks.length > 1 ? 's' : ''} · ${waiting} en attente` : 'Tâches';
		const mode = data.mode || data.defaultMode;
		$('hint').textContent = mode === 'auto'
			? `En mode automatique, ${name} avance sans te demander : la file ne s'arrête pas la nuit.`
			: `Hors mode automatique, ${name} peut s'arrêter pour demander un accord : la tâche attend alors 15 minutes, puis la file passe à la suivante.`;
		const go = $('go');
		go.className = `primary ${data.running ? 'stop' : ''}`;
		go.disabled = !data.running && !waiting;
		go.innerHTML = data.running ? `${icon('stop')}<span>Arrêter la file</span>` : `${icon('play')}<span>Lancer la file${waiting ? ` (${waiting})` : ''}</span>`;

		$('tasks').innerHTML = tasks.map((/** @type {any} */ task, /** @type {number} */ i) => {
			const live = data.live?.id === task.id ? data.live : undefined;
			const open = ['done', 'failed'].includes(task.status);
			return `<li class="task ${task.status}" data-id="${task.id}">
				<div class="head">
					<i class="state">${task.status === 'done' ? icon('check') : task.status === 'failed' ? icon('close') : task.status === 'running' ? '' : String(i + 1)}</i>
					<div class="what"><b>${escape(task.prompt.split('\n')[0])}</b><span>${LABELS[task.status]}${duration(task) ? ` · ${duration(task)}` : ''}${live?.tool ? ` · ${escape(live.tool)}` : ''}${task.changed?.length ? ` · ${task.changed.length} fichier${task.changed.length > 1 ? 's' : ''}` : ''}</span></div>
					<div class="acts">
						${task.status === 'waiting' ? `<button data-act="move" data-up="1" title="Monter">${icon('chevronDown')}</button><button data-act="move" title="Descendre">${icon('chevronDown')}</button>` : ''}
						${task.session && open ? `<button data-act="resume" title="Reprendre la discussion de cette tâche">${icon('terminal')}</button>` : ''}
						${task.changed?.length ? `<button data-act="changes" title="Voir les changements dans la frise">${icon('undo')}</button>` : ''}
						${task.status === 'failed' && !data.running ? `<button data-act="retry" title="Remettre dans la file">${icon('refresh')}</button>` : ''}
						${task.status !== 'running' && task.status !== 'blocked' ? `<button data-act="remove" title="Retirer">${icon('trash')}</button>` : ''}
					</div>
				</div>
				${live?.agent ? `<p class="live">${escape(live.agent.slice(0, 220))}</p>` : ''}
				${task.note ? `<p class="note">${escape(task.note)}</p>` : ''}
				${task.summary ? `<details ${task.status === 'failed' ? 'open' : ''}><summary>Le compte rendu</summary><div class="summary">${escape(task.summary.slice(0, 2400))}</div>${task.changed?.length ? `<div class="files">${task.changed.slice(0, 24).map((/** @type {string} */ f) => `<code>${escape(f)}</code>`).join('')}</div>` : ''}</details>` : ''}
			</li>`;
		}).join('') || `<li class="empty"><div class="big">${icon('list')}</div><b>La file est vide</b><span>Écris à gauche ce qu'il faut faire pendant ton absence, la tâche la plus importante en premier. Chaque tâche part dans un agent neuf, pour que le contexte de l'une ne pèse pas sur la suivante.</span></li>`;
	}

	function add() {
		const prompt = $('prompt').value.trim();
		if (!prompt) {
			$('prompt').focus();
			return;
		}
		vscode.postMessage({ type: 'add', prompt });
		$('prompt').value = '';
		$('prompt').focus();
	}

	const options = () => vscode.postMessage({ type: 'options', mode: $('mode').value, stopOnFailure: $('stopOnFailure').checked });
	$('mode').addEventListener('change', options);
	$('stopOnFailure').addEventListener('change', options);
	$('add').addEventListener('click', add);
	$('prompt').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			add();
		}
	});
	$('go').addEventListener('click', () => vscode.postMessage({ type: data?.running ? 'stop' : 'start' }));
	$('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
	$('report').addEventListener('click', () => vscode.postMessage({ type: 'report' }));
	$('phone').addEventListener('click', () => vscode.postMessage({ type: 'phone' }));
	$('tasks').addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const button = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
		const task = button?.closest('[data-id]');
		if (button && task) {
			vscode.postMessage({ type: button.getAttribute('data-act'), id: Number(task.getAttribute('data-id')), up: button.hasAttribute('data-up') });
		}
	});

	window.addEventListener('message', e => {
		if (e.data?.type === 'state') {
			data = e.data;
			render();
		}
	});
	setInterval(() => data?.running && render(), 30000);
	vscode.postMessage({ type: 'ready' });
})();
