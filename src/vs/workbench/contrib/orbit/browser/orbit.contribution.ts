/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import Severity from '../../../../base/common/severity.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';

/**
 * Orbit UI engine: lets users reshape the workbench chrome (floating panels,
 * rounded corners, UI font, raw CSS) live from settings, without extensions.
 */

const SETTING_FLOATING = 'orbit.ui.floatingPanels';
const SETTING_GAP = 'orbit.ui.panelGap';
const SETTING_RADIUS = 'orbit.ui.cornerRadius';
const SETTING_FONT = 'orbit.ui.fontFamily';
const SETTING_FONT_SIZE = 'orbit.ui.fontSize';
const SETTING_COMPACT = 'orbit.ui.compactTabs';
const SETTING_HIDE_ICONS = 'orbit.ui.minimalChrome';
const SETTING_CSS = 'orbit.ui.customCss';
const SETTING_SPLASH = 'orbit.ui.splashScreen';
const SETTING_WALLPAPER = 'orbit.ui.wallpaper';

/** The launch animation's intro takes this long (ms since navigation start) to play out. */
const SPLASH_MIN_MS = 3000;
/** Keep the finished intro visible at least this long once the workbench is ready. */
const SPLASH_HOLD_MS = 400;

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'orbit.ui',
	order: 1,
	title: nls.localize('orbitUiTitle', "Orbit Interface"),
	type: 'object',
	properties: {
		[SETTING_FLOATING]: {
			type: 'boolean',
			default: true,
			description: nls.localize('orbit.floatingPanels', "Render the side bars, panel and editor as floating rounded cards separated by a gap."),
		},
		[SETTING_GAP]: {
			type: 'number',
			default: 4,
			minimum: 0,
			maximum: 16,
			description: nls.localize('orbit.panelGap', "Gap in pixels between floating panels."),
		},
		[SETTING_RADIUS]: {
			type: 'number',
			default: 10,
			minimum: 0,
			maximum: 24,
			description: nls.localize('orbit.cornerRadius', "Corner radius in pixels of panels, inputs, buttons and widgets."),
		},
		[SETTING_FONT]: {
			type: 'string',
			default: '',
			description: nls.localize('orbit.fontFamily', "Font family used by the whole interface (not the editor). Empty keeps the system font."),
		},
		[SETTING_FONT_SIZE]: {
			type: 'number',
			default: 0,
			minimum: 0,
			maximum: 20,
			description: nls.localize('orbit.fontSize', "Font size of the interface in pixels. 0 keeps the default."),
		},
		[SETTING_COMPACT]: {
			type: 'boolean',
			default: false,
			description: nls.localize('orbit.compactTabs', "Use slimmer pill-shaped editor tabs."),
		},
		[SETTING_HIDE_ICONS]: {
			type: 'boolean',
			default: false,
			description: nls.localize('orbit.minimalChrome', "Hide borders and separators for a distraction free look."),
		},
		[SETTING_WALLPAPER]: {
			type: 'string',
			default: 'cosmos',
			markdownDescription: nls.localize('orbit.wallpaper', "Image painted behind the whole interface: `cosmos` for the Orbit space scene, `none`, or an absolute path to your own image. Visible through translucent themes such as Orbit Cosmos."),
		},
		[SETTING_SPLASH]: {
			type: 'boolean',
			default: true,
			description: nls.localize('orbit.splashScreen', "Show the animated Orbit launch screen while the window loads."),
		},
		[SETTING_CSS]: {
			type: 'string',
			default: '',
			editPresentation: 'multilineText' as never,
			markdownDescription: nls.localize('orbit.customCss', "Raw CSS injected into the workbench and applied live. Target any element, e.g. `.part.sidebar { background: #0b0b14 }`."),
		},
	}
});

class OrbitUiContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.orbitUi';

	private readonly styleElement: HTMLStyleElement;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();

		this.dismissSplash(lifecycleService);

		this.styleElement = createStyleSheet(mainWindow.document.head, undefined, this._store);
		this.styleElement.id = 'orbit-ui-engine';
		this.render();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('orbit.ui')) {
				this.render();
			}
		}));
	}

	private async dismissSplash(lifecycleService: ILifecycleService): Promise<void> {
		const splash = mainWindow.document.getElementById('orbit-splash');
		if (!splash) {
			return;
		}
		if (!this.configurationService.getValue<boolean>(SETTING_SPLASH)) {
			splash.remove();
			return;
		}
		await lifecycleService.when(LifecyclePhase.Restored);
		const wait = Math.max(SPLASH_MIN_MS - mainWindow.performance.now(), SPLASH_HOLD_MS);
		await new Promise(resolve => mainWindow.setTimeout(resolve, wait));
		splash.classList.add('orbit-splash-out');
		mainWindow.setTimeout(() => {
			splash.remove();
			mainWindow.document.getElementById('orbit-splash-style')?.remove();
		}, 800);
	}

	private render(): void {
		const get = <T>(key: string) => this.configurationService.getValue<T>(key);
		const radius = clamp(get<number>(SETTING_RADIUS) ?? 10, 0, 24);
		const gap = clamp(get<number>(SETTING_GAP) ?? 4, 0, 16);
		const rules: string[] = [];

		rules.push(`
.monaco-workbench .monaco-inputbox, .monaco-workbench .monaco-button, .monaco-workbench .monaco-select-box,
.monaco-workbench .quick-input-widget, .monaco-workbench .monaco-menu .monaco-action-bar,
.monaco-workbench .notification-toast, .monaco-workbench .suggest-widget, .monaco-workbench .monaco-hover,
.monaco-workbench .find-widget, .monaco-workbench .context-view .monaco-menu { border-radius: ${Math.min(radius, 12)}px !important; }
.monaco-workbench .quick-input-widget { overflow: hidden; }
.monaco-workbench .monaco-list .monaco-list-row { border-radius: ${Math.min(radius, 8)}px; }`);

		if (get<boolean>(SETTING_FLOATING)) {
			// clip-path keeps the grid layout untouched while visually detaching each part.
			rules.push(`
.monaco-workbench { background-color: var(--vscode-titleBar-activeBackground) !important; }
.monaco-workbench .part.sidebar, .monaco-workbench .part.auxiliarybar, .monaco-workbench .part.panel,
.monaco-workbench .part.editor { clip-path: inset(${gap / 2}px round ${radius}px); }
.monaco-workbench .part.editor > .content { padding: ${gap / 2}px; box-sizing: border-box; }
.monaco-workbench .part.sidebar > .title, .monaco-workbench .part.auxiliarybar > .title { padding-top: ${gap / 2}px; }
.monaco-workbench .part.activitybar, .monaco-workbench .part.statusbar, .monaco-workbench .part.titlebar { border: none !important; }
.monaco-workbench .part > .content > .monaco-split-view2 > .sash-container > .monaco-sash, .monaco-workbench .monaco-grid-view .monaco-sash { opacity: 0; }`);
		}

		const font = (get<string>(SETTING_FONT) ?? '').trim();
		if (font) {
			rules.push(`.monaco-workbench, .monaco-workbench .monaco-action-bar, .monaco-workbench .monaco-list, .monaco-workbench .quick-input-widget { font-family: ${sanitize(font)}, -apple-system, system-ui, sans-serif !important; }`);
		}
		const fontSize = get<number>(SETTING_FONT_SIZE) ?? 0;
		if (fontSize > 0) {
			rules.push(`.monaco-workbench .part:not(.editor) { font-size: ${clamp(fontSize, 9, 20)}px; }`);
		}

		if (get<boolean>(SETTING_COMPACT)) {
			rules.push(`
.monaco-workbench .part.editor .tabs-container > .tab { margin: 5px 2px; height: 26px !important; border-radius: ${Math.min(radius, 8)}px; border: none !important; }
.monaco-workbench .part.editor .tabs-container > .tab .tab-border-top-container { display: none; }`);
		}

		if (get<boolean>(SETTING_HIDE_ICONS)) {
			rules.push(`
.monaco-workbench .part, .monaco-workbench .pane-header, .monaco-workbench .tabs-and-actions-container,
.monaco-workbench .editor-group-container > .title { border-color: transparent !important; box-shadow: none !important; }
.monaco-workbench .pane-composite-part .split-view-view:not(:first-child) > .pane > .pane-header { border-top: none !important; }`);
		}

		const wallpaper = (get<string>(SETTING_WALLPAPER) ?? 'cosmos').trim();
		if (wallpaper && wallpaper !== 'none') {
			const url = wallpaper === 'cosmos'
				? FileAccess.asBrowserUri('vs/workbench/contrib/orbit/browser/media/cosmos.jpg').toString(true)
				: FileAccess.uriToBrowserUri(URI.file(wallpaper)).toString(true);
			rules.push(`.monaco-workbench { background-image: url("${url.replace(/"/g, '%22')}") !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; }`);
			// Only each part keeps the theme's (translucent) colour; layers inside it would stack up and hide the wallpaper.
			rules.push(`
.monaco-workbench .monaco-grid-view, .monaco-workbench .part .pane, .monaco-workbench .part.editor > .content,
.monaco-workbench .part.editor .editor-group-container, .monaco-workbench .part.editor .editor-group-container > .editor-container,
.monaco-workbench .part.editor .monaco-editor, .monaco-workbench .part.editor .monaco-editor-background, .monaco-workbench .part.editor .monaco-editor .margin,
.monaco-workbench .part.editor .gettingStartedContainer, .monaco-workbench .part.panel .terminal-wrapper, .monaco-workbench .part.panel .xterm .xterm-viewport { background-color: transparent !important; }`);
		}

		const custom = get<string>(SETTING_CSS) ?? '';
		this.styleElement.textContent = rules.join('\n') + '\n/* user css */\n' + custom;
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Number(value) || 0));
}

function sanitize(font: string): string {
	return font.replace(/[;{}<>]/g, '');
}

registerWorkbenchContribution2(OrbitUiContribution.ID, OrbitUiContribution, WorkbenchPhase.BlockRestore);

type OrbitAgentStatus = 'running' | 'waiting' | 'done' | 'idle';

const AGENT_STATUS_ID = 'orbit.agent';
const AGENT_STATUS: Record<OrbitAgentStatus, { icon: ThemeIcon; severity: Severity }> = {
	running: { icon: ThemeIcon.modify(Codicon.loading, 'spin'), severity: Severity.Info },
	waiting: { icon: Codicon.bellDot, severity: Severity.Warning },
	done: { icon: Codicon.passFilled, severity: Severity.Info },
	idle: { icon: Codicon.sparkle, severity: Severity.Ignore },
};

function findTerminal(accessor: ServicesAccessor, processId: unknown) {
	return accessor.get(ITerminalService).instances.find(i => i.processId === processId);
}

/** Lets the Orbit extension show what each Claude agent is doing directly on its terminal tab. */
CommandsRegistry.registerCommand('_orbit.setTerminalStatus', (accessor, processId: number, status: OrbitAgentStatus | undefined, tooltip?: string) => {
	const instance = findTerminal(accessor, processId);
	if (!instance) {
		return false;
	}
	instance.statusList.remove(AGENT_STATUS_ID);
	const spec = status && AGENT_STATUS[status];
	if (spec) {
		instance.statusList.add({ id: AGENT_STATUS_ID, icon: spec.icon, severity: spec.severity, tooltip });
	}
	return true;
});

CommandsRegistry.registerCommand('_orbit.renameTerminal', async (accessor, processId: number, title: string) => {
	const instance = findTerminal(accessor, processId);
	if (instance && title) {
		await instance.rename(title);
		return true;
	}
	return false;
});
