/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Set while a page fills the whole editor area (the live view in its large form): any editor
 * opened then, even behind, would shrink it back, so files the agent touches are not opened.
 */
export const attention = { large: false };

/**
 * Whether a file opened in the first editor group would hide a page the user is looking at
 * (the live view, a video, a document): files the agent touches then open behind it.
 */
export function pageInFront(): boolean {
	const input = vscode.window.tabGroups.all.find(group => group.viewColumn === vscode.ViewColumn.One)?.activeTab?.input;
	return input instanceof vscode.TabInputWebview || input instanceof vscode.TabInputCustom;
}
