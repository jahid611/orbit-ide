/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// Orbit's dropdowns. Every <select> of a page is drawn as an Orbit menu (rounded, blurred,
// with icons), while the native element stays in place, hidden, as the source of truth:
// pages keep reading `select.value`, filling options and listening to `change`.
// `data-icon` on an <option> or <optgroup>: an Orbit icon name, or `brand:apple`;
// `data-label` on an <option>: a shorter text for the closed menu.

(function () {
	// @ts-ignore
	const { icon } = window.OrbitIcons;
	const done = new WeakSet();
	/** @type {{ close: () => void } | undefined} */
	let open;

	const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
	const iconOf = (/** @type {HTMLElement | null | undefined} */ el) => el?.getAttribute('data-icon') ? icon(/** @type {string} */ (el.getAttribute('data-icon'))) : '';

	function enhance(/** @type {HTMLSelectElement} */ select) {
		if (done.has(select) || select.multiple || select.hasAttribute('data-native')) {
			return;
		}
		done.add(select);
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `osel ${select.className}`;
		button.title = select.title;
		button.setAttribute('aria-haspopup', 'listbox');
		select.classList.add('osel-native');
		select.after(button);

		const refresh = () => {
			const option = select.selectedOptions[0];
			const group = option?.parentElement instanceof HTMLOptGroupElement ? option.parentElement : undefined;
			const mark = iconOf(option) || iconOf(group);
			button.innerHTML = `${mark ? `<span class="osel-icon">${mark}</span>` : ''}<span class="osel-label">${esc(option?.getAttribute('data-label') || option?.textContent?.trim() || '')}</span>${icon('chevronDown', 'osel-chevron')}`;
			button.disabled = select.disabled;
			button.hidden = select.hidden;
		};
		refresh();
		new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
		select.addEventListener('change', refresh);
		// Pages also set `select.value = …` directly, which fires nothing.
		const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
		if (proto?.get && proto.set) {
			const { get, set } = proto;
			Object.defineProperty(select, 'value', { configurable: true, get() { return get.call(select); }, set(v) { set.call(select, v); refresh(); } });
		}
		button.addEventListener('click', () => open ? open.close() : show(select, button, refresh));
		button.addEventListener('keydown', e => {
			if ((e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') && !open) {
				e.preventDefault();
				show(select, button, refresh);
			}
		});
	}

	function show(/** @type {HTMLSelectElement} */ select, /** @type {HTMLButtonElement} */ button, /** @type {() => void} */ refresh) {
		const menu = document.createElement('div');
		menu.className = 'osel-menu';
		menu.setAttribute('role', 'listbox');
		const rows = [];
		for (const child of select.children) {
			if (child instanceof HTMLOptGroupElement) {
				rows.push(`<div class="osel-group">${iconOf(child) ? `<span class="osel-icon">${iconOf(child)}</span>` : ''}<span>${esc(child.label)}</span></div>`);
				for (const option of child.children) {
					rows.push(row(/** @type {HTMLOptionElement} */ (option), select));
				}
			} else if (child instanceof HTMLOptionElement) {
				rows.push(row(child, select));
			}
		}
		menu.innerHTML = rows.join('');
		document.body.appendChild(menu);

		// Under the button, or above it when there is no room; never wider than the page.
		const box = button.getBoundingClientRect();
		const width = Math.min(Math.max(box.width, menu.scrollWidth, 180), innerWidth - 16);
		menu.style.minWidth = `${width}px`;
		const left = Math.min(Math.max(8, box.left), innerWidth - width - 8);
		const below = innerHeight - box.bottom - 12;
		const above = box.top - 12;
		const up = below < Math.min(menu.scrollHeight, 260) && above > below;
		menu.style.left = `${left}px`;
		menu.style.maxHeight = `${Math.max(140, up ? above : below)}px`;
		menu.style[up ? 'bottom' : 'top'] = up ? `${innerHeight - box.top + 6}px` : `${box.bottom + 6}px`;
		menu.classList.add(up ? 'up' : 'down');
		button.classList.add('open');

		const items = () => /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('.osel-item:not(.disabled)')]);
		let active = items().findIndex(i => i.classList.contains('selected'));
		const highlight = (/** @type {number} */ index) => {
			const list = items();
			active = (index + list.length) % list.length;
			list.forEach((el, i) => el.classList.toggle('active', i === active));
			list[active]?.scrollIntoView({ block: 'nearest' });
		};
		highlight(Math.max(0, active));

		const choose = (/** @type {HTMLElement} */ item) => {
			const value = item.getAttribute('data-value') ?? '';
			close();
			if (select.value !== value) {
				select.value = value;
				select.dispatchEvent(new Event('input', { bubbles: true }));
				select.dispatchEvent(new Event('change', { bubbles: true }));
			}
			refresh();
			button.focus();
		};
		const onKey = (/** @type {KeyboardEvent} */ e) => {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
			} else if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				const item = items()[active];
				if (item) {
					choose(item);
				}
			} else if (e.key === 'Escape' || e.key === 'Tab') {
				e.preventDefault();
				e.stopPropagation();
				close();
				button.focus();
			}
		};
		const onDown = (/** @type {MouseEvent} */ e) => {
			if (!menu.contains(/** @type {Node} */ (e.target)) && e.target !== button && !button.contains(/** @type {Node} */ (e.target))) {
				close();
			}
		};
		menu.addEventListener('click', e => {
			const item = /** @type {HTMLElement} */ (e.target).closest('.osel-item:not(.disabled)');
			if (item) {
				choose(/** @type {HTMLElement} */ (item));
			}
		});
		menu.addEventListener('mousemove', e => {
			const item = /** @type {HTMLElement} */ (e.target).closest('.osel-item:not(.disabled)');
			if (item) {
				highlight(items().indexOf(/** @type {HTMLElement} */ (item)));
			}
		});
		const close = () => {
			if (open?.close !== close) {
				return;
			}
			open = undefined;
			button.classList.remove('open');
			menu.classList.add('closing');
			setTimeout(() => menu.remove(), 120);
			document.removeEventListener('keydown', onKey, true);
			document.removeEventListener('mousedown', onDown, true);
			removeEventListener('blur', close);
			removeEventListener('resize', close);
		};
		document.addEventListener('keydown', onKey, true);
		document.addEventListener('mousedown', onDown, true);
		addEventListener('blur', close);
		addEventListener('resize', close);
		open = { close };
	}

	function row(/** @type {HTMLOptionElement} */ option, /** @type {HTMLSelectElement} */ select) {
		const selected = option.value === select.value && option.selected;
		const mark = iconOf(option);
		return `<div class="osel-item${selected ? ' selected' : ''}${option.disabled ? ' disabled' : ''}" role="option" data-value="${esc(option.value)}">${mark ? `<span class="osel-icon">${mark}</span>` : ''}<span class="osel-text">${esc(option.textContent?.trim() || '')}</span>${selected ? icon('check', 'osel-check') : ''}</div>`;
	}

	const scan = () => document.querySelectorAll('select').forEach(s => enhance(/** @type {HTMLSelectElement} */ (s)));
	new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
	scan();
	// @ts-ignore
	window.OrbitSelect = { enhance };
})();
