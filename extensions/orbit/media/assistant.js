/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// Orbit's pages are written for Claude. With another assistant, what they display names it
// instead, and its mark replaces Claude's: done here once, for every page.
(function () {
	// @ts-ignore
	const who = window.OrbitAssistant;
	if (!who || who.id === 'claude') {
		return;
	}
	const reword = (/** @type {string} */ text) => text.replace(/Claude Code/g, who.product).replace(/Claude(?![.]md)/g, who.name);
	const ATTRIBUTES = ['title', 'placeholder', 'aria-label'];

	function visit(/** @type {Node} */ node) {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.nodeValue ?? '';
			if (text.includes('Claude')) {
				node.nodeValue = reword(text);
			}
			return;
		}
		if (!(node instanceof Element) || node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'TEXTAREA' || node.tagName === 'CODE' || node.tagName === 'PRE') {
			return;
		}
		for (const name of ATTRIBUTES) {
			const value = node.getAttribute(name);
			if (value && value.includes('Claude')) {
				node.setAttribute(name, reword(value));
			}
		}
		for (const child of node.childNodes) {
			visit(child);
		}
	}

	const style = document.createElement('style');
	style.textContent = `.claude-mark { background-image: url("${who.image}") !important; }`;
	document.head.appendChild(style);

	new MutationObserver(changes => {
		for (const change of changes) {
			if (change.type === 'characterData') {
				visit(change.target);
			} else if (change.type === 'attributes') {
				visit(change.target);
			} else {
				change.addedNodes.forEach(visit);
			}
		}
	}).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
	visit(document.body);
})();
