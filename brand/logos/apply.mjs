// Détoure les logos retenus (liseré des coins retiré) et les pose partout où Orbit s'en sert.
// Usage : node brand/logos/apply.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../node_modules/playwright-core');
const here = import.meta.dirname;
const repo = path.join(here, '..', '..');
const SOURCES = { starcapture: 'astra/starcapture-b.png', novagame: 'astra/novagame-b.png' };

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
/** The icon cut to its rounded square, on a transparent background. */
async function render(name, size) {
	await page.setViewportSize({ width: size, height: size });
	// A real file: a blank page may not load local images.
	const sheet = path.join(here, '.render.html');
	fs.writeFileSync(sheet, `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px;clip-path:inset(1.6% round 19%)}</style><img src="${SOURCES[name]}">`);
	await page.goto(pathToFileURL(sheet).href);
	await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
	const shot = await page.screenshot({ omitBackground: true });
	fs.rmSync(sheet);
	return shot;
}

const out = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const dataUris = {};
for (const name of Object.keys(SOURCES)) {
	out(path.join(here, `${name}.png`), await render(name, 1024));
	const medium = await render(name, 256);
	const small = await render(name, 128);
	dataUris[name] = `data:image/png;base64,${(await render(name, 64)).toString('base64')}`;
	out(path.join(repo, 'extensions', name, 'media', 'logo.png'), medium);
	out(path.join(repo, 'src/vs/workbench/contrib/orbit/browser/media', `${name}.png`), small);
	out(path.join(repo, 'brand/promo/assets', `${name}.png`), medium);
	if (name === 'novagame') {
		out(path.join(repo, 'extensions/orbit/media/novagame.png'), small);
	}
}
await browser.close();

// The pages carry their logo inline: no extra file to serve.
function inline(file, marker, uri) {
	let c = fs.readFileSync(file, 'utf8');
	const pattern = new RegExp(`(const ${marker} = ')[^']*(';)`);
	if (!pattern.test(c)) {
		throw new Error(`${file} : ${marker} introuvable`);
	}
	fs.writeFileSync(file, c.replace(pattern, `$1${uri}$2`));
}
inline(path.join(repo, 'extensions/starcapture/media/editor.js'), 'LOGO', dataUris.starcapture);
inline(path.join(repo, 'extensions/orbit/media/unity.js'), 'LOGO', dataUris.novagame);
console.log('logos posés');
