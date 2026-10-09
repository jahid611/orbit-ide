// Rend les maquettes de StarCapture en images : node brand/maquettes/rendu.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const require = createRequire(`${here}/../../package.json`);
const { chromium } = require('playwright-core');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', error => console.log('erreur de page :', error.message));
for (const [variant, name] of [['b', 'studio'], ['c', 'atelier'], ['d', 'texte']]) {
	await page.goto(`file:///${here}/starcapture-variantes.html?v=${variant}`);
	await page.waitForTimeout(600);
	await page.screenshot({ path: `${here}/starcapture-${variant}-${name}.png` });
	console.log(`ok ${variant}`);
}
await browser.close();
