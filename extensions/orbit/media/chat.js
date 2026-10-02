/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { render, escape } = window.OrbitMarkdown;

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="top">
			<select id="terminal" class="term-select" title="Terminal Claude affiché"></select>
			<span class="status" id="status"><span class="dot"></span><span class="label">Prêt</span></span>
			<span class="spacer"></span>
			<button class="ghost" id="raw" title="Revenir au terminal (⌥⌘T)">⌨︎ Terminal</button>
		</header>
		<main id="messages" class="messages"></main>
		<footer class="composer-wrap">
			<div class="composer">
				<textarea id="input" rows="1" placeholder="Écris à Claude…  (⇧⏎ nouvelle ligne)"></textarea>
				<button id="send" class="send" title="Envoyer">↑</button>
			</div>
			<div class="hint">C'est le même Claude que dans le terminal — tout ce que tu écris y est envoyé.</div>
		</footer>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	const messages = $('messages');
	const input = $('input');

	/** @type {any[]} */
	let items = [];
	let status = 'idle';
	/** @type {any} */
	let pending;
	let hasSession = false;

	const ICONS = /** @type {Record<string, string>} */ ({ Read: '◫', Write: '✚', Edit: '✎', MultiEdit: '✎', Bash: '❯', Glob: '⌕', Grep: '⌕', WebSearch: '◍', WebFetch: '◍', Task: '◎', Agent: '◎', TodoWrite: '☰' });

	function renderAll() {
		const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 120;
		const parts = [];
		if (!items.length) {
			parts.push(`<div class="empty"><div class="orb"><i></i></div><h2>${hasSession ? 'La discussion commence ici' : 'Parle à Claude'}</h2><p>Écris ton message en bas. Claude travaille dans ton projet, et tu peux revenir au terminal à tout moment.</p></div>`);
		}
		let toolRun = [];
		const flushTools = () => {
			if (!toolRun.length) {
				return;
			}
			const running = toolRun.some(t => !t.done);
			const last = toolRun[toolRun.length - 1];
			const rows = toolRun.map(t => `<div class="tool ${t.done ? (t.isError ? 'err' : 'ok') : 'run'}" ${fileOf(t) ? `data-file="${escape(fileOf(t))}"` : ''}><span class="ti">${ICONS[t.name] || '•'}</span><span class="ts">${escape(t.summary)}</span><span class="tstate">${t.done ? (t.isError ? '✕' : '✓') : '<i class="spin"></i>'}</span></div>`).join('');
			parts.push(`<details class="tools" ${running ? 'open' : ''}><summary><span class="ti">${running ? '<i class="spin"></i>' : '✓'}</span><span class="ts">${toolRun.length > 1 ? `${toolRun.length} actions · ` : ''}${escape(last.summary)}</span></summary>${rows}</details>`);
			toolRun = [];
		};
		for (const item of items) {
			if (item.kind === 'tool') {
				toolRun.push(item);
				continue;
			}
			flushTools();
			if (item.kind === 'user') {
				parts.push(`<div class="msg user"><div class="bubble md">${render(item.text)}</div></div>`);
			} else {
				parts.push(`<div class="msg assistant"><div class="avatar"></div><div class="md">${render(item.text)}</div></div>`);
			}
		}
		flushTools();
		if (pending) {
			const i = pending.input || {};
			const detail = pending.name === 'Bash'
				? `<pre class="cmd">$ ${escape(i.command || '')}</pre>`
				: pending.name === 'ExitPlanMode' && i.plan ? `<div class="md plan">${render(i.plan)}</div>`
					: (pending.name === 'Edit' || pending.name === 'Write') ? `<div class="muted">${escape(pending.summary)}</div>` : '';
			parts.push(`<div class="perm"><div class="perm-title">✋ Claude demande ton accord</div><div class="perm-sum">${escape(pending.summary)}</div>${detail}
				<div class="perm-actions"><button class="btn primary" data-decide="allow">Autoriser</button><button class="btn" data-decide="always">Toujours autoriser</button><button class="btn danger" data-decide="deny">Refuser</button></div></div>`);
		} else if (status === 'running') {
			parts.push('<div class="thinking"><span class="orb-mini"></span><span class="shimmer">Claude travaille…</span></div>');
		}
		messages.innerHTML = parts.join('');
		if (stick) {
			messages.scrollTop = messages.scrollHeight;
		}
	}

	/** @param {any} t */
	function fileOf(t) {
		return t.input && (t.input.file_path || t.input.notebook_path) || '';
	}

	function renderStatus() {
		const labels = /** @type {Record<string, string>} */ ({ idle: 'Prêt', running: 'Travaille…', waiting: 'Attend ton accord', done: 'Terminé' });
		const el = $('status');
		el.className = `status ${status}`;
		el.querySelector('.label').textContent = labels[status] || status;
		$('send').classList.toggle('stop', status === 'running');
		$('send').textContent = status === 'running' ? '■' : '↑';
		$('send').title = status === 'running' ? 'Interrompre Claude (Échap)' : 'Envoyer';
	}

	function autosize() {
		input.style.height = 'auto';
		input.style.height = Math.min(input.scrollHeight, 220) + 'px';
	}

	function send() {
		const text = input.value.trim();
		if (!text) {
			if (status === 'running') {
				vscode.postMessage({ type: 'interrupt' });
			}
			return;
		}
		vscode.postMessage({ type: 'send', text });
		input.value = '';
		autosize();
	}

	input.addEventListener('input', autosize);
	input.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		} else if (e.key === 'Escape' && status === 'running') {
			vscode.postMessage({ type: 'interrupt' });
		}
	});
	$('send').addEventListener('click', send);
	$('raw').addEventListener('click', () => vscode.postMessage({ type: 'showTerminal' }));
	$('terminal').addEventListener('change', () => {
		const v = $('terminal').value;
		vscode.postMessage(v === '__new' ? { type: 'new' } : { type: 'switch', name: v });
	});
	messages.addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const t = /** @type {HTMLElement} */ (e.target);
		const decide = t.closest('[data-decide]');
		if (decide) {
			vscode.postMessage({ type: 'decide', decision: decide.getAttribute('data-decide') });
			pending = undefined;
			renderAll();
			return;
		}
		const file = t.closest('[data-file]');
		if (file) {
			vscode.postMessage({ type: 'openFile', path: String(file.getAttribute('data-file')).split(':')[0] });
			return;
		}
		const action = t.closest('[data-action]');
		if (action) {
			const code = action.closest('.code-block')?.querySelector('pre code')?.textContent || '';
			navigator.clipboard?.writeText(code);
			action.textContent = '✓';
		}
	});

	window.addEventListener('message', (/** @type {MessageEvent} */ event) => {
		const msg = event.data;
		switch (msg.type) {
			case 'items':
				items = msg.items;
				renderAll();
				if (msg.reset) {
					messages.scrollTop = messages.scrollHeight;
				}
				break;
			case 'status':
				status = msg.status;
				pending = msg.pending;
				hasSession = msg.hasSession;
				renderStatus();
				renderAll();
				break;
			case 'terminals': {
				const sel = $('terminal');
				const opts = msg.terminals.map((/** @type {string} */ n) => `<option value="${escape(n)}" ${n === msg.current ? 'selected' : ''}>✦ ${escape(n.replace(/^✦\s*/, ''))}</option>`);
				if (!msg.terminals.length) {
					opts.push('<option value="" selected>Aucun terminal Claude</option>');
				}
				opts.push('<option value="__new">＋ Nouveau Claude</option>');
				sel.innerHTML = opts.join('');
				break;
			}
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
