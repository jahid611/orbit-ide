/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

/** Small, dependency-free Markdown renderer for the Orbit webviews. */
(function () {
	const FILE_RE = /^[\w@./-]+\.[a-zA-Z0-9]{1,8}(?::\d+)?$/;

	/** @param {string} s */
	function escape(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/** @param {string} text */
	function inline(text) {
		const codes = /** @type {string[]} */ ([]);
		let out = escape(text).replace(/`([^`]+)`/g, (_, code) => {
			const raw = code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
			const html = FILE_RE.test(raw) && raw.includes('.')
				? `<code class="file-link" data-file="${code}">${code}</code>`
				: `<code>${code}</code>`;
			codes.push(html);
			return `\u0000${codes.length - 1}\u0000`;
		});
		out = out
			.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
			.replace(/~~([^~]+)~~/g, '<del>$1</del>');
		return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
	}

	/** @param {string} lang @param {string} code */
	function codeBlock(lang, code) {
		return `<div class="code-block"><div class="code-head"><span>${escape(lang || 'code')}</span><span class="code-actions"><button data-action="copy" title="Copier">Copier</button><button data-action="insert" title="Insérer dans l'éditeur">Insérer</button></span></div><pre><code>${escape(code)}</code></pre></div>`;
	}

	/** @param {string} src */
	function render(src) {
		const lines = src.replace(/\r\n/g, '\n').split('\n');
		const html = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			const fence = line.match(/^\s*```\s*([\w+#.-]*)/);
			if (fence) {
				const body = [];
				i++;
				while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
					body.push(lines[i++]);
				}
				i++;
				html.push(codeBlock(fence[1], body.join('\n')));
				continue;
			}
			const heading = line.match(/^(#{1,4})\s+(.*)$/);
			if (heading) {
				const level = Math.min(heading[1].length + 1, 5);
				html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
				i++;
				continue;
			}
			if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
				html.push('<hr>');
				i++;
				continue;
			}
			if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
				const row = (/** @type {string} */ l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
				const head = row(line);
				i += 2;
				const body = [];
				while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
					body.push(row(lines[i++]));
				}
				html.push(`<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
				continue;
			}
			if (/^\s*>/.test(line)) {
				const quote = [];
				while (i < lines.length && /^\s*>/.test(lines[i])) {
					quote.push(lines[i++].replace(/^\s*>\s?/, ''));
				}
				html.push(`<blockquote>${render(quote.join('\n'))}</blockquote>`);
				continue;
			}
			const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
			if (listMatch) {
				const ordered = /\d/.test(listMatch[2]);
				const items = [];
				while (i < lines.length) {
					const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
					if (m) {
						const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
						items.push(task
							? `<li class="task"><span class="check ${task[1] === ' ' ? '' : 'done'}"></span>${inline(task[2])}</li>`
							: `<li${m[1].length >= 2 ? ' class="nested"' : ''}>${inline(m[3])}</li>`);
						i++;
					} else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
						items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, ` ${inline(lines[i].trim())}</li>`);
						i++;
					} else {
						break;
					}
				}
				html.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
				continue;
			}
			if (!line.trim()) {
				i++;
				continue;
			}
			const para = [];
			while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i])) {
				para.push(lines[i++]);
			}
			if (!para.length) {
				para.push(lines[i++]);
			}
			html.push(`<p>${para.map(inline).join('<br>')}</p>`);
		}
		return html.join('');
	}

	// @ts-ignore
	window.OrbitMarkdown = { render, escape };
})();
