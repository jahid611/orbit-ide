/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
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
const SETTING_GLASS = 'orbit.ui.glass';
const SETTING_MOTION = 'orbit.ui.animations';

/** Claude's brand orange, used wherever Orbit shows something that belongs to Claude. */
const CLAUDE_ORANGE = '#d97757';
/** Claude's mark (Simple Icons, CC0), drawn in Claude's orange next to everything Claude does. */
const CLAUDE_MARK = 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';

/** The launch video (5 s) plays at least this long (ms since navigation start) to play out. */
const SPLASH_MIN_MS = 4200;
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
			default: true,
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
		[SETTING_GLASS]: {
			type: 'boolean',
			default: true,
			description: nls.localize('orbit.glass', "Blur what lies behind panels, menus and pickers, like frosted glass. Turn off on slow graphics hardware."),
		},
		[SETTING_MOTION]: {
			type: 'boolean',
			default: true,
			description: nls.localize('orbit.animations', "Animate hover states and the arrival of menus, pickers and notifications."),
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

		const glass = get<boolean>(SETTING_GLASS) ?? true;
		const blur = (px: number) => glass ? `-webkit-backdrop-filter: blur(${px}px) saturate(140%); backdrop-filter: blur(${px}px) saturate(140%);` : '';

		// Finish: crisp type, quiet chrome, soft focus rings.
		rules.push(`
.monaco-workbench { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
.monaco-workbench .quick-input-widget { ${blur(32)} border: 1px solid rgba(128, 128, 160, .22) !important; box-shadow: 0 28px 90px rgba(0, 0, 0, .55) !important; }
.monaco-workbench .context-view .monaco-menu-container .monaco-menu, .monaco-workbench .notification-toast { ${blur(28)} border: 1px solid rgba(128, 128, 160, .2); box-shadow: 0 18px 60px rgba(0, 0, 0, .5); }
.monaco-workbench .monaco-inputbox.synthetic-focus, .monaco-workbench .monaco-inputbox:focus-within { box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-focusBorder) 24%, transparent); }
.monaco-workbench .monaco-button { font-weight: 500; letter-spacing: .1px; }
.monaco-workbench .monaco-text-button:not(.disabled):hover { box-shadow: 0 4px 18px color-mix(in srgb, var(--vscode-button-background) 38%, transparent); }
.monaco-workbench .part.titlebar .command-center .command-center-center { border-radius: ${Math.min(radius, 9)}px !important; border-color: rgba(128, 128, 160, .2) !important; background: rgba(128, 128, 160, .1) !important; }
.monaco-workbench .part.titlebar .command-center .command-center-center:hover { background: rgba(128, 128, 160, .18) !important; }
.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider { border-radius: 8px; }
.monaco-workbench .part.sidebar .pane-header { font-weight: 600; letter-spacing: .2px; }
.monaco-workbench .part.statusbar { font-size: 11.5px; }
.monaco-workbench .part.statusbar .statusbar-item > .statusbar-item-label { border-radius: 6px; }
.monaco-workbench .part.panel .terminal-outer-container .xterm { padding-left: 14px; }`);

		// Usage card (see `_orbit.showUsage`), in Claude's own orange.
		rules.push(`
.orbit-usage { width: 360px; box-sizing: border-box; padding: 16px 18px 14px; border-radius: ${Math.max(radius, 12)}px; ${blur(30)}
	background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, transparent); border: 1px solid rgba(128, 128, 160, .24);
	box-shadow: 0 24px 80px rgba(0, 0, 0, .6); color: var(--vscode-foreground); font-size: 12.5px; animation: orbit-usage-in .18s cubic-bezier(.2, .8, .2, 1); }
@keyframes orbit-usage-in { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
.orbit-usage-head { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.orbit-usage-mark { width: 18px; height: 18px; flex: none; fill: ${CLAUDE_ORANGE}; }
.orbit-usage-close { margin-left: 6px; width: 24px; height: 24px; border-radius: 7px; border: none; cursor: pointer; font-size: 16px; line-height: 1; color: var(--vscode-descriptionForeground); background: transparent; transition: background-color .14s ease, color .14s ease; }
.orbit-usage-close:hover { color: var(--vscode-foreground); background: rgba(128, 128, 160, .18); }
.orbit-usage-title { font-weight: 600; font-size: 13.5px; }
.orbit-usage-plan { margin-left: auto; color: ${CLAUDE_ORANGE}; background: color-mix(in srgb, ${CLAUDE_ORANGE} 16%, transparent); border-radius: 999px; padding: 2px 10px; font-weight: 600; font-size: 11px; }
.orbit-usage-row { margin-bottom: 15px; }
.orbit-usage-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 7px; }
.orbit-usage-label { font-weight: 500; }
.orbit-usage-percent { color: ${CLAUDE_ORANGE}; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.orbit-usage-track { height: 8px; border-radius: 99px; background: color-mix(in srgb, ${CLAUDE_ORANGE} 15%, transparent); overflow: hidden; }
.orbit-usage-fill { height: 100%; width: 0; border-radius: 99px; background: linear-gradient(90deg, #c96442, #eb9a78); transition: width .6s cubic-bezier(.2, .8, .2, 1); }
.orbit-usage-row.high .orbit-usage-fill { background: linear-gradient(90deg, #e5484d, #ff8a8a); }
.orbit-usage-row.high .orbit-usage-percent { color: #ff8a8a; }
.orbit-usage-detail { margin-top: 6px; color: var(--vscode-descriptionForeground); font-size: 11.5px; }
.orbit-usage-section { margin: 2px 0 12px; padding-top: 13px; border-top: 1px solid rgba(128, 128, 160, .18); color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .7px; font-size: 10.5px; font-weight: 600; }
.orbit-usage-row.small { margin-bottom: 10px; }
.orbit-usage-row.small .orbit-usage-track { height: 5px; }
.orbit-usage-row.small .orbit-usage-line { margin-bottom: 5px; }
.orbit-usage-error { color: var(--vscode-descriptionForeground); line-height: 1.5; margin-bottom: 12px; }
.orbit-usage-actions { display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid rgba(128, 128, 160, .18); }
.orbit-usage-actions button { flex: 1; font: inherit; font-weight: 500; cursor: pointer; padding: 6px 8px; border-radius: 8px; color: #eb9a78;
	background: color-mix(in srgb, ${CLAUDE_ORANGE} 12%, transparent); border: 1px solid color-mix(in srgb, ${CLAUDE_ORANGE} 34%, transparent); transition: background-color .14s ease; }
.orbit-usage-actions button:hover { background: color-mix(in srgb, ${CLAUDE_ORANGE} 24%, transparent); }`);

		if (get<boolean>(SETTING_MOTION) ?? true) {
			// Virtualised list rows are left alone: recycled rows would flash while scrolling.
			rules.push(`
@keyframes orbit-pop { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes orbit-fade { from { opacity: 0; } to { opacity: 1; } }
.monaco-workbench .tab, .monaco-workbench .action-label, .monaco-workbench .monaco-button, .monaco-workbench .statusbar-item > .statusbar-item-label,
.monaco-workbench .monaco-inputbox, .monaco-workbench .command-center-center, .monaco-workbench .composite-bar .action-item {
	transition: background-color .14s ease, color .14s ease, border-color .14s ease, box-shadow .14s ease, opacity .14s ease; }
.monaco-workbench .quick-input-widget { animation: orbit-pop .18s cubic-bezier(.2, .8, .2, 1); }
.monaco-workbench .context-view .monaco-menu-container, .monaco-workbench .monaco-hover, .monaco-workbench .notification-toast, .monaco-workbench .suggest-widget { animation: orbit-fade .12s ease-out; }
@media (prefers-reduced-motion: reduce) { .monaco-workbench *, .monaco-workbench *::before, .monaco-workbench *::after { animation-duration: 0s !important; transition-duration: 0s !important; } }`);
		}

		if (get<boolean>(SETTING_FLOATING)) {
			// clip-path keeps the grid layout untouched while visually detaching each part.
			rules.push(`
.monaco-workbench { background-color: var(--vscode-titleBar-activeBackground) !important; }
.monaco-workbench .part.sidebar, .monaco-workbench .part.auxiliarybar, .monaco-workbench .part.panel,
.monaco-workbench .part.editor { clip-path: inset(${gap / 2}px round ${radius}px); }
.monaco-workbench .part.editor > .content { padding: ${gap / 2}px; box-sizing: border-box; }
.monaco-workbench .part.sidebar > .title, .monaco-workbench .part.auxiliarybar > .title { padding-top: ${gap / 2}px; }
.monaco-workbench .part.activitybar, .monaco-workbench .part.statusbar, .monaco-workbench .part.titlebar { border: none !important; }
.monaco-workbench .part > .content > .monaco-split-view2 > .sash-container > .monaco-sash, .monaco-workbench .monaco-grid-view .monaco-sash { opacity: 0; }
.monaco-workbench .part.sidebar, .monaco-workbench .part.auxiliarybar, .monaco-workbench .part.panel, .monaco-workbench .part.editor { ${blur(26)} }
.monaco-workbench .part.sidebar::after, .monaco-workbench .part.auxiliarybar::after, .monaco-workbench .part.panel::after, .monaco-workbench .part.editor::after {
	content: ''; position: absolute; inset: ${gap / 2}px; border-radius: ${radius}px; pointer-events: none; z-index: 40;
	border: 1px solid rgba(128, 128, 160, .16); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .04); }`);
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

		// StarCapture and NovaGame keep their own colours in the activity bar instead of a tinted silhouette.
		const logos: [string, string][] = [
			['starcapture', FileAccess.asBrowserUri('vs/workbench/contrib/orbit/browser/media/starcapture.png').toString(true)],
			['novagame', FileAccess.asBrowserUri('vs/workbench/contrib/orbit/browser/media/novagame.png').toString(true)],
		];
		for (const [id, logo] of logos) {
			rules.push(`
.monaco-workbench .activitybar .action-label[class*="activity-workbench-view-extension-${id}"] { -webkit-mask: none !important; mask: none !important; background: url("${logo}") center / 30px no-repeat !important; }
.monaco-workbench .activitybar .action-item:not(.checked):not(:hover) .action-label[class*="activity-workbench-view-extension-${id}"] { opacity: .8; }`);
		}

		const wallpaper = (get<string>(SETTING_WALLPAPER) ?? 'cosmos').trim();
		if (wallpaper && wallpaper !== 'none') {
			const url = wallpaper === 'cosmos'
				? FileAccess.asBrowserUri('vs/workbench/contrib/orbit/browser/media/cosmos.jpg').toString(true)
				: FileAccess.uriToBrowserUri(URI.file(wallpaper)).toString(true);
			rules.push(`.monaco-workbench { background-image: url("${url.replace(/"/g, '%22')}") !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; }`);
			// A veil in the theme's own colour calms the image, so the gaps between cards never flash bright.
			rules.push(`.monaco-workbench::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; background: color-mix(in srgb, var(--vscode-editor-background) 34%, transparent); }`);
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

interface IOrbitUsageRow {
	readonly label: string;
	readonly percent: number;
	readonly detail?: string;
}

interface IOrbitUsageCard {
	readonly title: string;
	readonly plan?: string;
	readonly rows: readonly IOrbitUsageRow[];
	readonly breakdownTitle?: string;
	readonly breakdown?: readonly IOrbitUsageRow[];
	readonly error?: string;
	readonly actions?: readonly { readonly label: string; readonly command: string }[];
	/** `aria-label` prefix of the toolbar button the card drops from. */
	readonly anchorLabel?: string;
}

function renderUsageRow(parent: HTMLElement, row: IOrbitUsageRow, small: boolean): void {
	const percent = clamp(row.percent, 0, 100);
	const element = append(parent, $('.orbit-usage-row'));
	element.classList.toggle('small', small);
	// Only real limits turn red when nearly spent; the breakdown is a share, not a limit.
	element.classList.toggle('high', !small && percent >= 90);
	const line = append(element, $('.orbit-usage-line'));
	append(line, $('span.orbit-usage-label')).textContent = row.label;
	append(line, $('span.orbit-usage-percent')).textContent = `${Math.round(percent)} %`;
	const fill = append(append(element, $('.orbit-usage-track')), $('.orbit-usage-fill'));
	// Let the bar grow from empty once the card is on screen.
	mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => { fill.style.width = `${percent}%`; }));
	if (row.detail) {
		append(element, $('.orbit-usage-detail')).textContent = row.detail;
	}
}

/** Shows the plan usage the Orbit extension collected as a card dropping from its toolbar button. */
CommandsRegistry.registerCommand('_orbit.showUsage', (accessor, card: IOrbitUsageCard) => {
	const contextViewService = accessor.get(IContextViewService);
	const commandService = accessor.get(ICommandService);
	const buttons = card.anchorLabel ? mainWindow.document.querySelectorAll<HTMLElement>(`.action-label[aria-label^="${card.anchorLabel.replace(/["\\]/g, '')}"]`) : [];
	const button = Array.from(buttons).find(candidate => candidate.offsetParent !== null);
	contextViewService.showContextView({
		getAnchor: () => button ?? { x: Math.max(0, mainWindow.innerWidth - 400), y: 64 },
		anchorAlignment: AnchorAlignment.RIGHT,
		render: container => {
			const store = new DisposableStore();
			const root = append(container, $('.orbit-usage'));
			const head = append(root, $('.orbit-usage-head'));
			const mark = mainWindow.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			mark.setAttribute('viewBox', '0 0 24 24');
			mark.setAttribute('class', 'orbit-usage-mark');
			const markPath = mainWindow.document.createElementNS('http://www.w3.org/2000/svg', 'path');
			markPath.setAttribute('d', CLAUDE_MARK);
			mark.appendChild(markPath);
			head.appendChild(mark);
			append(head, $('span.orbit-usage-title')).textContent = card.title;
			if (card.plan) {
				append(head, $('span.orbit-usage-plan')).textContent = card.plan;
			}
			const close = append(head, $('button.orbit-usage-close'));
			append(close, $('span')).className = ThemeIcon.asClassName(Codicon.close);
			close.title = nls.localize('orbit.usage.close', "Close");
			store.add(addDisposableListener(close, EventType.CLICK, () => contextViewService.hideContextView()));
			// The card also goes away with Escape or a click anywhere else, like any popover.
			store.add(addDisposableListener(mainWindow.document, EventType.KEY_DOWN, (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					contextViewService.hideContextView();
				}
			}, true));
			store.add(addDisposableListener(mainWindow.document, EventType.MOUSE_DOWN, (e: MouseEvent) => {
				if (!root.contains(e.target as Node)) {
					contextViewService.hideContextView();
				}
			}, true));
			if (card.error) {
				append(root, $('.orbit-usage-error')).textContent = card.error;
			}
			for (const row of card.rows) {
				renderUsageRow(root, row, false);
			}
			if (card.breakdown?.length) {
				append(root, $('.orbit-usage-section')).textContent = card.breakdownTitle ?? '';
				for (const row of card.breakdown) {
					renderUsageRow(root, row, true);
				}
			}
			if (card.actions?.length) {
				const actions = append(root, $('.orbit-usage-actions'));
				for (const action of card.actions) {
					const element = append(actions, $('button'));
					element.textContent = action.label;
					store.add(addDisposableListener(element, EventType.CLICK, () => {
						contextViewService.hideContextView();
						commandService.executeCommand(action.command);
					}));
				}
			}
			return store;
		},
	});
	return true;
});

interface IOrbitTourStep {
	readonly index: number;
	readonly total: number;
	readonly chapter?: string;
	readonly title: string;
	readonly body: string;
	/** Keyboard shortcut of the feature, shown as a chip. */
	readonly keys?: string;
	/** CSS selector of the element the step talks about: a ring is drawn around it. */
	readonly target?: string;
	readonly labels: { readonly next: string; readonly previous: string; readonly stop: string };
	readonly commands: { readonly next: string; readonly previous: string; readonly stop: string };
}

const ORBIT_TOUR_CSS = `
.orbit-tour { position: fixed; z-index: 2600; left: 50%; bottom: 46px; width: 460px; max-width: calc(100vw - 32px); margin-left: -230px; box-sizing: border-box; padding: 16px 18px 14px; border-radius: 16px; color: var(--vscode-foreground); font-size: 13px; line-height: 1.5;
	background: color-mix(in srgb, var(--vscode-editorWidget-background, #14132a) 86%, transparent); backdrop-filter: blur(28px) saturate(1.3); border: 1px solid color-mix(in srgb, #8b7bff 45%, transparent);
	box-shadow: 0 28px 90px rgba(0, 0, 0, .65), 0 0 0 4px color-mix(in srgb, #8b7bff 12%, transparent); animation: orbit-tour-in .28s cubic-bezier(.2, .8, .2, 1); }
@keyframes orbit-tour-in { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: none; } }
.orbit-tour-head { display: flex; align-items: center; gap: 10px; cursor: grab; user-select: none; }
.orbit-tour-chapter { padding: 2px 9px; border-radius: 99px; font-size: 11px; font-weight: 600; letter-spacing: .02em; color: #c9c1ff; background: color-mix(in srgb, #8b7bff 22%, transparent); }
.orbit-tour-count { margin-left: auto; font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
.orbit-tour-track { height: 3px; margin: 11px 0 13px; border-radius: 3px; background: rgba(128, 128, 160, .2); overflow: hidden; }
.orbit-tour-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #8b7bff, #5eead4); transition: width .35s cubic-bezier(.2, .8, .2, 1); }
.orbit-tour-body { animation: orbit-tour-step .26s ease; }
@keyframes orbit-tour-step { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
.orbit-tour-title { font-size: 16.5px; font-weight: 700; letter-spacing: -.015em; margin-bottom: 5px; }
.orbit-tour-text { color: color-mix(in srgb, var(--vscode-foreground) 82%, transparent); white-space: pre-line; }
.orbit-tour-keys { display: inline-block; margin-top: 9px; padding: 2px 9px; border-radius: 7px; font-size: 11.5px; font-weight: 600; color: var(--vscode-foreground); background: rgba(128, 128, 160, .18); border: 1px solid rgba(128, 128, 160, .25); }
.orbit-tour-actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.orbit-tour-actions button { height: 30px; padding: 0 13px; border-radius: 9px; border: 1px solid transparent; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--vscode-foreground); background: rgba(128, 128, 160, .16); transition: background-color .14s ease, transform .14s ease, color .14s ease; }
.orbit-tour-actions button:hover:not(:disabled) { background: rgba(128, 128, 160, .28); }
.orbit-tour-actions button:disabled { opacity: .35; cursor: default; }
.orbit-tour-actions .orbit-tour-stop { margin-right: auto; padding: 0 4px; color: var(--vscode-descriptionForeground); background: none; font-weight: 500; }
.orbit-tour-actions .orbit-tour-stop:hover { color: var(--vscode-foreground); background: none !important; }
.orbit-tour-actions .orbit-tour-next { color: #0a0918; background: linear-gradient(100deg, #a99cff, #5eead4); }
.orbit-tour-actions .orbit-tour-next:hover { transform: translateY(-1px); background: linear-gradient(100deg, #b9aeff, #7ef0df) !important; }
.orbit-tour-ring { position: fixed; z-index: 2599; pointer-events: none; border-radius: 9px; border: 2px solid #5eead4; box-shadow: 0 0 0 4px color-mix(in srgb, #5eead4 25%, transparent), 0 0 26px color-mix(in srgb, #5eead4 60%, transparent); animation: orbit-tour-ring 1.4s ease-in-out infinite; transition: left .25s ease, top .25s ease, width .25s ease, height .25s ease; }
@keyframes orbit-tour-ring { 50% { box-shadow: 0 0 0 9px color-mix(in srgb, #5eead4 8%, transparent), 0 0 34px color-mix(in srgb, #5eead4 45%, transparent); } }
`;

let orbitTour: { readonly root: HTMLElement; readonly ring: HTMLElement; readonly store: DisposableStore; moved?: { left: number; top: number } } | undefined;

/**
 * The guided tour of the Orbit extension: one floating card over the whole window, redrawn for each
 * stop, and a ring around the element the stop talks about. Called without a step, it goes away.
 */
CommandsRegistry.registerCommand('_orbit.tour', (accessor, step: IOrbitTourStep | undefined) => {
	const commandService = accessor.get(ICommandService);
	if (!step) {
		orbitTour?.store.dispose();
		orbitTour?.root.remove();
		orbitTour?.ring.remove();
		orbitTour = undefined;
		return true;
	}
	if (!orbitTour) {
		if (!mainWindow.document.getElementById('orbit-tour-style')) {
			createStyleSheet(mainWindow.document.head, style => {
				style.id = 'orbit-tour-style';
				style.textContent = ORBIT_TOUR_CSS;
			});
		}
		// Inside the workbench element, where the theme's colours and the interface font are defined.
		const host = mainWindow.document.querySelector<HTMLElement>('.monaco-workbench') ?? mainWindow.document.body;
		orbitTour = { root: append(host, $('.orbit-tour')), ring: append(host, $('.orbit-tour-ring')), store: new DisposableStore() };
	}
	const tour = orbitTour;
	tour.store.clear();
	tour.root.textContent = '';
	const store = tour.store;

	const head = append(tour.root, $('.orbit-tour-head'));
	if (step.chapter) {
		append(head, $('span.orbit-tour-chapter')).textContent = step.chapter;
	}
	append(head, $('span.orbit-tour-count')).textContent = `${step.index + 1} / ${step.total}`;
	const fill = append(append(tour.root, $('.orbit-tour-track')), $('.orbit-tour-fill'));
	fill.style.width = `${((step.index + 1) / step.total) * 100}%`;
	const body = append(tour.root, $('.orbit-tour-body'));
	append(body, $('.orbit-tour-title')).textContent = step.title;
	append(body, $('.orbit-tour-text')).textContent = step.body;
	if (step.keys) {
		append(body, $('span.orbit-tour-keys')).textContent = step.keys;
	}
	const actions = append(tour.root, $('.orbit-tour-actions'));
	const button = (className: string, label: string, command: string, disabled = false) => {
		const element = append(actions, $(`button.${className}`)) as HTMLButtonElement;
		element.textContent = label;
		element.disabled = disabled;
		store.add(addDisposableListener(element, EventType.CLICK, () => commandService.executeCommand(command)));
	};
	button('orbit-tour-stop', step.labels.stop, step.commands.stop);
	button('orbit-tour-previous', step.labels.previous, step.commands.previous, step.index === 0);
	button('orbit-tour-next', step.labels.next, step.commands.next);

	// The card can be dragged out of the way by its head; it stays where it was put for the next stops.
	const place = () => {
		if (tour.moved) {
			tour.root.style.left = `${tour.moved.left}px`;
			tour.root.style.top = `${tour.moved.top}px`;
			tour.root.style.bottom = 'auto';
			tour.root.style.marginLeft = '0';
		}
	};
	place();
	store.add(addDisposableListener(head, EventType.MOUSE_DOWN, (down: MouseEvent) => {
		const rect = tour.root.getBoundingClientRect();
		const drag = new DisposableStore();
		drag.add(addDisposableListener(mainWindow.document, EventType.MOUSE_MOVE, (move: MouseEvent) => {
			tour.moved = {
				left: clamp(rect.left + move.clientX - down.clientX, 8, mainWindow.innerWidth - rect.width - 8),
				top: clamp(rect.top + move.clientY - down.clientY, 8, mainWindow.innerHeight - rect.height - 8),
			};
			place();
		}, true));
		drag.add(addDisposableListener(mainWindow.document, EventType.MOUSE_UP, () => drag.dispose(), true));
		down.preventDefault();
	}));

	// The ring follows its element: the layout moves while features open.
	const follow = () => {
		const element = step.target ? Array.from(mainWindow.document.querySelectorAll<HTMLElement>(step.target)).find(candidate => candidate.offsetParent !== null) : undefined;
		const rect = element?.getBoundingClientRect();
		if (!rect || rect.width === 0) {
			tour.ring.style.display = 'none';
			return;
		}
		tour.ring.style.display = '';
		tour.ring.style.left = `${rect.left - 5}px`;
		tour.ring.style.top = `${rect.top - 5}px`;
		tour.ring.style.width = `${rect.width + 6}px`;
		tour.ring.style.height = `${rect.height + 6}px`;
	};
	follow();
	const timer = mainWindow.setInterval(follow, 300);
	store.add({ dispose: () => mainWindow.clearInterval(timer) });
	return true;
});
