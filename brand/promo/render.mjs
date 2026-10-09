// Rend le film image par image avec Edge, puis l'encode avec ffmpeg.
// Usage : node render.mjs                 → orbit-film.mp4 (1920×1080, 30 i/s)
//         node render.mjs --stills 3,10   → images fixes stills/t-3.png, stills/t-10.png
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../node_modules/playwright-core');
const here = import.meta.dirname;
const stillsAt = process.argv.includes('--stills') ? process.argv[process.argv.indexOf('--stills') + 1].split(',').map(Number) : undefined;

const browser = await chromium.launch({ channel: 'msedge', args: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 4 / 3 });
await page.goto(pathToFileURL(path.join(here, 'index.html')).href + '?render=1');
await page.evaluate(() => window.READY);
await page.waitForFunction(() => [...document.images].every(i => i.complete));
const { duration, fps } = await page.evaluate(() => window.FILM);

if (stillsAt) {
	fs.mkdirSync(path.join(here, 'stills'), { recursive: true });
	for (const t of stillsAt) {
		await page.evaluate(time => window.seek(time), t);
		await page.screenshot({ path: path.join(here, 'stills', `t-${t}.png`) });
	}
	await browser.close();
	console.log('images :', stillsAt.join(', '));
	process.exit(0);
}

const out = path.join(here, 'orbit-film-muet.mp4');
const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '4', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const total = Math.round(duration * fps);
for (let i = 0; i < total; i++) {
	await page.evaluate(time => window.seek(time), i / fps);
	const shot = await page.screenshot({ type: 'jpeg', quality: 96 });
	if (!ffmpeg.stdin.write(shot)) {
		await new Promise(r => ffmpeg.stdin.once('drain', r));
	}
	if (i % 150 === 0) {
		console.log(`${Math.round(i / total * 100)} %`);
	}
}
ffmpeg.stdin.end();
await new Promise(r => ffmpeg.on('close', r));
await browser.close();
// The soundtrack sits under the picture, levelled as a background.
const music = path.join(here, 'musique.wav');
const final = path.join(here, 'orbit-film.mp4');
if (fs.existsSync(music)) {
	const mux = spawn('ffmpeg', ['-v', 'error', '-y', '-i', out, '-i', music, '-c:v', 'copy', '-af', 'loudnorm=I=-19:TP=-2:LRA=9', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final], { stdio: ['ignore', 'inherit', 'inherit'] });
	await new Promise(r => mux.on('close', r));
} else {
	fs.copyFileSync(out, final);
}
console.log('film :', final);
