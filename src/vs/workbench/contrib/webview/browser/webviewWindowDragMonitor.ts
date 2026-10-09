/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWebview } from './webview.js';

/**
 * Allows webviews to monitor when an element in the VS Code editor is being dragged/dropped.
 *
 * This is required since webview end up eating the drag event. VS Code needs to see this
 * event so it can handle editor element drag drop.
 */
export class WebviewWindowDragMonitor extends Disposable {
	/**
	 * @param takesDrops Orbit: the page handles dropped files itself (StarCapture). It is then only
	 * put aside while a tab is being dragged, so that tabs can still split the editor area; files
	 * dragged from the explorer or from the system reach the page without holding Shift.
	 */
	constructor(targetWindow: CodeWindow, getWebview: () => IWebview | undefined, takesDrops?: () => boolean) {
		super();

		let draggingTab = false;

		const onDragStart = () => {
			if (takesDrops?.() && !draggingTab) {
				getWebview()?.windowDidDragEnd();
				return;
			}
			getWebview()?.windowDidDragStart();
		};

		const onDragEnd = () => {
			getWebview()?.windowDidDragEnd();
		};

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_START, event => {
			draggingTab = DOM.isHTMLElement(event.target) && !!event.target.closest('.tabs-container, .editor-group-container > .title');
			onDragStart();
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_END, () => {
			draggingTab = false;
			onDragEnd();
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.MOUSE_MOVE, currentEvent => {
			if (currentEvent.buttons === 0) {
				onDragEnd();
			}
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG, (event) => {
			if (event.shiftKey) {
				onDragEnd();
			} else {
				onDragStart();
			}
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_OVER, (event) => {
			if (event.shiftKey) {
				onDragEnd();
			} else {
				onDragStart();
			}
		}));

	}
}
