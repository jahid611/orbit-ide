/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

interface FontFacts {
	family?: string;
	style?: string;
	version?: string;
	designer?: string;
	license?: string;
	glyphs?: number;
	/** The characters the font draws, as ranges of code points. */
	ranges: [number, number][];
}

/**
 * What a TrueType or OpenType file says about itself: its names (table `name`), how many glyphs
 * it holds (`maxp`) and which characters it draws (`cmap`). WOFF files are compressed: for them
 * only the file name is known, the page still shows the font.
 */
function readFacts(file: string): FontFacts {
	const facts: FontFacts = { ranges: [] };
	try {
		const data = fs.readFileSync(file);
		let base = 0;
		if (data.toString('latin1', 0, 4) === 'ttcf') {
			base = data.readUInt32BE(12); // a collection: its first font
		}
		const tag = data.toString('latin1', base, base + 4);
		if (tag !== '\u0000\u0001\u0000\u0000' && tag !== 'OTTO' && tag !== 'true') {
			return facts;
		}
		const tables = new Map<string, number>();
		for (let i = 0, n = data.readUInt16BE(base + 4); i < n; i++) {
			const at = base + 12 + i * 16;
			tables.set(data.toString('latin1', at, at + 4), data.readUInt32BE(at + 8));
		}
		const maxp = tables.get('maxp');
		if (maxp !== undefined) {
			facts.glyphs = data.readUInt16BE(maxp + 4);
		}
		const name = tables.get('name');
		if (name !== undefined) {
			const strings = name + data.readUInt16BE(name + 4);
			const found = new Map<number, string>();
			for (let i = 0, n = data.readUInt16BE(name + 2); i < n; i++) {
				const at = name + 6 + i * 12;
				const platform = data.readUInt16BE(at);
				const id = data.readUInt16BE(at + 6);
				const bytes = data.subarray(strings + data.readUInt16BE(at + 10), strings + data.readUInt16BE(at + 10) + data.readUInt16BE(at + 8));
				// Windows and Unicode names are UTF-16 big endian, Macintosh ones are one byte a letter.
				const text = platform === 1 ? bytes.toString('latin1') : Buffer.from(bytes).swap16().toString('utf16le');
				if (text && (platform !== 1 || !found.has(id))) {
					found.set(id, text);
				}
			}
			facts.family = found.get(16) ?? found.get(1);
			facts.style = found.get(17) ?? found.get(2);
			facts.version = found.get(5);
			facts.designer = found.get(9) ?? found.get(8);
			facts.license = found.get(13)?.slice(0, 400);
		}
		const cmap = tables.get('cmap');
		if (cmap !== undefined) {
			let best: { format: number; at: number } | undefined;
			for (let i = 0, n = data.readUInt16BE(cmap + 2); i < n; i++) {
				const at = cmap + data.readUInt32BE(cmap + 4 + i * 8 + 4);
				const format = data.readUInt16BE(at);
				if ((format === 12 || format === 4) && (!best || format > best.format)) {
					best = { format, at };
				}
			}
			if (best?.format === 12) {
				for (let i = 0, n = Math.min(4000, data.readUInt32BE(best.at + 12)); i < n; i++) {
					facts.ranges.push([data.readUInt32BE(best.at + 16 + i * 12), data.readUInt32BE(best.at + 20 + i * 12)]);
				}
			} else if (best) {
				const segments = data.readUInt16BE(best.at + 6) / 2;
				for (let i = 0; i < segments; i++) {
					const end = data.readUInt16BE(best.at + 14 + i * 2);
					const start = data.readUInt16BE(best.at + 16 + segments * 2 + i * 2);
					if (start <= end && end !== 0xFFFF) {
						facts.ranges.push([start, end]);
					}
				}
			}
		}
	} catch {
		// an unusual file: the page shows the font without its details
	}
	return facts;
}

/**
 * Font files (.ttf, .otf, .woff, .woff2) open in Orbit as a specimen: the font's names, a text
 * to type in it at any size, and every character it draws. They used to open as unreadable
 * binary. The file is never modified.
 */
class FontViewer implements vscode.CustomReadonlyEditorProvider {

	constructor(private readonly context: vscode.ExtensionContext) { }

	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => undefined };
	}

	resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
		const file = document.uri.fsPath;
		panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.dirname(file)), vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
		const render = () => {
			const nonce = randomBytes(16).toString('base64');
			const source = panel.webview.cspSource;
			const facts = readFacts(file);
			let size = 0;
			try {
				size = fs.statSync(file).size;
			} catch {
				// gone
			}
			// A new address at each change: the page must not keep the previous file.
			const font = `${panel.webview.asWebviewUri(document.uri)}?v=${Date.now()}`;
			const data = { name: path.basename(file), size, facts };
			panel.webview.html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${source}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<style nonce="${nonce}">
@font-face { font-family: 'OrbitSpecimen'; src: url('${font}'); }
:root { color-scheme: dark light; }
body { margin: 0; padding: 0 0 60px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.5 var(--vscode-font-family); }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 14px 28px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, .25)); }
h1 { margin: 0; font-size: 17px; font-weight: 600; }
.sub { opacity: .65; font-size: 12px; }
.grow { flex: 1; }
input[type=text] { width: 100%; box-sizing: border-box; padding: 9px 12px; border-radius: 8px; color: inherit; font: inherit; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); outline: none; }
input[type=text]:focus { border-color: var(--vscode-focusBorder); }
input[type=range] { width: 150px; accent-color: var(--vscode-focusBorder); }
main { padding: 22px 28px; max-width: 1200px; }
section { margin-bottom: 34px; }
h2 { margin: 0 0 12px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
.f { font-family: 'OrbitSpecimen', 'Adobe NotDef', sans-serif; }
#hero { margin: 14px 0 0; line-height: 1.2; overflow-wrap: anywhere; outline: none; }
.scale div { display: flex; align-items: baseline; gap: 18px; padding: 7px 0; border-bottom: 1px solid rgba(128, 128, 128, .14); }
.scale span:first-child { width: 44px; flex: none; opacity: .5; font-size: 11px; font-variant-numeric: tabular-nums; }
.scale span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25; }
.glyphs { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 6px; }
.glyphs button { display: grid; place-items: center; aspect-ratio: 1; padding: 0; border: 0; border-radius: 8px; color: inherit; font-size: 26px; line-height: 1; cursor: pointer; background: rgba(128, 128, 128, .1); }
.glyphs button:hover { background: var(--vscode-list-hoverBackground); outline: 1px solid var(--vscode-focusBorder); }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 5px 18px; font-size: 12px; }
.facts dt { opacity: .6; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
#more { margin-top: 12px; padding: 6px 14px; border: 0; border-radius: 7px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font: inherit; }
#picked { position: fixed; right: 22px; bottom: 22px; padding: 8px 14px; border-radius: 9px; font-size: 12px; color: var(--vscode-notifications-foreground); background: var(--vscode-notifications-background); box-shadow: 0 6px 22px rgba(0, 0, 0, .35); }
#failed { padding: 12px 16px; border-radius: 9px; color: var(--vscode-inputValidation-errorForeground, inherit); background: var(--vscode-inputValidation-errorBackground, rgba(255, 80, 80, .15)); }
</style>
</head>
<body>
<header>
	<div><h1 id="title"></h1><div class="sub" id="sub"></div></div>
	<span class="grow"></span>
	<label class="sub">Taille <input type="range" id="size" min="12" max="220" value="56"> <span id="sizeValue">56</span> px</label>
</header>
<main>
	<p id="failed" hidden>Cette police n'a pas pu être chargée : le fichier est peut-être abîmé ou d'un format que ce lecteur ne connaît pas.</p>
	<section>
		<input type="text" id="text" spellcheck="false" placeholder="Écris ici ton propre texte pour l'essayer dans cette police">
		<p class="f" id="hero"></p>
	</section>
	<section><h2>Tailles</h2><div class="scale" id="scale"></div></section>
	<section><h2 id="glyphTitle">Caractères</h2><div class="glyphs f" id="glyphs"></div><button id="more" hidden>Afficher la suite</button></section>
	<section><h2>Fichier</h2><dl class="facts" id="facts"></dl></section>
</main>
<div id="picked" hidden></div>
<script nonce="${nonce}">
(function () {
	const data = ${JSON.stringify(data).replace(/</g, '\\u003c')};
	const $ = id => document.getElementById(id);
	const facts = data.facts;
	$('title').textContent = facts.family ? facts.family + (facts.style && !/^(Regular|Normal|Standard)$/i.test(facts.style) ? ' ' + facts.style : '') : data.name;
	$('sub').textContent = [data.name, data.size > 1048576 ? (data.size / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(data.size / 1024)) + ' Ko', facts.glyphs ? facts.glyphs + ' glyphes' : ''].filter(Boolean).join(' · ');
	const sample = 'Portez ce vieux whisky au juge blond qui fume';
	const alphabet = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '. , ; : ! ? & @ # % € $ ( ) « » - + = / *'];
	const text = $('text');
	const show = () => {
		const value = text.value || sample;
		// Nothing typed: the alphabet, the digits and the usual signs, one kind a line.
		$('hero').replaceChildren(...(text.value ? [text.value] : alphabet).map(line => {
			const row = document.createElement('div');
			row.textContent = line;
			return row;
		}));
		$('hero').style.fontSize = $('size').value + 'px';
		$('sizeValue').textContent = $('size').value;
		$('scale').replaceChildren(...[12, 16, 20, 28, 40, 56, 80].map(px => {
			const row = document.createElement('div');
			const label = document.createElement('span');
			label.textContent = px + ' px';
			const line = document.createElement('span');
			line.className = 'f';
			line.style.fontSize = px + 'px';
			line.textContent = value;
			row.append(label, line);
			return row;
		}));
	};
	text.oninput = show;
	$('size').oninput = show;
	show();

	// Every character of the font, or the usual ones when the file does not list them.
	const points = [];
	const ranges = facts.ranges.length ? facts.ranges : [[33, 126], [161, 255], [338, 339], [8211, 8230], [8364, 8364]];
	for (const [from, to] of ranges) {
		for (let p = Math.max(33, from); p <= to && points.length < 60000; p++) {
			if (p !== 127 && !(p >= 128 && p <= 160) && !(p >= 0xD800 && p <= 0xDFFF) && !(p >= 0xFE00 && p <= 0xFE0F)) {
				points.push(p);
			}
		}
	}
	$('glyphTitle').textContent = facts.ranges.length ? points.length + ' caractères' : 'Caractères usuels';
	let shown = 0;
	const add = () => {
		const part = document.createDocumentFragment();
		for (const p of points.slice(shown, shown + 600)) {
			const b = document.createElement('button');
			b.textContent = String.fromCodePoint(p);
			b.title = 'U+' + p.toString(16).toUpperCase().padStart(4, '0');
			part.append(b);
		}
		shown = Math.min(points.length, shown + 600);
		$('glyphs').append(part);
		$('more').hidden = shown >= points.length;
		$('more').textContent = 'Afficher la suite (' + (points.length - shown) + ')';
	};
	$('more').onclick = add;
	add();
	let timer = 0;
	$('glyphs').onclick = e => {
		const b = e.target.closest('button');
		if (!b) {
			return;
		}
		navigator.clipboard.writeText(b.textContent).catch(() => undefined);
		$('picked').textContent = b.textContent + '   ' + b.title + ' copié';
		$('picked').hidden = false;
		clearTimeout(timer);
		timer = setTimeout(() => { $('picked').hidden = true; }, 1800);
	};

	const rows = [['Famille', facts.family], ['Style', facts.style], ['Version', facts.version], ['Auteur', facts.designer], ['Licence', facts.license], ['Format', data.name.split('.').pop().toUpperCase()]].filter(r => r[1]);
	for (const [label, value] of rows) {
		const dt = document.createElement('dt');
		dt.textContent = label;
		const dd = document.createElement('dd');
		dd.textContent = value;
		$('facts').append(dt, dd);
	}
	document.fonts.load('32px OrbitSpecimen').then(found => { $('failed').hidden = found.length > 0; }, () => { $('failed').hidden = false; });
})();
</script>
</body>
</html>`;
		};
		render();
		// The font is redrawn when its file changes (an agent or a tool rebuilding it).
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
		watcher.onDidChange(render);
		panel.onDidDispose(() => watcher.dispose());
	}
}

export function registerFontViewer(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.window.registerCustomEditorProvider('orbit.font', new FontViewer(context), { supportsMultipleEditorsPerDocument: true });
}
