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

	const ACCENTS = ['#8b7bff', '#5b8cff', '#22d3ee', '#2dd4bf', '#4ade80', '#facc15', '#fb923c', '#f43f5e', '#e879f9', '#ffffff'];
	const UI_FONTS = ['', 'Inter', 'SF Pro Display', 'Geist', 'IBM Plex Sans', 'Manrope', 'Helvetica Neue'];
	const CODE_FONTS = [
		"'JetBrains Mono', 'SF Mono', Menlo, monospace",
		"'Fira Code', Menlo, monospace",
		"'SF Mono', Menlo, monospace",
		"'Geist Mono', Menlo, monospace",
		"'Cascadia Code', Menlo, monospace",
		"'IBM Plex Mono', Menlo, monospace",
		'Menlo, Monaco, monospace',
	];

	/**
	 * Declarative description of every control.
	 * @type {{ id: string, title: string, hint?: string, controls: any[] }[]}
	 */
	const SECTIONS = [
		{
			id: 'theme', title: 'Thème', hint: 'Choisis une ambiance. Orbit Cosmos laisse voir le fond spatial derrière l\'interface.', controls: [
				{ type: 'themes' },
				{ type: 'segmented', key: 'orbit.ui.wallpaper', label: 'Fond d\'écran', options: [['cosmos', 'Cosmos'], ['none', 'Aucun']] },
				{ type: 'text', key: 'orbit.ui.wallpaper', label: 'Ou ta propre image', placeholder: '/chemin/vers/image.jpg' },
			],
		},
		{ id: 'accent', title: 'Couleur d\'accent', hint: 'Appliquée aux boutons, focus, onglets et curseur.', controls: [{ type: 'accent' }] },
		{ id: 'layout', title: 'Disposition', hint: 'Un clic pour une interface complète, puis affine.', controls: [{ type: 'presets' }] },
		{
			id: 'ui', title: 'Interface', controls: [
				{ type: 'toggle', key: 'orbit.ui.floatingPanels', label: 'Panneaux flottants', hint: 'Cartes arrondies séparées, façon Antigravity' },
				{ type: 'range', key: 'orbit.ui.panelGap', label: 'Espace entre panneaux', min: 0, max: 16, unit: 'px' },
				{ type: 'range', key: 'orbit.ui.cornerRadius', label: 'Arrondi', min: 0, max: 24, unit: 'px' },
				{ type: 'range', key: 'window.zoomLevel', label: 'Zoom global', min: -2, max: 3, step: 0.5 },
				{ type: 'select', key: 'orbit.ui.fontFamily', label: 'Police de l\'interface', options: UI_FONTS.map(f => [f, f || 'Système']), custom: true },
				{ type: 'range', key: 'orbit.ui.fontSize', label: 'Taille du texte de l\'interface', min: 0, max: 18, unit: 'px', zeroLabel: 'auto' },
				{ type: 'toggle', key: 'orbit.ui.compactTabs', label: 'Onglets en pilule' },
				{ type: 'toggle', key: 'orbit.ui.minimalChrome', label: 'Interface épurée', hint: 'Masque bordures et séparateurs' },
				{ type: 'select', key: 'workbench.activityBar.location', label: 'Barre d\'activité', options: [['default', 'Côté'], ['top', 'En haut'], ['bottom', 'En bas'], ['hidden', 'Masquée']] },
				{ type: 'select', key: 'workbench.sideBar.location', label: 'Explorateur', options: [['left', 'À gauche'], ['right', 'À droite']] },
				{ type: 'toggle', key: 'workbench.statusBar.visible', label: 'Barre d\'état' },
				{ type: 'toggle', key: 'window.commandCenter', label: 'Centre de commande' },
				{ type: 'toggle', key: 'breadcrumbs.enabled', label: 'Fil d\'Ariane' },
				{ type: 'select', key: 'workbench.editor.showTabs', label: 'Onglets', options: [['multiple', 'Multiples'], ['single', 'Un seul'], ['none', 'Aucun']] },
				{ type: 'button', label: 'Thème d\'icônes de fichiers…', command: 'workbench.action.selectIconTheme' },
			],
		},
		{
			id: 'editor', title: 'Éditeur', controls: [
				{ type: 'select', key: 'editor.fontFamily', label: 'Police du code', options: CODE_FONTS.map(f => [f, f.split(',')[0].replace(/'/g, '')]), custom: true },
				{ type: 'range', key: 'editor.fontSize', label: 'Taille', min: 9, max: 24, unit: 'px' },
				{ type: 'range', key: 'editor.lineHeight', label: 'Interligne', min: 1, max: 2.4, step: 0.1 },
				{ type: 'toggle', key: 'editor.fontLigatures', label: 'Ligatures' },
				{ type: 'select', key: 'editor.cursorStyle', label: 'Curseur', options: [['line', 'Ligne'], ['block', 'Bloc'], ['underline', 'Souligné'], ['line-thin', 'Ligne fine']] },
				{ type: 'select', key: 'editor.cursorBlinking', label: 'Clignotement', options: [['smooth', 'Doux'], ['phase', 'Phase'], ['expand', 'Expansion'], ['blink', 'Classique'], ['solid', 'Fixe']] },
				{ type: 'select', key: 'editor.cursorSmoothCaretAnimation', label: 'Animation du curseur', options: [['on', 'Toujours'], ['explicit', 'Clic seulement'], ['off', 'Non']] },
				{ type: 'toggle', key: 'editor.smoothScrolling', label: 'Défilement fluide' },
				{ type: 'toggle', key: 'editor.minimap.enabled', label: 'Minimap' },
				{ type: 'toggle', key: 'editor.stickyScroll.enabled', label: 'En-têtes collants' },
				{ type: 'select', key: 'editor.wordWrap', label: 'Retour à la ligne', options: [['off', 'Non'], ['on', 'Oui'], ['bounded', 'Limité']] },
				{ type: 'select', key: 'editor.lineNumbers', label: 'Numéros de ligne', options: [['on', 'Oui'], ['relative', 'Relatifs'], ['off', 'Non']] },
				{ type: 'select', key: 'editor.renderWhitespace', label: 'Espaces visibles', options: [['none', 'Non'], ['boundary', 'Bords'], ['selection', 'Sélection'], ['all', 'Tous']] },
				{ type: 'range', key: 'terminal.integrated.fontSize', label: 'Taille du terminal', min: 9, max: 22, unit: 'px' },
			],
		},
		{
			id: 'terminal', title: 'Terminaux', hint: 'Claude tourne dans de vrais terminaux — organise-les comme tu veux.', controls: [
				{ type: 'buttons', label: 'Position des terminaux', buttons: [['workbench.action.positionPanelRight', 'À droite'], ['workbench.action.positionPanelBottom', 'En bas'], ['workbench.action.positionPanelLeft', 'À gauche']] },
				{ type: 'select', key: 'terminal.integrated.tabs.location', label: 'Liste des onglets', options: [['right', 'À droite'], ['left', 'À gauche']] },
				{ type: 'select', key: 'terminal.integrated.tabs.hideCondition', label: 'Afficher la liste', options: [['never', 'Toujours'], ['singleTerminal', 'Si plusieurs terminaux'], ['singleGroup', 'Si plusieurs groupes']] },
				{ type: 'select', key: 'terminal.integrated.fontFamily', label: 'Police', options: [['', 'Comme l\'éditeur'], ...CODE_FONTS.map(f => [f, f.split(',')[0].replace(/'/g, '')])], custom: true },
				{ type: 'range', key: 'terminal.integrated.fontSize', label: 'Taille', min: 9, max: 22, unit: 'px' },
				{ type: 'range', key: 'terminal.integrated.lineHeight', label: 'Interligne', min: 1, max: 1.8, step: 0.05 },
				{ type: 'select', key: 'terminal.integrated.cursorStyle', label: 'Curseur', options: [['block', 'Bloc'], ['line', 'Ligne'], ['underline', 'Souligné']] },
				{ type: 'toggle', key: 'terminal.integrated.cursorBlinking', label: 'Curseur clignotant' },
			],
		},
		{
			id: 'agent', title: 'Claude', hint: 'Lancé avec ton abonnement Claude (connexion Claude Code), pas en paiement à l\'usage.', controls: [
				{ type: 'toggle', key: 'orbit.claude.autoStart', label: 'Lancer Claude à l\'ouverture d\'un projet' },
				{ type: 'select', key: 'orbit.claude.model', label: 'Modèle des nouveaux terminaux', options: 'models' },
				{ type: 'select', key: 'orbit.claude.permissionMode', label: 'Mode de permission', options: 'modes' },
				{ type: 'select', key: 'orbit.inlineEdit.model', label: 'Modèle pour ⌘K', options: 'models' },
				{ type: 'text', key: 'orbit.claude.language', label: 'Langue des réponses', placeholder: 'ex. Français' },
				{ type: 'textarea', key: 'orbit.claude.persona', label: 'Consignes ajoutées à chaque session', hint: 'Ton, conventions, stack… (--append-system-prompt)' },
				{ type: 'text', key: 'orbit.claude.extraArgs', label: 'Options supplémentaires', placeholder: 'ex. --verbose' },
				{ type: 'segmented', key: 'orbit.claude.billing', label: 'Facturation', options: [['subscription', 'Abonnement'], ['apiKey', 'Clé API']] },
				{ type: 'button', label: 'Règles du projet (CLAUDE.md)…', command: 'orbit.editRules' },
			],
		},
		{
			id: 'css', title: 'CSS libre', hint: 'Tout est modifiable. Appliqué en direct à l\'interface entière.', controls: [
				{ type: 'css', key: 'orbit.ui.customCss' },
			],
		},
		{
			id: 'profile', title: 'Profil', hint: 'Partage ta configuration ou restaure-la sur une autre machine.', controls: [
				{ type: 'actions' },
			],
		},
	];

	/** @type {any} */
	let state = { values: {}, themes: [], presets: [], models: [], modes: [], efforts: [] };
	let built = false;

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));

	function build() {
		app.innerHTML = `
			<nav class="side">
				<div class="brand"><span class="logo"></span>Studio</div>
				${SECTIONS.map(s => `<a href="#${s.id}" data-nav="${s.id}">${escape(s.title)}</a>`).join('')}
				<div class="side-foot"><button class="link" data-open-settings>Tous les réglages…</button></div>
			</nav>
			<main class="content">
				${SECTIONS.map(s => `<section id="${s.id}"><h2>${escape(s.title)}</h2>${s.hint ? `<p class="hint">${escape(s.hint)}</p>` : ''}<div class="controls" data-section="${s.id}"></div></section>`).join('')}
			</main>`;
		built = true;
		const content = /** @type {HTMLElement} */ (app.querySelector('.content'));
		content.addEventListener('scroll', () => {
			let current = SECTIONS[0].id;
			for (const s of SECTIONS) {
				const el = /** @type {HTMLElement} */ (document.getElementById(s.id));
				if (el.offsetTop - content.scrollTop < 120) {
					current = s.id;
				}
			}
			document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.getAttribute('data-nav') === current));
		});
	}

	function renderAll() {
		if (!built) {
			build();
		}
		document.documentElement.style.setProperty('--accent', state.accent || '#8b7bff');
		for (const section of SECTIONS) {
			const host = /** @type {HTMLElement} */ (document.querySelector(`[data-section="${section.id}"]`));
			const active = document.activeElement;
			if (active && host.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (active).type === 'text')) {
				continue; // don't clobber what the user is typing
			}
			host.innerHTML = section.controls.map(renderControl).join('');
		}
	}

	/** @param {any} c */
	function renderControl(c) {
		const v = c.key ? state.values[c.key] : undefined;
		switch (c.type) {
			case 'themes': {
				const current = state.values['workbench.colorTheme'];
				const orbit = state.themes.filter((/** @type {any} */ t) => t.orbit);
				const others = state.themes.filter((/** @type {any} */ t) => !t.orbit);
				return `<div class="themes">${orbit.map((/** @type {any} */ t) => `<button class="theme-card ${t.id === current ? 'selected' : ''}" data-theme="${escape(t.id)}"><span class="swatch sw-${escape(t.id.replace(/\s+/g, '-').toLowerCase())}"><i></i><i></i><i></i></span><span>${escape(t.label.replace('Orbit ', ''))}</span></button>`).join('')}</div>
					<div class="row"><label>Autres thèmes</label><select data-key="workbench.colorTheme">${others.map((/** @type {any} */ t) => `<option value="${escape(t.id)}" ${t.id === current ? 'selected' : ''}>${escape(t.label)}</option>`).join('')}${orbit.some((/** @type {any} */ t) => t.id === current) ? '<option selected disabled>— thème Orbit —</option>' : ''}</select><button class="btn small" data-command="workbench.extensions.action.showPopularExtensions">Plus de thèmes…</button></div>`;
			}
			case 'accent': {
				const current = state.accent || '';
				return `<div class="accents">${ACCENTS.map(a => `<button class="accent ${a === current ? 'selected' : ''}" style="background:${a}" data-accent="${a}" title="${a}"></button>`).join('')}
					<label class="accent custom" title="Couleur personnalisée"><input type="color" data-accent-input value="${/^#[0-9a-f]{6}$/i.test(current) ? current : '#8b7bff'}"></label>
					<button class="btn small" data-accent="">Couleurs du thème</button></div>`;
			}
			case 'presets':
				return `<div class="presets">${state.presets.map((/** @type {any} */ p) => `<button class="preset" data-preset="${p.id}"><div class="mini mini-${p.id}"><i></i><i></i><i></i><i></i></div><b>${escape(p.label)}</b><span>${escape(p.detail)}</span></button>`).join('')}</div>`;
			case 'toggle':
				return row(c, `<label class="switch"><input type="checkbox" data-key="${c.key}" ${v ? 'checked' : ''}><span></span></label>`);
			case 'range': {
				const val = Number(v ?? c.min);
				const shown = c.zeroLabel && val === 0 ? c.zeroLabel : `${val}${c.unit || ''}`;
				return row(c, `<input type="range" data-key="${c.key}" data-num min="${c.min}" max="${c.max}" step="${c.step || 1}" value="${val}"><output>${shown}</output>`);
			}
			case 'select': {
				const opts = typeof c.options === 'string'
					? state[c.options].map((/** @type {any} */ o) => [o.id, o.label])
					: c.options;
				const known = opts.some((/** @type {any[]} */ o) => o[0] === v);
				const extra = c.custom && v && !known ? `<option value="${escape(String(v))}" selected>${escape(String(v))}</option>` : '';
				const customInput = c.custom ? `<input type="text" class="custom-in" data-key="${c.key}" placeholder="Autre…" value="">` : '';
				return row(c, `<select data-key="${c.key}">${opts.map((/** @type {any[]} */ [val, label]) => `<option value="${escape(String(val))}" ${val === v ? 'selected' : ''}>${escape(label)}</option>`).join('')}${extra}</select>${customInput}`);
			}
			case 'segmented':
				return row(c, `<div class="seg">${c.options.map((/** @type {string[]} */ [val, label]) => `<button class="${val === v ? 'on' : ''}" data-set="${c.key}" data-value="${val}">${escape(label)}</button>`).join('')}</div>`);
			case 'text':
				return row(c, `<input type="text" data-key="${c.key}" placeholder="${escape(c.placeholder || '')}" value="${escape(String(v ?? ''))}">`);
			case 'buttons':
				return row(c, c.buttons.map((/** @type {string[]} */ [cmd, label]) => `<button class="btn small" data-command="${cmd}">${escape(label)}</button>`).join(''));
			case 'textarea':
				return `<div class="block"><label>${escape(c.label)}</label>${c.hint ? `<div class="hint">${escape(c.hint)}</div>` : ''}<textarea data-key="${c.key}" rows="4">${escape(String(v ?? ''))}</textarea></div>`;
			case 'css':
				return `<textarea class="css" data-key="${c.key}" rows="12" spellcheck="false" placeholder="/* ex. */\n.part.sidebar { background: #0b0b14 !important; }\n.monaco-workbench .tab.active { font-weight: 600; }">${escape(String(v ?? ''))}</textarea><div class="row end"><span class="hint">Appliqué en quittant le champ (ou ⌘⏎)</span></div>`;
			case 'actions':
				return '<div class="row gap"><button class="btn" data-export>Copier mon profil</button><button class="btn" data-import>Importer depuis le presse-papiers</button><button class="btn" data-command="workbench.action.openGlobalKeybindings">Raccourcis clavier…</button></div>';
			case 'button':
				return `<div class="row"><button class="btn small" data-command="${c.command}">${escape(c.label)}</button></div>`;
		}
		return '';
	}

	/** @param {any} c @param {string} control */
	function row(c, control) {
		return `<div class="row"><div class="label"><label>${escape(c.label)}</label>${c.hint ? `<div class="hint">${escape(c.hint)}</div>` : ''}</div><div class="control">${control}</div></div>`;
	}

	/** @param {string} key @param {any} value */
	function set(key, value) {
		state.values[key] = value;
		vscode.postMessage({ type: 'set', key, value });
	}

	app.addEventListener('input', (/** @type {Event} */ e) => {
		const t = /** @type {HTMLInputElement} */ (e.target);
		if (t.type === 'range') {
			const out = t.nextElementSibling;
			if (out) {
				out.textContent = t.value;
			}
		}
	});

	app.addEventListener('change', (/** @type {Event} */ e) => {
		const t = /** @type {HTMLInputElement} */ (e.target);
		if (t.hasAttribute('data-accent-input')) {
			vscode.postMessage({ type: 'accent', color: t.value });
			return;
		}
		const key = t.dataset.key;
		if (!key) {
			return;
		}
		if (t.type === 'checkbox') {
			set(key, t.checked);
		} else if (t.type === 'range' || t.hasAttribute('data-num')) {
			set(key, Number(t.value));
		} else if (t.classList.contains('custom-in')) {
			if (t.value.trim()) {
				set(key, t.value.trim());
			}
		} else {
			set(key, t.value);
		}
	});

	app.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		const t = /** @type {HTMLTextAreaElement} */ (e.target);
		if (t.classList.contains('css') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			set('orbit.ui.customCss', t.value);
		}
	});

	app.addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const t = /** @type {HTMLElement} */ (e.target);
		const theme = t.closest('[data-theme]');
		if (theme) {
			set('workbench.colorTheme', theme.getAttribute('data-theme'));
			return;
		}
		const accent = t.closest('[data-accent]');
		if (accent) {
			vscode.postMessage({ type: 'accent', color: accent.getAttribute('data-accent') || undefined });
			return;
		}
		const preset = t.closest('[data-preset]');
		if (preset) {
			vscode.postMessage({ type: 'preset', id: preset.getAttribute('data-preset') });
			preset.classList.add('flash');
			return;
		}
		const seg = t.closest('[data-set]');
		if (seg) {
			set(String(seg.getAttribute('data-set')), seg.getAttribute('data-value'));
			renderAll();
			return;
		}
		const cmd = t.closest('[data-command]');
		if (cmd) {
			vscode.postMessage({ type: 'command', id: cmd.getAttribute('data-command') });
			return;
		}
		if (t.closest('[data-export]')) {
			vscode.postMessage({ type: 'export' });
		} else if (t.closest('[data-import]')) {
			vscode.postMessage({ type: 'import' });
		} else if (t.closest('[data-open-settings]')) {
			vscode.postMessage({ type: 'openSettings', query: 'orbit' });
		}
	});

	window.addEventListener('message', (/** @type {MessageEvent} */ event) => {
		if (event.data.type === 'state') {
			state = event.data;
			renderAll();
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
