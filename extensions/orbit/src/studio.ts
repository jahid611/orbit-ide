/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistantId } from './assistant';
import { models, modes } from './config';

/** The model and extra arguments shown in the Studio are those of the assistant in use. */
function realKey(key: string): string {
	return assistantId() === 'chatgpt' && (key === 'orbit.claude.model' || key === 'orbit.claude.extraArgs') ? key.replace('.claude.', '.chatgpt.') : key;
}
import { renderWebview, webviewOptions } from './webview';

/** Every setting the studio can edit, grouped as shown in the UI. */
const STUDIO_KEYS = [
	'workbench.colorTheme', 'workbench.iconTheme', 'window.zoomLevel', 'orbit.ui.wallpaper',
	'orbit.ui.floatingPanels', 'orbit.ui.panelGap', 'orbit.ui.cornerRadius', 'orbit.ui.fontFamily', 'orbit.ui.fontSize',
	'orbit.ui.compactTabs', 'orbit.ui.minimalChrome', 'orbit.ui.glass', 'orbit.ui.animations', 'orbit.ui.customCss',
	'workbench.activityBar.location', 'workbench.sideBar.location', 'workbench.statusBar.visible', 'window.commandCenter',
	'breadcrumbs.enabled', 'workbench.editor.showTabs', 'workbench.layoutControl.enabled',
	'editor.fontFamily', 'editor.fontSize', 'editor.lineHeight', 'editor.fontLigatures', 'editor.cursorStyle',
	'editor.cursorBlinking', 'editor.cursorSmoothCaretAnimation', 'editor.minimap.enabled', 'editor.wordWrap',
	'editor.renderWhitespace', 'editor.lineNumbers', 'editor.stickyScroll.enabled', 'editor.smoothScrolling',
	'terminal.integrated.fontSize', 'terminal.integrated.fontFamily',
	'terminal.integrated.lineHeight', 'terminal.integrated.cursorStyle', 'terminal.integrated.cursorBlinking',
	'terminal.integrated.tabs.location', 'terminal.integrated.tabs.hideCondition',
	'orbit.claude.model', 'orbit.claude.permissionMode', 'orbit.claude.language', 'orbit.claude.persona',
	'orbit.claude.extraArgs', 'orbit.claude.autoStart', 'orbit.claude.billing', 'orbit.inlineEdit.model',
];

export const LAYOUT_PRESETS: Record<string, { label: string; detail: string; settings: Record<string, unknown> }> = {
	cursor: {
		label: 'Cursor',
		detail: 'Explorateur à gauche, agent à droite, barre d\'activité en haut',
		settings: {
			'workbench.activityBar.location': 'top', 'workbench.sideBar.location': 'left', 'orbit.ui.floatingPanels': false,
			'orbit.ui.minimalChrome': false, 'orbit.ui.cornerRadius': 6, 'workbench.statusBar.visible': true, 'orbit.ui.compactTabs': false,
		},
	},
	antigravity: {
		label: 'Antigravity',
		detail: 'Panneaux flottants arrondis, interface épurée, l\'agent au centre',
		settings: {
			'workbench.activityBar.location': 'top', 'workbench.sideBar.location': 'left', 'orbit.ui.floatingPanels': true,
			'orbit.ui.panelGap': 8, 'orbit.ui.cornerRadius': 14, 'orbit.ui.minimalChrome': true, 'orbit.ui.compactTabs': true,
			'workbench.statusBar.visible': true, 'breadcrumbs.enabled': false,
		},
	},
	zen: {
		label: 'Zen',
		detail: 'Le code et rien d\'autre',
		settings: {
			'workbench.activityBar.location': 'hidden', 'workbench.statusBar.visible': false, 'orbit.ui.floatingPanels': true,
			'orbit.ui.panelGap': 4, 'orbit.ui.minimalChrome': true, 'breadcrumbs.enabled': false, 'editor.minimap.enabled': false,
			'window.commandCenter': false, 'workbench.layoutControl.enabled': false,
		},
	},
	classic: {
		label: 'Classique',
		detail: 'La disposition VS Code d\'origine',
		settings: {
			'workbench.activityBar.location': 'default', 'workbench.sideBar.location': 'left', 'orbit.ui.floatingPanels': false,
			'orbit.ui.minimalChrome': false, 'orbit.ui.compactTabs': false, 'orbit.ui.cornerRadius': 4, 'workbench.statusBar.visible': true,
			'breadcrumbs.enabled': true,
		},
	},
};

const ACCENT_KEYS = [
	'focusBorder', 'button.background', 'progressBar.background', 'textLink.foreground', 'activityBarBadge.background',
	'badge.background', 'tab.activeBorderTop', 'activityBar.activeBorder', 'panelTitle.activeBorder', 'inputOption.activeBorder',
	'statusBarItem.remoteBackground', 'editorCursor.foreground', 'pickerGroup.foreground', 'list.highlightForeground',
];

export async function applyPreset(id: string): Promise<void> {
	const preset = LAYOUT_PRESETS[id];
	if (!preset) {
		return;
	}
	const config = vscode.workspace.getConfiguration();
	for (const [key, value] of Object.entries(preset.settings)) {
		await config.update(key, value, vscode.ConfigurationTarget.Global);
	}
}

/** Full-page visual editor for themes, layout, editor and agent preferences. */
export class StudioPanel implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly extensionUri: vscode.Uri) {
		this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
			if (STUDIO_KEYS.some(k => e.affectsConfiguration(k)) || e.affectsConfiguration('workbench.colorCustomizations')) {
				this.sendState();
			}
		}));
	}

	show(): void {
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		this.panel = vscode.window.createWebviewPanel('orbit.studio', 'Studio', vscode.ViewColumn.Active, { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true });
		this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'orbit.svg');
		this.panel.webview.html = renderWebview(this.panel.webview, this.extensionUri, 'studio');
		// Listeners of this panel only, freed with it so reopening does not pile them up.
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
		});
	}

	dispose(): void {
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		const config = vscode.workspace.getConfiguration();
		switch (msg.type) {
			case 'ready':
				this.sendState();
				break;
			case 'set':
				if (STUDIO_KEYS.includes(msg.key)) {
					await config.update(realKey(msg.key), msg.value, vscode.ConfigurationTarget.Global);
				}
				break;
			case 'reset':
				if (STUDIO_KEYS.includes(msg.key)) {
					await config.update(realKey(msg.key), undefined, vscode.ConfigurationTarget.Global);
				}
				break;
			case 'accent':
				await this.applyAccent(msg.color);
				break;
			case 'preset':
				await applyPreset(msg.id);
				break;
			case 'export': {
				const profile: Record<string, unknown> = {};
				for (const key of STUDIO_KEYS) {
					const inspected = config.inspect(key);
					if (inspected?.globalValue !== undefined) {
						profile[key] = inspected.globalValue;
					}
				}
				profile['workbench.colorCustomizations'] = config.get('workbench.colorCustomizations');
				await vscode.env.clipboard.writeText(JSON.stringify(profile, null, 2));
				vscode.window.showInformationMessage('Profil Orbit copié dans le presse-papiers.');
				break;
			}
			case 'import': {
				try {
					const profile = JSON.parse(await vscode.env.clipboard.readText()) as Record<string, unknown>;
					for (const [key, value] of Object.entries(profile)) {
						if (STUDIO_KEYS.includes(key) || key === 'workbench.colorCustomizations') {
							await config.update(key, value, vscode.ConfigurationTarget.Global);
						}
					}
					vscode.window.showInformationMessage('Profil Orbit importé.');
				} catch {
					vscode.window.showErrorMessage('Le presse-papiers ne contient pas un profil Orbit valide (JSON).');
				}
				break;
			}
			case 'openSettings':
				await vscode.commands.executeCommand('workbench.action.openSettings', msg.query ?? 'orbit');
				break;
			case 'command':
				if (['workbench.action.positionPanelRight', 'workbench.action.positionPanelBottom', 'workbench.action.positionPanelLeft', 'workbench.action.selectTheme', 'workbench.action.selectIconTheme', 'workbench.action.openGlobalKeybindings', 'workbench.extensions.action.showPopularExtensions', 'orbit.editRules'].includes(msg.id)) {
					await vscode.commands.executeCommand(msg.id);
				}
				break;
		}
	}

	private async applyAccent(color: string | undefined): Promise<void> {
		const config = vscode.workspace.getConfiguration();
		const current = { ...(config.get<Record<string, string>>('workbench.colorCustomizations') ?? {}) };
		for (const key of ACCENT_KEYS) {
			delete current[key];
		}
		if (color) {
			for (const key of ACCENT_KEYS) {
				current[key] = color;
			}
			current['button.foreground'] = '#ffffff';
			current['badge.foreground'] = '#ffffff';
			current['activityBarBadge.foreground'] = '#ffffff';
		} else {
			delete current['button.foreground'];
			delete current['badge.foreground'];
			delete current['activityBarBadge.foreground'];
		}
		await config.update('workbench.colorCustomizations', current, vscode.ConfigurationTarget.Global);
	}

	private sendState(): void {
		if (!this.panel) {
			return;
		}
		const config = vscode.workspace.getConfiguration();
		const values: Record<string, unknown> = {};
		for (const key of STUDIO_KEYS) {
			values[key] = config.get(realKey(key));
		}
		const themes = vscode.extensions.all.flatMap(ext => {
			const contributed = (ext.packageJSON?.contributes?.themes ?? []) as { label?: string; id?: string; uiTheme?: string }[];
			return contributed.map(t => ({ id: t.id ?? t.label ?? '', label: t.label ?? t.id ?? '', kind: t.uiTheme ?? 'vs-dark', orbit: ext.id === 'vscode.orbit' }));
		}).filter(t => t.id);
		const accent = (config.get<Record<string, string>>('workbench.colorCustomizations') ?? {})['focusBorder'];
		this.panel.webview.postMessage({
			type: 'state',
			values,
			accent,
			themes,
			presets: Object.entries(LAYOUT_PRESETS).map(([id, p]) => ({ id, label: p.label, detail: p.detail })),
			models: models(),
			modes: modes(),
		});
	}
}
