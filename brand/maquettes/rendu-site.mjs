// Rend la maquette du site en image : node brand/maquettes/rendu-site.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', error => console.log('erreur de page :', error.message));
await page.goto(pathToFileURL(`${here}site.html`).href);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${here}site-haut.png` });
await page.screenshot({ path: `${here}site.png`, fullPage: true });
console.log('ok');
await browser.close();
