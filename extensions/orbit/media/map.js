/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	const SVG = 'http://www.w3.org/2000/svg';
	const MAX_MOONS = 7;
	/** Orbits are drawn as slightly flattened ellipses, as if seen from above the plane. */
	const TILT = 0.82;

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<div class="map">
			<svg id="space" class="space"></svg>
			<div id="empty" class="empty" hidden>
				<h2>Aucun agent en orbite</h2>
				<p>Lance un ou plusieurs terminaux Claude : chacun devient une planète, et les fichiers qu'il touche, ses lunes.</p>
				<button class="primary" data-command="orbit.claude.new">Lancer Claude</button>
			</div>
			<div class="legend">
				<span><i class="moon write"></i> modifie</span>
				<span><i class="moon read"></i> lit</span>
				<span><i class="link"></i> collision</span>
			</div>
		</div>
		<aside class="side">
			<header>
				<h1>Orbite</h1>
				<span id="count" class="count"></span>
			</header>
			<div id="alerts"></div>
			<div id="cards" class="cards"></div>
			<footer>
				<button data-command="orbit.claude.new">+ Agent</button>
				<button data-command="orbit.claude.grid">Grille</button>
				<button data-command="orbit.conductor.start">Chef d'orchestre</button>
				<button data-command="orbit.conductor.merge">Fusionner</button>
				<button class="wide" data-command="orbit.claude.broadcast">Message à tous</button>
			</footer>
		</aside>`;

	const space = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.getElementById('space')));
	const cards = /** @type {HTMLElement} */ (document.getElementById('cards'));
	const alerts = /** @type {HTMLElement} */ (document.getElementById('alerts'));
	const empty = /** @type {HTMLElement} */ (document.getElementById('empty'));
	const count = /** @type {HTMLElement} */ (document.getElementById('count'));

	/** @type {{ project: string, art?: string, agents: any[], collisions: any[] }} */
	let state = { project: '', agents: [], collisions: [] };
	const PLANET = 23;
	const CORE = 58;
	/** Artwork file of an agent, from its terminal colour (`terminal.ansiCyan` -> `cyan.png`). */
	const artOf = (/** @type {string} */ color) => `${state.art}/${String(color).replace(/^terminal\.ansi(Bright)?/, '').toLowerCase() || 'magenta'}.png`;
	/** Offset between this page's clock and the extension's, so elapsed times stay right. */
	let clockSkew = 0;
	/** The whole system turns as one, so planets spread evenly around it never run into each other. */
	let spin = 0;
	const SPIN_SPEED = 0.09;
	/** @type {Map<string, { x: number, y: number }>} */
	const positions = new Map();
	let last = performance.now();

	const STATUS = /** @type {Record<string, { label: string }>} */ ({
		running: { label: 'travaille' },
		waiting: { label: 'attend ton accord' },
		done: { label: 'a terminé' },
		idle: { label: 'prêt' },
	});

	const escape = (/** @type {string} */ s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
	const colorVar = (/** @type {string} */ id) => `var(--vscode-${String(id).replace(/\./g, '-')}, #8b7bff)`;

	/** @returns {SVGElement} */
	function el(/** @type {string} */ name, /** @type {Record<string, string | number>} */ attrs = {}, /** @type {SVGElement | undefined} */ parent = undefined) {
		const node = document.createElementNS(SVG, name);
		for (const [k, v] of Object.entries(attrs)) {
			node.setAttribute(k, String(v));
		}
		parent?.appendChild(node);
		return node;
	}

	function elapsed(/** @type {number | undefined} */ since) {
		if (!since) {
			return '';
		}
		const s = Math.max(0, Math.round((Date.now() + clockSkew - since) / 1000));
		return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
	}

	/** Static structure: rebuilt only when the state changes; positions are animated in `frame`. */
	function build() {
		space.replaceChildren();
		const defs = el('defs', {}, space);
		const glow = el('radialGradient', { id: 'glow' }, defs);
		el('stop', { offset: '0', 'stop-color': '#8b7bff', 'stop-opacity': '.45' }, glow);
		el('stop', { offset: '1', 'stop-color': '#8b7bff', 'stop-opacity': '0' }, glow);

		el('g', { id: 'rings' }, space);
		el('g', { id: 'links' }, space);
		const centre = el('g', { id: 'centre' }, space);
		el('circle', { r: 92, fill: 'url(#glow)' }, centre);
		if (state.art) {
			el('image', { href: `${state.art}/core.png`, x: -CORE, y: -CORE, width: CORE * 2, height: CORE * 2 }, centre);
		}
		const name = el('text', { y: CORE + 22, class: 'project' }, centre);
		name.textContent = state.project;

		const planets = el('g', { id: 'planets' }, space);
		state.agents.forEach(agent => {
			const g = el('g', { class: `planet ${agent.status}`, 'data-key': agent.key, style: `--c: ${colorVar(agent.color)}` }, planets);
			el('circle', { r: PLANET + 14, class: 'halo' }, g);
			const moons = el('g', { class: 'moons' }, g);
			agent.files.slice(0, MAX_MOONS).forEach((/** @type {any} */ file, /** @type {number} */ m) => {
				const moon = el('g', { class: `moon ${file.mode}`, 'data-file': file.file, 'data-index': m }, moons);
				el('circle', { r: file.mode === 'write' ? 4.2 : 3.4 }, moon);
				const label = el('text', { x: 8, y: 3.5 }, moon);
				label.textContent = file.name;
				const title = el('title', {}, moon);
				title.textContent = `${file.mode === 'write' ? 'Modifie' : 'Lit'} ${file.relative}`;
			});
			if (state.art) {
				el('image', { href: artOf(agent.color), x: -PLANET, y: -PLANET, width: PLANET * 2, height: PLANET * 2, class: 'body' }, g);
			}
			el('circle', { r: PLANET, class: 'ring' }, g);
			const label = el('text', { y: PLANET + 20, class: 'name' }, g);
			label.textContent = agent.name;
			const sub = el('text', { y: PLANET + 34, class: 'sub' }, g);
			sub.textContent = agent.tool ? `${STATUS[agent.status].label} · ${agent.tool}` : STATUS[agent.status]?.label ?? '';
		});
		empty.hidden = state.agents.length > 0;
	}

	function renderSide() {
		const running = state.agents.filter(a => a.status === 'running').length;
		count.textContent = state.agents.length ? `${state.agents.length} agent${state.agents.length > 1 ? 's' : ''}${running ? ` · ${running} au travail` : ''}` : '';
		alerts.innerHTML = state.collisions.map(c => {
			const names = c.agents.map((/** @type {string} */ k) => state.agents.find(a => a.key === k)?.name ?? 'Claude');
			return `<div class="alert" data-file="${escape(c.file)}"><b>Collision</b> ${escape(names.join(' et '))} modifient <code>${escape(c.relative)}</code></div>`;
		}).join('');
		cards.innerHTML = state.agents.map(agent => {
			const writes = agent.files.filter((/** @type {any} */ f) => f.mode === 'write');
			const reads = agent.files.length - writes.length;
			const files = agent.files.slice(0, 5).map((/** @type {any} */ f) => `<li class="${f.mode}" data-file="${escape(f.file)}" title="${escape(f.relative)}"><i></i>${escape(f.name)}</li>`).join('');
			return `<article class="card ${agent.status}" data-key="${escape(agent.key)}" style="--c: ${colorVar(agent.color)}">
				<div class="row"><i class="dot"></i><b>${escape(agent.name)}</b><span class="state">${escape(STATUS[agent.status]?.label ?? '')}${agent.tool ? ` · ${escape(agent.tool)}` : ''}</span></div>
				${agent.role ? `<p class="role">${escape(agent.role)}</p>` : ''}
				${agent.prompt ? `<p class="prompt">${escape(agent.prompt.slice(0, 140))}</p>` : ''}
				<div class="meta"><span>${writes.length} modifié${writes.length > 1 ? 's' : ''}</span><span>${reads} lu${reads > 1 ? 's' : ''}</span><span class="time" data-since="${agent.turnStartedAt ?? ''}">${elapsed(agent.turnStartedAt)}</span></div>
				${files ? `<ul class="files">${files}</ul>` : ''}
			</article>`;
		}).join('');
	}

	function frame(/** @type {number} */ now) {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		const box = space.getBoundingClientRect();
		const cx = box.width / 2;
		const cy = box.height / 2;
		const n = state.agents.length;
		spin += SPIN_SPEED * dt;
		const reach = Math.max(150, Math.min(box.width, box.height) / 2 - 96);
		const rings = /** @type {SVGElement} */ (space.querySelector('#rings'));
		space.querySelector('#centre')?.setAttribute('transform', `translate(${cx} ${cy})`);
		if (rings && rings.childElementCount !== n) {
			rings.replaceChildren();
			for (let i = 0; i < n; i++) {
				el('ellipse', { class: 'orbit' }, rings);
			}
		}
		state.agents.forEach((agent, i) => {
			const radius = n === 1 ? reach * 0.7 : 130 + (reach - 130) * (i / Math.max(1, n - 1));
			const angle = spin + (i / n) * Math.PI * 2;
			const x = cx + Math.cos(angle) * radius;
			// A slight tilt gives the plane of the orbits some depth.
			const y = cy + Math.sin(angle) * radius * TILT;
			positions.set(agent.key, { x, y });
			const ring = rings?.children[i];
			ring?.setAttribute('cx', String(cx));
			ring?.setAttribute('cy', String(cy));
			ring?.setAttribute('rx', String(radius));
			ring?.setAttribute('ry', String(radius * TILT));
			const planet = space.querySelector(`.planet[data-key="${CSS.escape(agent.key)}"]`);
			planet?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
			planet?.querySelectorAll('.moon').forEach(moon => {
				const m = Number(moon.getAttribute('data-index'));
				const total = Math.min(agent.files.length, MAX_MOONS);
				const a = now / 2600 + (m / total) * Math.PI * 2;
				moon.setAttribute('transform', `translate(${(Math.cos(a) * (PLANET + 16)).toFixed(1)} ${(Math.sin(a) * (PLANET + 16)).toFixed(1)})`);
			});
		});
		const links = /** @type {SVGElement} */ (space.querySelector('#links'));
		if (links) {
			links.replaceChildren();
			for (const collision of state.collisions) {
				// Three agents or more on one file: every pair gets its line.
				const points = collision.agents.map((/** @type {string} */ k) => positions.get(k));
				for (let i = 0; i < points.length; i++) {
					for (let j = i + 1; j < points.length; j++) {
						const a = points[i];
						const b = points[j];
						if (!a || !b) {
							continue;
						}
						el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'collision' }, links);
						const label = el('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 8, class: 'collision-label' }, links);
						label.textContent = `Collision · ${collision.relative.split(/[\\/]/).pop()}`;
					}
				}
			}
		}
		requestAnimationFrame(frame);
	}

	document.addEventListener('click', e => {
		const target = /** @type {Element} */ (e.target);
		const command = target.closest('[data-command]');
		if (command) {
			vscode.postMessage({ type: 'command', id: command.getAttribute('data-command') });
			return;
		}
		const file = target.closest('[data-file]');
		if (file) {
			vscode.postMessage({ type: 'open', file: file.getAttribute('data-file') });
			return;
		}
		const agent = target.closest('[data-key]');
		if (agent) {
			vscode.postMessage({ type: 'focus', key: agent.getAttribute('data-key') });
		}
	});

	setInterval(() => document.querySelectorAll('.time[data-since]').forEach(node => {
		node.textContent = elapsed(Number(node.getAttribute('data-since')) || undefined);
	}), 1000);

	window.addEventListener('message', e => {
		if (e.data?.type === 'state') {
			clockSkew = (e.data.now ?? Date.now()) - Date.now();
			state = e.data;
			build();
			renderSide();
		}
	});

	build();
	requestAnimationFrame(frame);
	vscode.postMessage({ type: 'ready' });
})();
