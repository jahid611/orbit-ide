// Branchement fait une fois : les endroits du code qui affichent les logos.
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(import.meta.dirname, '..', '..');
function patch(file, edits) {
	const full = path.join(repo, file);
	const raw = fs.readFileSync(full, 'utf8');
	const crlf = raw.includes('\r\n');
	let c = raw.replace(/\r\n/g, '\n');
	for (const [x, y] of edits) {
		if (!c.includes(x)) {
			throw new Error(`${file} absent: ${x.slice(0, 70)}`);
		}
		c = c.replace(x, y);
	}
	fs.writeFileSync(full, crlf ? c.replace(/\n/g, '\r\n') : c);
}

patch('extensions/starcapture/media/editor.js', [
	[`\tconst app = /** @type {HTMLElement} */ (document.getElementById('app'));\n\tapp.innerHTML = \`\n\t\t<header class="top">\n\t\t\t<div class="brand"><span class="star">\${starMark()}</span>`,
		`\t/** StarCapture's logo, inlined by brand/logos/apply.mjs. */\n\tconst LOGO = '';\n\tconst app = /** @type {HTMLElement} */ (document.getElementById('app'));\n\tapp.innerHTML = \`\n\t\t<header class="top">\n\t\t\t<div class="brand"><img class="logo" src="\${LOGO}" alt="" />`],
]);
fs.appendFileSync(path.join(repo, 'extensions/starcapture/media/editor.css'), '\n.brand .logo { width: 22px; height: 22px; border-radius: 6px; }\n');

patch('extensions/orbit/media/unity.js', [
	[`\tconst app = /** @type {HTMLElement} */ (document.getElementById('app'));\n`, `\t/** NovaGame's logo, inlined by brand/logos/apply.mjs. */\n\tconst LOGO = '';\n\tconst app = /** @type {HTMLElement} */ (document.getElementById('app'));\n`],
	[`<span class="dot" id="dot"></span><b id="project">`, `<img class="logo" src="\${LOGO}" alt="" /><span class="dot" id="dot"></span><b id="project">`],
]);
fs.appendFileSync(path.join(repo, 'extensions/orbit/media/unity.css'), '\n.top .logo { width: 24px; height: 24px; border-radius: 7px; flex: none; }\n');

patch('extensions/orbit/src/unity.ts', [
	[`this.panel.iconPath = new vscode.ThemeIcon('game');`, `this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'novagame.png');`],
]);

const pkg = path.join(repo, 'extensions/starcapture/package.json');
const p = JSON.parse(fs.readFileSync(pkg, 'utf8'));
p.contributes.languages[0].icon = { light: './media/logo.png', dark: './media/logo.png' };
fs.writeFileSync(pkg, JSON.stringify(p, null, 2) + '\n');

patch('build/next/resources.ts', [
	[`\t'vs/workbench/contrib/orbit/browser/media/*.jpg',\n`, `\t'vs/workbench/contrib/orbit/browser/media/*.jpg',\n\t'vs/workbench/contrib/orbit/browser/media/*.png',\n`],
]);

patch('src/vs/workbench/contrib/orbit/browser/orbit.contribution.ts', [
	[`\t\tconst wallpaper = (get<string>(SETTING_WALLPAPER) ?? 'cosmos').trim();\n`,
		`\t\t// StarCapture and NovaGame keep their own colours in the activity bar instead of a tinted silhouette.
		const logos: [string, string][] = [
			['starcapture', FileAccess.asBrowserUri('vs/workbench/contrib/orbit/browser/media/starcapture.png').toString(true)],
			['novagame', FileAccess.asBrowserUri('vs/workbench/contrib/orbit/browser/media/novagame.png').toString(true)],
		];
		for (const [id, logo] of logos) {
			rules.push(\`
.monaco-workbench .activitybar .action-label[class*="activity-workbench-view-extension-\${id}"] { -webkit-mask: none !important; mask: none !important; background: url("\${logo}") center / 30px no-repeat !important; }
.monaco-workbench .activitybar .action-item:not(.checked):not(:hover) .action-label[class*="activity-workbench-view-extension-\${id}"] { opacity: .8; }\`);
		}

		const wallpaper = (get<string>(SETTING_WALLPAPER) ?? 'cosmos').trim();\n`],
]);

patch('brand/promo/index.html', [
	[`<div class="kicker pink">StarCapture</div>`, `<div class="kicker pink"><img src="assets/starcapture.png" alt="">StarCapture</div>`],
	[`<div class="kicker blue">NovaGame</div>`, `<div class="kicker blue"><img src="assets/novagame.png" alt="">NovaGame</div>`],
]);
fs.appendFileSync(path.join(repo, 'brand/promo/film.css'), '\n.kicker img { width: 84px; height: 84px; vertical-align: middle; margin-right: 22px; border-radius: 20px; box-shadow: 0 14px 40px rgba(0, 0, 0, .5); }\n');
console.log('branché');
