/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { cacheFor, silences, tools } from './ffmpeg';
import { Media, Word } from './project';

const execFileAsync = promisify(execFile);
const HOME = path.join(os.homedir(), '.orbit', 'starcapture', 'whisper');
const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip';
const MODELS: Record<string, string> = {
	base: 'ggml-base-q5_1.bin',
	small: 'ggml-small-q5_1.bin',
	medium: 'ggml-medium-q5_0.bin',
};
const LANGUAGES: Record<string, string> = { french: 'fr', english: 'en', spanish: 'es', german: 'de', italian: 'it', portuguese: 'pt' };

/**
 * Speech to text on this machine with whisper.cpp: word timings, any language, a 10-minute
 * video in about two minutes on a common processor. Downloaded once (Windows), or taken
 * from the PATH (brew install whisper-cpp).
 */
export async function transcribeMedia(media: Media, language: string, onProgress: (p: number, label: string) => void, token?: vscode.CancellationToken): Promise<Word[]> {
	const cli = await whisperCli(onProgress);
	const model = await modelFile(onProgress);
	const { ffmpeg } = await tools();
	const dir = cacheFor(media.path);
	const wav = path.join(dir, 'speech16k.wav');
	if (!fs.existsSync(wav)) {
		onProgress(0, 'Préparation du son…');
		await execFileAsync(ffmpeg, ['-v', 'error', '-y', '-i', media.path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
	}
	const lang = LANGUAGES[language.toLowerCase()] ?? language.toLowerCase().slice(0, 2) ?? 'fr';
	const out = path.join(dir, `words-${lang}-${path.basename(model, '.bin')}`);
	const threads = Math.max(2, Math.min(16, (os.cpus()?.length ?? 4) - 2));
	// DTW alignment (token onsets) is far more precise than segment interpolation; it needs flash attention off.
	const dtw = path.basename(model).match(/ggml-(tiny|base|small|medium|large-v3-turbo|large-v3)/)?.[1];
	await new Promise<void>((resolve, reject) => {
		const child = spawn(cli, ['-m', model, '-f', wav, '-l', lang, '-ojf', '-of', out, '-t', String(threads), '-pp', '-np', ...(dtw ? ['--dtw', dtw, '-nfa'] : [])], { windowsHide: true });
		let log = '';
		const onData = (chunk: Buffer) => {
			const text = chunk.toString('utf8');
			log = (log + text).slice(-4000);
			const m = /progress\s*=\s*(\d+)%/g;
			let last: RegExpExecArray | null = null;
			for (let r = m.exec(text); r; r = m.exec(text)) {
				last = r;
			}
			if (last) {
				onProgress(Number(last[1]) / 100, 'Transcription…');
			}
		};
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		token?.onCancellationRequested(() => child.kill());
		child.on('error', reject);
		child.on('close', code => code === 0 ? resolve() : reject(new Error(token?.isCancellationRequested ? 'Transcription annulée' : `whisper.cpp a échoué (code ${code}) : ${log.split('\n').filter(Boolean).slice(-3).join(' ')}`)));
	});
	type Token = { text: string; offsets: { from: number; to: number }; t_dtw?: number };
	const json = JSON.parse(fs.readFileSync(`${out}.json`, 'utf8')) as { transcription?: { offsets: { from: number; to: number }; text: string; tokens?: Token[] }[] };
	// Words from tokens: a token starting with a space opens a word; its DTW time is the word onset.
	const raw: Word[] = [];
	for (const seg of json.transcription ?? []) {
		const segEnd = seg.offsets.to / 1000;
		for (const tok of seg.tokens ?? []) {
			if (/^\[_|^\[[A-Z_]+\]$/.test(tok.text) || !tok.text) {
				continue;
			}
			const at = tok.t_dtw !== undefined && tok.t_dtw >= 0 ? tok.t_dtw / 100 : tok.offsets.from / 1000;
			const text = tok.text;
			const last = raw[raw.length - 1];
			if (last && (!/^\s/.test(text) || /^\s*[.,!?;:…»)%]+$/.test(text))) {
				last.w += text.trim();
				continue;
			}
			if (last && last.end > at) {
				last.end = at;
			}
			raw.push({ w: text.trim(), start: at, end: Math.min(segEnd, at + 0.7) });
		}
		// The last word of a segment ends with it (or 0.7 s later at most).
		const last = raw[raw.length - 1];
		if (last) {
			last.end = Math.min(Math.max(last.end, last.start + 0.1), segEnd + 0.05);
		}
	}
	// Each word lasts until the next one starts, within reason.
	for (let i = 0; i < raw.length - 1; i++) {
		raw[i].end = Math.min(Math.max(raw[i].end, raw[i].start + 0.08), raw[i + 1].start, raw[i].start + 1.2);
	}
	return tighten(raw.filter(w => w.w), await silences(media.path, -38, 0.25).catch(() => []));
}

/** Word times spill over pauses: keep each word on the sound side of a detected silence. */
function tighten(words: Word[], quiet: [number, number][]): Word[] {
	return words.map(w => {
		let { start, end } = w;
		for (const [a, b] of quiet) {
			if (a <= start && b > start && b < end) {
				start = b;
			} else if (a > start && a < end && b >= end) {
				end = a;
			}
		}
		return { w: w.w, start: round(start), end: round(Math.max(end, start + 0.06)) };
	});
}

async function whisperCli(onProgress: (p: number, label: string) => void): Promise<string> {
	const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
	const local = path.join(HOME, 'bin', 'Release', exe);
	if (fs.existsSync(local)) {
		return local;
	}
	const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
	for (const dir of [...(process.env[pathKey] ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin']) {
		for (const name of [exe, process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp']) {
			if (dir && fs.existsSync(path.join(dir, name))) {
				return path.join(dir, name);
			}
		}
	}
	if (process.platform !== 'win32') {
		throw new Error('whisper.cpp est introuvable : installe-le avec « brew install whisper-cpp » (macOS) ou ton gestionnaire de paquets.');
	}
	fs.mkdirSync(HOME, { recursive: true });
	const zip = path.join(HOME, 'bin.zip');
	await download(RELEASE, zip, p => onProgress(p, 'Téléchargement de whisper.cpp (une seule fois)…'));
	await execFileAsync('tar', ['-xf', zip, '-C', path.join(HOME)], { windowsHide: true }).catch(async () => {
		fs.mkdirSync(path.join(HOME, 'bin'), { recursive: true });
		await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, `''`)}' -DestinationPath '${path.join(HOME, 'bin').replace(/'/g, `''`)}' -Force`], { windowsHide: true });
	});
	// The archive holds Release/… at its root; keep everything under bin/.
	const extracted = path.join(HOME, 'Release');
	if (fs.existsSync(extracted)) {
		fs.mkdirSync(path.join(HOME, 'bin'), { recursive: true });
		fs.renameSync(extracted, path.join(HOME, 'bin', 'Release'));
	}
	fs.rmSync(zip, { force: true });
	if (!fs.existsSync(local)) {
		throw new Error('whisper.cpp n\'a pas pu être installé');
	}
	return local;
}

async function modelFile(onProgress: (p: number, label: string) => void): Promise<string> {
	const choice = vscode.workspace.getConfiguration('starcapture').get<string>('transcriptionModel') ?? 'small';
	const name = MODELS[choice] ?? MODELS.small;
	const file = path.join(HOME, name);
	if (!fs.existsSync(file)) {
		fs.mkdirSync(HOME, { recursive: true });
		await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`, file, p => onProgress(p, `Téléchargement du modèle ${choice} (une seule fois)…`));
	}
	return file;
}

/** HTTPS download with redirects, written to a temporary file then renamed. */
function download(url: string, file: string, onProgress: (p: number) => void, redirects = 0): Promise<void> {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { 'user-agent': 'Orbit-StarCapture' } }, res => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
				res.resume();
				resolve(download(new URL(res.headers.location, url).toString(), file, onProgress, redirects + 1));
				return;
			}
			if (res.statusCode !== 200) {
				res.resume();
				reject(new Error(`Téléchargement impossible (${res.statusCode}) : ${url}`));
				return;
			}
			const total = Number(res.headers['content-length'] ?? 0);
			let got = 0;
			const part = `${file}.part`;
			const out = fs.createWriteStream(part);
			res.on('data', (c: Buffer) => {
				got += c.length;
				if (total) {
					onProgress(got / total);
				}
			});
			res.pipe(out);
			out.on('finish', () => {
				out.close();
				fs.renameSync(part, file);
				resolve();
			});
			out.on('error', reject);
			res.on('error', reject);
		}).on('error', reject);
	});
}

function round(n: number): number {
	return Math.round(n * 1000) / 1000;
}
