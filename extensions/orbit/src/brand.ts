/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistant, assistantId, wording } from './assistant';

/**
 * Orbit's texts are written for Claude. With another assistant, the same sentence names it
 * instead: "Claude Code" becomes the product, "Claude" the assistant. File names such as
 * CLAUDE.md are left alone.
 */
export function brand(text: string): string {
	if (wording.literal || assistantId() === 'claude' || !text.includes('Claude')) {
		return text;
	}
	const who = assistant();
	return text.split('$(orbit-claude)').join(`$(${who.icon})`).replace(/Claude Code/g, who.product).replace(/Claude(?![.]md)/g, who.name);
}

function brandDeep<T>(value: T, depth = 0): T {
	if (typeof value === 'string') {
		return brand(value) as unknown as T;
	}
	if (depth > 3 || !value || typeof value !== 'object' || value instanceof vscode.Uri || value instanceof vscode.ThemeIcon) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(item => brandDeep(item, depth + 1)) as unknown as T;
	}
	if (Object.getPrototypeOf(value) !== Object.prototype) {
		return value; // a class instance: leave it as it is
	}
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		out[key] = typeof item === 'function' ? item : brandDeep(item, depth + 1);
	}
	return out as T;
}

let toastTimer: NodeJS.Timeout | undefined;

/**
 * A notification stays ten seconds, then goes to the notification centre (the bell), where it can
 * still be read and answered. The workbench does this by itself in an Orbit built after
 * 8 October 2026; this covers the ones built before, ten seconds after the last message shown.
 */
function putToastsAway(): void {
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => vscode.commands.executeCommand('notifications.hideToasts').then(undefined, () => undefined), 10000);
}

/**
 * Words every message, question and list Orbit shows for the assistant in use, in one place:
 * the functions of `vscode.window` that display text are wrapped once, at activation.
 * Returns false when the editor does not allow it (the texts then keep naming Claude).
 */
export function installBranding(): boolean {
	const target = vscode.window as unknown as Record<string, (...args: unknown[]) => unknown>;
	try {
		for (const name of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage', 'showInputBox', 'setStatusBarMessage']) {
			const original = target[name];
			const message = name.endsWith('Message') && name !== 'setStatusBarMessage';
			target[name] = (...args: unknown[]) => {
				// A modal question is not a toast: it waits for its answer.
				if (message && !args.some(a => !!a && typeof a === 'object' && (a as vscode.MessageOptions).modal === true)) {
					putToastsAway();
				}
				return original.apply(vscode.window, args.map(a => brandDeep(a)));
			};
		}
		const pick = target.showQuickPick;
		target.showQuickPick = (items: unknown, ...rest: unknown[]) => {
			// The chosen item must be the caller's own object: brand a copy for display, hand back the original.
			const wrap = (list: unknown[]) => list.map(item => typeof item === 'string' ? item : Object.assign(Object.create(item as object), brandDeep({ label: (item as vscode.QuickPickItem).label, description: (item as vscode.QuickPickItem).description, detail: (item as vscode.QuickPickItem).detail })));
			const unwrap = (chosen: unknown): unknown => Array.isArray(chosen) ? chosen.map(unwrap) : chosen && typeof chosen === 'object' ? Object.getPrototypeOf(chosen) : chosen;
			const shown = items instanceof Promise ? items.then(wrap) : Array.isArray(items) ? wrap(items) : items;
			return (pick.apply(vscode.window, [shown, ...rest.map(a => brandDeep(a))]) as Promise<unknown>).then(unwrap);
		};
		const progress = target.withProgress;
		target.withProgress = (options: unknown, task: unknown) => progress.apply(vscode.window, [brandDeep(options), task]);
		return true;
	} catch {
		return false;
	}
}
