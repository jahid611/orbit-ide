/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { ChildProcess, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { Media, uid } from './project';

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === 'win32';

/** Where thumbnails, waveforms and proxies live, per source file. */
export const CACHE_DIR = path.join(os.homedir(), '.orbit', 'starcapture', 'cache');

let found: { ffmpeg: string; ffprobe: string } | undefined;

/** ffmpeg and ffprobe: the setting, then the PATH, then the usual install folders. */
export async function tools(): Promise<{ ffmpeg: string; ffprobe: string }> {
	if (found) {
		return found;
	}
	const configured = vscode.workspace.getConfiguration('starcapture').get<string>('ffmpegPath')?.trim();
	const exe = IS_WINDOWS ? '.exe' : '';
	const candidates: string[] = [];
	if (configured) {
		candidates.push(fs.existsSync(configured) && fs.statSync(configured).isDirectory() ? configured : path.dirname(configured));
	}
	const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
	candidates.push(...(process.env[pathKey] ?? '').split(path.delimiter).filter(Boolean));
	if (IS_WINDOWS) {
		// winget installs ffmpeg in a versioned folder that is not always on the PATH of GUI apps.
		const winget = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Packages');
		try {
			for (const pkg of fs.readdirSync(winget).filter(d => /ffmpeg/i.test(d))) {
				for (const build of fs.readdirSync(path.join(winget, pkg))) {
					candidates.push(path.join(winget, pkg, build, 'bin'));
				}
			}
		} catch {
			// no winget packages
		}
		candidates.push('C:\\ffmpeg\\bin', path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ffmpeg', 'bin'));
	} else {
		candidates.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
	}
	for (const dir of candidates) {
		const ffmpeg = path.join(dir, `ffmpeg${exe}`);
		const ffprobe = path.join(dir, `ffprobe${exe}`);
		if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) {
			found = { ffmpeg, ffprobe };
			return found;
		}
	}
	throw new Error(IS_WINDOWS
		? 'ffmpeg est introuvable. Installe-le (winget install Gyan.FFmpeg) ou indique son chemin dans le réglage starcapture.ffmpegPath.'
		: 'ffmpeg est introuvable. Installe-le (brew install ffmpeg) ou indique son chemin dans le réglage starcapture.ffmpegPath.');
}

const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;

/** What a media file holds: kind, duration, size, frame rate, audio. */
export async function probe(file: string): Promise<Media> {
	const { ffprobe } = await tools();
	const { stdout } = await execFileAsync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
	const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[]; disposition?: { attached_pic?: number } }[] };
	const streams = info.streams ?? [];
	const video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
	const audio = streams.find(s => s.codec_type === 'audio');
	const image = IMAGE.test(file);
	const rate = (video?.avg_frame_rate && video.avg_frame_rate !== '0/0' ? video.avg_frame_rate : video?.r_frame_rate) ?? '';
	const [num, den] = rate.split('/').map(Number);
	// Phones record portrait video as landscape plus a rotation flag.
	const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.find(d => d.rotation !== undefined)?.rotation ?? 0)) % 180 === 90;
	return {
		id: uid('m'),
		path: file,
		name: path.basename(file),
		kind: image ? 'image' : video && !AUDIO.test(file) ? 'video' : 'audio',
		duration: image ? 5 : Number(info.format?.duration ?? video?.duration ?? audio?.duration ?? 0),
		width: rotation ? video?.height : video?.width,
		height: rotation ? video?.width : video?.height,
		fps: num && den ? Math.round(num / den * 1000) / 1000 : undefined,
		hasAudio: !!audio,
	};
}

/** Cache folder of one source file, keyed by its path, size and date. */
export function cacheFor(file: string): string {
	let stamp = '';
	try {
		const s = fs.statSync(file);
		stamp = `${s.size}-${s.mtimeMs}`;
	} catch {
		// missing file: the key still works
	}
	const dir = path.join(CACHE_DIR, createHash('sha1').update(`${file}|${stamp}`).digest('hex').slice(0, 16));
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** Peak levels, 100 per second, between 0 and 1 (one byte each, base64). */
export async function waveform(media: Media): Promise<string | undefined> {
	if (media.kind === 'image' || media.hasAudio === false) {
		return undefined;
	}
	const out = path.join(cacheFor(media.path), 'peaks.bin');
	if (!fs.existsSync(out)) {
		const { ffmpeg } = await tools();
		const pcm = await new Promise<Buffer>((resolve, reject) => {
			const chunks: Buffer[] = [];
			const child = spawn(ffmpeg, ['-v', 'error', '-i', media.path, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', '-'], { windowsHide: true });
			child.stdout.on('data', (c: Buffer) => chunks.push(c));
			child.on('error', reject);
			child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg (forme d'onde) : code ${code}`)));
		});
		const perBucket = 40;
		const buckets = Math.floor(pcm.length / 2 / perBucket);
		const peaks = Buffer.alloc(buckets);
		for (let b = 0; b < buckets; b++) {
			let max = 0;
			for (let i = 0; i < perBucket; i++) {
				max = Math.max(max, Math.abs(pcm.readInt16LE((b * perBucket + i) * 2)));
			}
			// Square root: quiet speech stays visible next to loud music.
			peaks[b] = Math.round(Math.sqrt(max / 32768) * 255);
		}
		fs.writeFileSync(out, peaks);
	}
	return fs.readFileSync(out).toString('base64');
}

/** A strip of small frames (one image), and the time between two of them. */
export async function filmstrip(media: Media): Promise<{ file: string; every: number; count: number; width: number; height: number } | undefined> {
	if (media.kind !== 'video') {
		return undefined;
	}
	const count = Math.max(1, Math.min(240, Math.ceil(media.duration / 2)));
	const every = media.duration / count;
	const height = 54;
	const width = Math.max(32, Math.round(height * (media.width ?? 16) / (media.height ?? 9)));
	const out = path.join(cacheFor(media.path), `strip-${count}.jpg`);
	if (!fs.existsSync(out)) {
		const { ffmpeg } = await tools();
		await execFileAsync(ffmpeg, ['-v', 'error', '-y', '-i', media.path, '-vf', `fps=${count}/${Math.max(0.1, media.duration)},scale=${width}:${height},tile=${count}x1`, '-frames:v', '1', '-q:v', '5', out], { windowsHide: true, timeout: 10 * 60 * 1000 });
	}
	return { file: out, every, count, width, height };
}

/** Quiet stretches: [start, end] in source seconds. */
export async function silences(file: string, thresholdDb = -38, minDuration = 0.45): Promise<[number, number][]> {
	const { ffmpeg } = await tools();
	const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`, '-f', 'null', '-'], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
	const result: [number, number][] = [];
	let open: number | undefined;
	for (const line of stderr.split(/\r?\n/)) {
		const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
		const e = /silence_end:\s*([\d.]+)/.exec(line);
		if (s) {
			open = Math.max(0, Number(s[1]));
		} else if (e && open !== undefined) {
			result.push([open, Number(e[1])]);
			open = undefined;
		}
	}
	return result;
}

/** 16 kHz mono PCM (float), for speech recognition in the page. */
export async function speechAudio(file: string, from: number, to: number): Promise<Buffer> {
	const { ffmpeg } = await tools();
	return new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = [];
		const child = spawn(ffmpeg, ['-v', 'error', '-ss', String(from), '-t', String(Math.max(0.1, to - from)), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { windowsHide: true });
		child.stdout.on('data', (c: Buffer) => chunks.push(c));
		child.on('error', reject);
		child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg (audio) : code ${code}`)));
	});
}

/**
 * A light copy that any page can play (VP9 720p), for codecs Chromium does not read
 * (HEVC from phones, ProRes, some MKV). Progress goes from 0 to 1.
 */
export async function proxy(media: Media, onProgress: (p: number) => void): Promise<string> {
	const out = path.join(cacheFor(media.path), 'proxy.webm');
	if (fs.existsSync(out)) {
		return out;
	}
	const { ffmpeg } = await tools();
	const tmp = `${out}.part.webm`;
	await run(ffmpeg, ['-y', '-i', media.path, '-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '2500k', '-c:a', 'libopus', '-b:a', '128k', tmp], media.duration, onProgress);
	fs.renameSync(tmp, out);
	return out;
}

/** Runs ffmpeg, reporting progress from its `-progress` output. Cancelling kills it. */
export function run(ffmpeg: string, args: string[], total: number, onProgress: (p: number) => void, token?: vscode.CancellationToken, cwd?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child: ChildProcess = spawn(ffmpeg, ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true, cwd });
		// Rendering and analysing give way to whatever the user is doing: at normal priority an export
		// took every core and the machine could hardly be used until it was over.
		try {
			if (child.pid) {
				os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
			}
		} catch {
			// the process is already gone, or the system refuses: it runs at normal priority
		}
		if (process.env.STARCAPTURE_DEBUG && cwd) {
			fs.writeFileSync(path.join(process.env.STARCAPTURE_DEBUG, 'args.json'), JSON.stringify({ ffmpeg, cwd, args }));
		}
		let log = '';
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			const m = /out_time_us=(\d+)/.exec(chunk) ?? /out_time_ms=(\d+)/.exec(chunk);
			if (m && total > 0) {
				onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
			}
		});
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			log = (log + chunk).slice(-6000);
		});
		token?.onCancellationRequested(() => child.kill());
		child.on('error', reject);
		child.on('close', code => {
			if (token?.isCancellationRequested) {
				reject(new vscode.CancellationError());
			} else if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ffmpeg a échoué (code ${code}) :\n${log.split('\n').filter(l => l.trim()).slice(-8).join('\n')}`));
			}
		});
	});
}

/** Hardware H.264 encoder of this machine, if ffmpeg has one that works. */
let hardware: string | null | undefined;
export async function hardwareEncoder(): Promise<string | undefined> {
	if (hardware !== undefined) {
		return hardware ?? undefined;
	}
	const { ffmpeg } = await tools();
	const candidates = process.platform === 'darwin' ? ['h264_videotoolbox'] : ['h264_nvenc', 'h264_qsv', 'h264_amf'];
	for (const encoder of candidates) {
		try {
			// A real one-frame encode: listed encoders may lack the driver.
			await execFileAsync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1', '-frames:v', '1', '-c:v', encoder, '-f', 'null', '-'], { windowsHide: true, timeout: 15000 });
			hardware = encoder;
			return encoder;
		} catch {
			// next one
		}
	}
	hardware = null;
	return undefined;
}
