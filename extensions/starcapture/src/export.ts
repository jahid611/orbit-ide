/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assScript } from './captions';
import { hardwareEncoder, run, tools } from './ffmpeg';
import { Animatable, Clip, Media, Project, duration, end, projectDuration } from './project';

export interface ExportPreset {
	id: string;
	label: string;
	detail: string;
	/** Output height; width follows the project's shape. 0 = project size. */
	height: number;
	container: 'mp4' | 'mov' | 'webm';
}

export const PRESETS: ExportPreset[] = [
	{ id: 'master', label: 'Taille du projet', detail: 'H.264, qualité maximale', height: 0, container: 'mp4' },
	{ id: '1080p', label: '1080p', detail: 'YouTube, H.264', height: 1080, container: 'mp4' },
	{ id: '4k', label: '4K', detail: 'YouTube 2160p, H.264', height: 2160, container: 'mp4' },
	{ id: '720p', label: '720p', detail: 'Léger, H.264', height: 720, container: 'mp4' },
	{ id: 'prores', label: 'ProRes 422 HQ', detail: 'Master pour l’étalonnage ou un autre logiciel', height: 0, container: 'mov' },
	{ id: 'webm', label: 'WebM', detail: 'VP9 + Opus, pour le web', height: 0, container: 'webm' },
];

export interface ExportOptions {
	preset: ExportPreset;
	/** Only this part of the timeline, in seconds. */
	range?: [number, number];
	/** Loudness normalisation to −14 LUFS (YouTube, TikTok, Instagram). */
	normalize?: boolean;
	hardware?: boolean;
	/** Folder of extra fonts for text (libass). */
	fontsDir?: string;
	/** Internal: render only the picture or only the sound of the range (the parts of a parallel render). */
	part?: 'video' | 'audio';
	/** Internal: the exact number of pictures a part must hold, so that parts add up to the film. */
	frames?: number;
}

interface Segment {
	clip: Clip;
	media: Media;
	/** Timeline span of this piece. */
	from: number;
	to: number;
	/** Source seconds. */
	srcIn: number;
	srcOut: number;
	/** Where in the file its decoder starts reading: the source times it sees are counted from there. */
	seek?: number;
}

/**
 * Renders the timeline with ffmpeg. Every track becomes one stream (its clips concatenated,
 * gaps transparent or silent), the streams are stacked, transitions are short extra layers,
 * and all text is one ASS script burnt in by libass.
 */
export async function exportProject(project: Project, out: string, options: ExportOptions, onProgress: (p: number, label: string) => void, token: vscode.CancellationToken): Promise<void> {
	const total = projectDuration(project);
	const [from, to] = options.range ?? [0, total];
	const length = to - from;
	if (options.part || options.preset.container !== 'mp4' || length < 12 || process.env.STARCAPTURE_EXPORT_PARTS === '0') {
		return renderRange(project, out, options, onProgress, token);
	}
	// The film is rendered in short parts, joined at the end without encoding anything again, and
	// its sound once, whole (its loudness is measured over the whole film). One graph for a whole
	// film opens every clip's decoder at once: their pictures pile up in memory waiting for their
	// turn, and two minutes took four to render where the same film in parts of eight seconds takes
	// one. A few parts are rendered at a time, never more than a quarter of the cores: six at once
	// (tried on 8 October 2026) took every core and 93 % of the memory, the machine could not be used.
	const jobs = Math.min(3, Math.max(1, Math.floor(os.cpus().length / 4)));
	const count = Math.ceil(length / 8);
	const { ffmpeg } = await tools();
	const fps = project.fps;
	// A part never starts inside a transition: it is drawn from the clip that follows it.
	const windows = project.clips.filter(c => c.transitionIn).map(c => [c.start - (c.transitionIn?.duration ?? 0), c.start] as const);
	const videoTracks = new Set(project.tracks.filter(t => t.kind === 'video').map(t => t.id));
	const starts = project.clips.filter(c => videoTracks.has(c.track) && !c.transitionIn && project.media.find(m => m.id === c.media)?.kind === 'video').map(c => c.start).filter(s => s > from + 1 && s < to - 1);
	const cuts = [from];
	for (let i = 1; i < count; i++) {
		let t = from + Math.round(length * i / count * fps) / fps;
		// Cut where a clip starts when one does nearby: a clip rendered in one piece is drawn exactly
		// as in a single render (a 50 i/s source shown at 60 repeats its pictures on a rhythm that
		// would otherwise start again at the cut).
		const near = starts.filter(s => Math.abs(s - t) < 4).sort((x, y) => Math.abs(x - t) - Math.abs(y - t))[0];
		if (near !== undefined) {
			t = near;
		}
		const inside = windows.find(w => t > w[0] - 1e-3 && t < w[1] + 2 / fps);
		if (inside) {
			t = Math.floor((inside[0] - 1 / fps) * fps) / fps;
		}
		if (t > cuts[cuts.length - 1] + 1) {
			cuts.push(t);
		}
	}
	cuts.push(to);
	const work = fs.mkdtempSync(path.join(os.tmpdir(), 'starcapture-parts-'));
	const partial = path.join(path.dirname(out), `.${path.basename(out, path.extname(out))}.rendu${path.extname(out)}`);
	const progress = new Array<number>(cuts.length).fill(0);
	const report = (i: number, p: number) => {
		progress[i] = p;
		// The picture is nearly all of the work: the sound counts for little.
		onProgress(Math.min(0.98, progress.slice(0, -1).reduce((a, b) => a + b, 0) / (cuts.length - 1) * 0.97 + progress[cuts.length - 1] * 0.03), 'Rendu…');
	};
	const stop = new vscode.CancellationTokenSource();
	const listener = token.onCancellationRequested(() => stop.cancel());
	try {
		const parts = cuts.slice(0, -1).map((_, i) => path.join(work, `part${String(i).padStart(2, '0')}.mp4`));
		const sound = path.join(work, 'sound.m4a');
		onProgress(0, 'Rendu…');
		try {
			let waiting = 0;
			const worker = async () => {
				while (waiting < parts.length) {
					const i = waiting++;
					await renderRange(project, parts[i], { ...options, range: [cuts[i], cuts[i + 1]], part: 'video', frames: Math.round((cuts[i + 1] - from) * fps) - Math.round((cuts[i] - from) * fps) }, p => report(i, p), stop.token);
				}
			};
			await Promise.all([
				...Array.from({ length: jobs }, worker),
				renderRange(project, sound, { ...options, range: [from, to], part: 'audio' }, p => report(cuts.length - 1, p), stop.token),
			]);
		} catch (error) {
			// One part failed: the others are stopped and the film is rendered in one go, as before.
			stop.cancel();
			if (token.isCancellationRequested) {
				throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 800));
			return await renderRange(project, out, options, onProgress, token);
		}
		fs.writeFileSync(path.join(work, 'parts.txt'), parts.map(part => `file '${part.replace(/\\/g, '/').replace(/'/g, '\'\\\'\'')}'`).join('\n'));
		fs.mkdirSync(path.dirname(out), { recursive: true });
		await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', 'parts.txt', '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-t', String(length), '-movflags', '+faststart', partial], length, () => undefined, token, work);
		fs.rmSync(out, { force: true });
		fs.renameSync(partial, out);
		onProgress(1, 'Rendu…');
	} finally {
		listener.dispose();
		stop.dispose();
		fs.rmSync(partial, { force: true });
		fs.rmSync(work, { recursive: true, force: true });
	}
}

/** Renders one range of the timeline with one ffmpeg: the whole film, or one part of a parallel render. */
async function renderRange(project: Project, out: string, options: ExportOptions, onProgress: (p: number, label: string) => void, token: vscode.CancellationToken): Promise<void> {
	const { ffmpeg } = await tools();
	const total = projectDuration(project);
	const [from, to] = options.range ?? [0, total];
	const length = Math.max(1 / project.fps, to - from);
	if (total <= 0) {
		throw new Error('La timeline est vide.');
	}
	const W = even(project.width);
	const H = even(project.height);
	const fps = project.fps;
	const work = fs.mkdtempSync(path.join(os.tmpdir(), 'starcapture-'));
	const media = new Map(project.media.map(m => [m.id, m]));
	const args: string[] = [];
	const graph: string[] = [];
	let inputs = 0;
	let label = 0;
	const next = (prefix: string) => `${prefix}${label++}`;

	/**
	 * One decoder per run of clips that read a file forwards and close to one another (the jump cuts
	 * of one take); a clip further on, or earlier, gets its own. Each decoder jumps straight to its
	 * first clip and stops after its last one. It used to read the file from its very beginning and
	 * to its end: a montage of short passages taken from twenty-minute videos had every minute of
	 * them decoded, several times over, and two minutes of film took ten to render.
	 */
	const NEAR = 12;
	const sources = new Map<string, { index: number; seek: number; lastOut: number; uses: string[]; length: number }[]>();
	const sourceFor = (m: Media, seg: Segment, kind: 'v' | 'a'): string => {
		const { srcIn, srcOut } = seg;
		const runs = sources.get(`${m.id}:${kind}`) ?? [];
		// A still image is looped from its first frame for each clip: never shared, or its frames would pile up.
		let run = m.kind === 'image' ? undefined : runs.find(r => r.lastOut <= srcIn + 1e-3 && srcIn - r.lastOut < NEAR);
		if (!run) {
			let seek = 0;
			let length = -1;
			if (m.kind === 'image') {
				args.push('-loop', '1', '-framerate', String(fps), '-t', String(Math.max(0.1, srcOut - srcIn) + 1), '-i', m.path);
			} else {
				// A little before the passage: the decoder lands on a whole picture, the cut itself stays exact.
				seek = Math.max(0, Math.floor((srcIn - 1) * 1000) / 1000);
				args.push('-ss', String(seek), '-t', '0', '-i', m.path);
				length = args.length - 3;
			}
			run = { index: inputs++, seek, lastOut: 0, uses: [], length };
			runs.push(run);
			sources.set(`${m.id}:${kind}`, runs);
		}
		seg.seek = run.seek;
		if (run.length >= 0) {
			// Read up to the end of its last clip, with room for a held last frame.
			args[run.length] = String(Math.ceil((srcOut - run.seek + 2) * 1000) / 1000);
		}
		run.lastOut = m.kind === 'image' ? 0 : srcOut;
		const pad = next(kind === 'v' ? 'sv' : 'sa');
		run.uses.push(pad);
		return pad;
	};

	const inRange = (c: Clip) => end(c) > from && c.start < to;
	const visible = (trackId: string) => {
		const track = project.tracks.find(t => t.id === trackId);
		return !!track && !track.hidden;
	};
	const audible = (trackId: string) => {
		const track = project.tracks.find(t => t.id === trackId);
		return !!track && !track.muted;
	};

	// --- video: bottom track first
	const videoTracks = options.part === 'audio' ? [] : project.tracks.filter(t => t.kind === 'video' && !t.hidden).reverse();
	graph.push(`color=c=${project.background.replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${options.part === 'audio' ? 1 / fps : length},format=yuva420p[base0]`);
	let canvas = 'base0';
	const transitions: { clip: Clip; prev?: Clip }[] = [];
	for (const track of videoTracks) {
		const clips = project.clips.filter(c => c.track === track.id && c.media && media.get(c.media)?.kind !== 'audio' && inRange(c)).sort((a, b) => a.start - b.start);
		if (!clips.length) {
			continue;
		}
		const pieces: string[] = [];
		let cursor = from;
		for (const clip of clips) {
			const m = media.get(clip.media!)!;
			const seg = segment(clip, m, from, to);
			if (seg.from > cursor + 1e-4) {
				pieces.push(gap(graph, next('g'), W, H, fps, seg.from - cursor));
			}
			const src = sourceFor(m, seg, 'v');
			pieces.push(videoPiece(graph, next('p'), src, seg, project, W, H));
			cursor = seg.to;
			if (clip.transitionIn && clip.start > from) {
				transitions.push({ clip, prev: clips.filter(c => end(c) <= clip.start + 1e-3).pop() });
			}
		}
		if (cursor < to - 1e-4) {
			pieces.push(gap(graph, next('g'), W, H, fps, to - cursor));
		}
		const trackOut = next('t');
		graph.push(`${pieces.map(p => `[${p}]`).join('')}concat=n=${pieces.length}:v=1:a=0,format=yuva420p[${trackOut}]`);
		const stacked = next('k');
		graph.push(`[${canvas}][${trackOut}]overlay=0:0:format=auto:eof_action=pass[${stacked}]`);
		canvas = stacked;
	}

	// --- transitions: short layers over the cut
	for (const { clip, prev } of transitions) {
		const t = clip.transitionIn!;
		const d = Math.min(t.duration, duration(clip), prev ? duration(prev) : t.duration);
		const cut = clip.start - from;
		if (t.type === 'dip-black' || t.type === 'dip-white') {
			// A flash of colour peaking on the cut.
			const flash = next('f');
			const c = t.type === 'dip-white' ? 'white' : 'black';
			graph.push(`color=c=${c}:s=${W}x${H}:r=${fps}:d=${d},format=yuva420p,fade=t=in:st=0:d=${d / 2}:alpha=1,fade=t=out:st=${d / 2}:d=${d / 2}:alpha=1,setpts=PTS+${Math.max(0, cut - d / 2)}/TB[${flash}]`);
			const o = next('k');
			graph.push(`[${canvas}][${flash}]overlay=0:0:eof_action=pass[${o}]`);
			canvas = o;
			continue;
		}
		// The incoming clip starts d seconds early, over the outgoing one.
		const m = media.get(clip.media!)!;
		const pre: Segment = { clip: { ...clip, transitionIn: undefined, fadeIn: 0, fadeOut: 0, keyframes: {} }, media: m, from: clip.start - d, to: clip.start, srcIn: Math.max(0, clip.in - d * clip.speed), srcOut: clip.in };
		const src = sourceFor(m, pre, 'v');
		const piece = videoPiece(graph, next('p'), src, pre, project, W, H, true);
		const moved = next('m');
		const p = `(t/${d})`;
		const ease = `(${p}*${p}*(3-2*${p}))`;
		let chain = 'format=yuva420p';
		let x = '0';
		let y = '0';
		if (t.type === 'crossfade' || t.type === 'zoom-in' || t.type === 'zoom-out') {
			chain += `,fade=t=in:st=0:d=${d}:alpha=1`;
		}
		if (t.type === 'zoom-in' || t.type === 'zoom-out') {
			const s = t.type === 'zoom-in' ? `(1.25-0.25*${ease})` : `(0.8+0.2*${ease})`;
			chain += `,scale=w='trunc(iw*${s}/2)*2':h=-2:eval=frame`;
			x = '(main_w-overlay_w)/2';
			y = '(main_h-overlay_h)/2';
		}
		const local = `(t-${Math.max(0, cut - d)})`;
		const q = `min(1,max(0,${local}/${d}))`;
		const e = `(${q}*${q}*(3-2*${q}))`;
		if (t.type === 'slide-left') {
			x = `${W}*(1-${e})`;
		} else if (t.type === 'slide-right') {
			x = `-${W}*(1-${e})`;
		} else if (t.type === 'slide-up') {
			y = `${H}*(1-${e})`;
		}
		graph.push(`[${piece}]${chain},setpts=PTS+${Math.max(0, cut - d)}/TB[${moved}]`);
		const o = next('k');
		graph.push(`[${canvas}][${moved}]overlay=x='${x}':y='${y}':eof_action=pass[${o}]`);
		canvas = o;
	}

	// --- text: one ASS script for every text clip
	const texts = options.part === 'audio' ? [] : project.clips.filter(c => c.text && visible(c.track) && inRange(c));
	let video = canvas;
	if (texts.length) {
		fs.writeFileSync(path.join(work, 'texts.ass'), assScript(project, texts, from));
		const withText = next('x');
		const fonts = options.fontsDir ? `:fontsdir='${filterPath(options.fontsDir)}'` : '';
		graph.push(`[${canvas}]subtitles=filename=texts.ass${fonts}[${withText}]`);
		video = withText;
	}
	const finalVideo = next('vout');
	const outHeight = options.preset.height ? even(options.preset.height) : H;
	const outWidth = options.preset.height ? even(Math.round(W * outHeight / H)) : W;
	const pix = options.preset.container === 'mov' ? 'yuv422p10le' : 'yuv420p';
	graph.push(`[${video}]${outHeight !== H ? `scale=${outWidth}:${outHeight}:flags=lanczos,` : ''}format=${pix}${options.frames ? ',tpad=stop_mode=clone:stop_duration=0.5' : ''}[${finalVideo}]`);

	// --- audio: one stream per track, then the mix
	const audioPieces: string[] = [];
	// Sound lives on audio tracks: a video's sound is its linked clip there, so it can be cut on its own (J/L cuts).
	for (const track of options.part === 'video' ? [] : project.tracks.filter(t => t.kind === 'audio' && audible(t.id))) {
		const clips = project.clips.filter(c => c.track === track.id && c.media && inRange(c) && media.get(c.media)!.hasAudio !== false && media.get(c.media)!.kind !== 'image' && c.volume > 0).sort((a, b) => a.start - b.start);
		if (!clips.length) {
			continue;
		}
		const pieces: string[] = [];
		let cursor = from;
		for (const clip of clips) {
			const m = media.get(clip.media!)!;
			const seg = segment(clip, m, from, to);
			if (seg.from > cursor + 1e-4) {
				pieces.push(silence(graph, next('z'), seg.from - cursor));
			}
			pieces.push(audioPiece(graph, next('ap'), sourceFor(m, seg, 'a'), seg));
			cursor = seg.to;
		}
		if (cursor < to - 1e-4) {
			pieces.push(silence(graph, next('z'), to - cursor));
		}
		const t = next('at');
		graph.push(`${pieces.map(p => `[${p}]`).join('')}concat=n=${pieces.length}:v=0:a=1[${t}]`);
		audioPieces.push(t);
	}
	const finalAudio = next('aout');
	if (!audioPieces.length) {
		graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${length}[${finalAudio}]`);
	} else {
		const mixed = audioPieces.length > 1 ? `${audioPieces.map(p => `[${p}]`).join('')}amix=inputs=${audioPieces.length}:normalize=0:dropout_transition=0,` : `[${audioPieces[0]}]`;
		graph.push(`${mixed}${options.normalize ? 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,' : ''}alimiter=limit=0.97,atrim=0:${length}[${finalAudio}]`);
	}

	// --- splits: a source read by several clips feeds them all
	for (const [key, runs] of sources) {
		const kind = key.endsWith(':a') ? 'a' : 'v';
		for (const r of runs) {
			const stream = `${r.index}:${kind}`;
			graph.unshift(r.uses.length === 1 ? `[${stream}]${kind === 'a' ? 'anull' : 'null'}[${r.uses[0]}]` : `[${stream}]${kind === 'a' ? 'asplit' : 'split'}=${r.uses.length}${r.uses.map(u => `[${u}]`).join('')}`);
		}
	}

	const script = path.join(work, 'graph.txt');
	fs.writeFileSync(script, graph.join(';\n'));
	const codec = await videoCodec(options);
	if (options.part) {
		// The half that is not wanted still has to end somewhere.
		fs.appendFileSync(script, options.part === 'video' ? `;\n[${finalAudio}]anullsink` : `;\n[${finalVideo}]nullsink`);
	}
	const audioAt = codec.indexOf('-c:a');
	const encode = [
		'-y', ...args,
		'-/filter_complex', script,
		...(options.part === 'audio' ? [] : ['-map', `[${finalVideo}]`]), ...(options.part === 'video' ? [] : ['-map', `[${finalAudio}]`]),
		...(options.part === 'audio' ? [] : ['-r', String(fps)]), ...(options.frames ? ['-frames:v', String(options.frames)] : ['-t', String(length)]),
		...(options.part === 'video' ? codec.slice(0, audioAt) : options.part === 'audio' ? codec.slice(audioAt) : codec),
		out,
	];
	fs.mkdirSync(path.dirname(out), { recursive: true });
	// Rendered under a hidden name, renamed when complete: nothing opens a half-written video.
	const partial = path.join(path.dirname(out), `.${path.basename(out, path.extname(out))}.rendu${path.extname(out)}`);
	encode[encode.length - 1] = partial;
	onProgress(0, 'Rendu…');
	try {
		await runIn(work, ffmpeg, encode, length, p => onProgress(p, 'Rendu…'), token);
		fs.rmSync(out, { force: true });
		fs.renameSync(partial, out);
	} finally {
		fs.rmSync(partial, { force: true });
		fs.rmSync(work, { recursive: true, force: true });
	}
}

/** The visible part of a clip inside the exported range. */
function segment(clip: Clip, m: Media, from: number, to: number): Segment {
	const a = Math.max(clip.start, from);
	const b = Math.min(end(clip), to);
	const srcIn = clip.in + (a - clip.start) * clip.speed;
	const srcOut = Math.min(m.kind === 'image' ? Infinity : m.duration || Infinity, clip.in + (b - clip.start) * clip.speed);
	return { clip, media: m, from: a, to: b, srcIn, srcOut };
}

/** One clip as a full-frame transparent picture, transform and effects applied. */
function videoPiece(graph: string[], name: string, source: string, s: Segment, project: Project, W: number, H: number, pre = false): string {
	let src = source;
	const c = s.clip;
	const len = s.to - s.from;
	const local = s.from - c.start;
	const f: string[] = [];
	if (s.media.kind === 'image') {
		f.push(`trim=duration=${len}`);
	} else {
		f.push(`trim=start=${s.srcIn - (s.seek ?? 0)}:end=${Math.max(s.srcIn + 0.001, s.srcOut) - (s.seek ?? 0)}`);
	}
	f.push('setpts=PTS-STARTPTS');
	if (c.speed !== 1 && s.media.kind !== 'image') {
		f.push(`setpts=PTS/${c.speed}`);
	}
	// A source shorter than its clip holds its last frame.
	f.push(`fps=${project.fps}`, `tpad=stop_mode=clone:stop_duration=${len}`, `trim=duration=${len}`, 'setpts=PTS-STARTPTS');
	const cr = c.crop;
	if (cr.left || cr.right || cr.top || cr.bottom) {
		f.push(`crop=iw*${1 - cr.left - cr.right}:ih*${1 - cr.top - cr.bottom}:iw*${cr.left}:ih*${cr.top}`);
	}
	if (c.mirror) {
		f.push('hflip');
	}
	const col = c.color;
	if (col.brightness || col.contrast || col.saturation) {
		f.push(`eq=brightness=${col.brightness * .5}:contrast=${1 + col.contrast}:saturation=${1 + col.saturation}`);
	}
	if (col.hue) {
		f.push(`hue=h=${col.hue}`);
	}
	if (col.temperature) {
		const t = col.temperature * .25;
		f.push(`colorbalance=rs=${t}:gs=${t * .2}:bs=${-t}:rm=${t * .6}:bm=${-t * .6}`);
	}
	if (c.blur) {
		f.push(`gblur=sigma=${c.blur * 2}`);
	}
	const angle = (Math.PI / 5 * col.vignette).toFixed(3);
	// On a video of known size the vignette is a mask (below); elsewhere, ffmpeg's own filter.
	const masked = col.vignette > 0 && s.media.kind === 'video' && !!s.media.width && !!s.media.height;
	if (col.vignette > 0 && !masked) {
		f.push(`vignette=angle=${angle}`);
	}
	// Fit into the frame.
	const fit = c.fit === 'cover' ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}` : c.fit === 'stretch' ? `scale=${W}:${H}` : `scale=${W}:${H}:force_original_aspect_ratio=decrease`;
	f.push(fit);
	if (masked) {
		// ffmpeg's vignette filter works out every pixel of every frame, on one core: it was a
		// third of the rendering time. The darkening is the same on every frame, so it is drawn
		// once, as a black picture more or less transparent, and laid over the video.
		const ratio = (s.media.width! * (1 - cr.left - cr.right)) / (s.media.height! * (1 - cr.top - cr.bottom));
		const [w, h] = c.fit !== 'contain' ? [W, H] : ratio > W / H ? [W, W / ratio] : [H * ratio, H];
		// A little larger than the picture, whose size ffmpeg rounds its own way: no bright edge.
		const size = `${even(w) + 4}x${even(h) + 4}`;
		graph.push(`[${src}]${f.join(',')},format=yuv420p[${name}v]`);
		graph.push(`color=c=white:s=${size}:r=1:d=1,format=gray,vignette=angle=${angle}:dither=0,negate,trim=end_frame=1[${name}ma]`);
		graph.push(`color=c=black:s=${size}:r=1:d=1,format=yuv420p,trim=end_frame=1[${name}mb]`);
		graph.push(`[${name}mb][${name}ma]alphamerge[${name}m]`);
		graph.push(`[${name}v][${name}m]overlay=x=-2:y=-2:eof_action=repeat[${name}w]`);
		src = `${name}w`;
		f.length = 0;
	}
	f.push('format=yuva420p');
	const animated = (p: Animatable) => !!c.keyframes[p]?.length;
	const plain = !animated('scale') && !animated('x') && !animated('y') && !animated('rotation') && !animated('opacity') && c.scale === 1 && !c.x && !c.y && !c.rotation && !c.shake;
	if (c.scale !== 1 || animated('scale')) {
		f.push(`scale=w='max(2,trunc(iw*${expr(c, 'scale', local)}/2)*2)':h=-2:eval=frame`);
	}
	if (c.rotation || animated('rotation')) {
		f.push(`rotate=a='(${expr(c, 'rotation', local)})*PI/180':c=none:ow='hypot(iw,ih)':oh=ow`);
	}
	if (c.opacity < 1 || animated('opacity')) {
		f.push(animated('opacity') ? `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='alpha(X,Y)*(${expr(c, 'opacity', local, 'T')})'` : `colorchannelmixer=aa=${c.opacity}`);
	}
	if (!pre && c.fadeIn > 0 && local < c.fadeIn) {
		f.push(`fade=t=in:st=0:d=${c.fadeIn - local}:alpha=1`);
	}
	const fadeOutStart = duration(c) - c.fadeOut - local;
	if (!pre && c.fadeOut > 0 && fadeOutStart < len) {
		f.push(`fade=t=out:st=${Math.max(0, fadeOutStart)}:d=${Math.min(c.fadeOut, len)}:alpha=1`);
	}
	// A clip that fills the frame as it is needs no placing (the usual case: jump cuts of one camera).
	const cropped = cr.left || cr.right || cr.top || cr.bottom;
	const fills = c.fit !== 'contain' || (!cropped && !!s.media.width && !!s.media.height && Math.abs(s.media.width / s.media.height - W / H) < 0.01);
	if (plain && fills) {
		f.push(c.fit === 'contain' ? `scale=${W}:${H}` : 'null', 'setsar=1');
		graph.push(`[${src}]${f.join(',')}[${name}]`);
		return name;
	}
	// Place it on a transparent full frame.
	const layer = `${name}l`;
	const frame = `${name}f`;
	graph.push(`[${src}]${f.join(',')}[${layer}]`);
	graph.push(`color=c=black@0:s=${W}x${H}:r=${project.fps}:d=${len},format=yuva420p[${frame}]`);
	const shake = c.shake ? `+${(c.shake * 18).toFixed(1)}*sin(t*61)*max(0,1-t/0.35)` : '';
	const shakeY = c.shake ? `+${(c.shake * 14).toFixed(1)}*cos(t*53)*max(0,1-t/0.35)` : '';
	graph.push(`[${frame}][${layer}]overlay=x='(main_w-overlay_w)/2+(${expr(c, 'x', local)})${shake}':y='(main_h-overlay_h)/2+(${expr(c, 'y', local)})${shakeY}':eval=frame:format=auto:shortest=1,setsar=1[${name}]`);
	return name;
}

function audioPiece(graph: string[], name: string, src: string, s: Segment): string {
	const c = s.clip;
	const len = s.to - s.from;
	const local = s.from - c.start;
	const f = [`atrim=start=${s.srcIn - (s.seek ?? 0)}:end=${Math.max(s.srcIn + 0.001, s.srcOut) - (s.seek ?? 0)}`, 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=channel_layouts=stereo'];
	let speed = c.speed;
	while (speed > 2.0001) {
		f.push('atempo=2');
		speed /= 2;
	}
	while (speed < 0.4999) {
		f.push('atempo=0.5');
		speed /= .5;
	}
	if (Math.abs(speed - 1) > 1e-4) {
		f.push(`atempo=${speed}`);
	}
	f.push(c.keyframes.volume?.length ? `volume='${expr(c, 'volume', local)}':eval=frame` : `volume=${c.volume}`);
	// Fades, plus a few milliseconds on every cut so jump cuts never click.
	const fadeIn = Math.max(c.fadeIn - local, 0.008);
	f.push(`afade=t=in:st=0:d=${Math.min(fadeIn, len / 2)}`);
	const outStart = duration(c) - Math.max(c.fadeOut, 0.008) - local;
	f.push(`afade=t=out:st=${Math.max(0, Math.min(len - 0.008, outStart))}:d=${Math.min(Math.max(c.fadeOut, 0.008), len)}`);
	f.push(`apad=whole_dur=${len}`, `atrim=duration=${len}`);
	graph.push(`[${src}]${f.join(',')}[${name}]`);
	return name;
}

function gap(graph: string[], name: string, W: number, H: number, fps: number, len: number): string {
	graph.push(`color=c=black@0:s=${W}x${H}:r=${fps}:d=${len},format=yuva420p,setsar=1[${name}]`);
	return name;
}

function silence(graph: string[], name: string, len: number): string {
	graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${len}[${name}]`);
	return name;
}

/**
 * An ffmpeg expression for an animated property at stream time `t` (or `T` in geq),
 * piecewise between keyframes with a smooth step, like the preview.
 */
function expr(c: Clip, prop: Animatable, offset: number, timeVar = 't'): string {
	const base = prop === 'volume' ? c.volume : c[prop];
	const keys = [...(c.keyframes[prop] ?? [])].sort((a, b) => a.t - b.t);
	if (!keys.length) {
		return String(base);
	}
	const t = `(${timeVar}+${offset})`;
	let out = String(keys[keys.length - 1].v);
	for (let i = keys.length - 2; i >= 0; i--) {
		const a = keys[i];
		const b = keys[i + 1];
		const p = `((${t}-${a.t})/${Math.max(1e-6, b.t - a.t)})`;
		const shaped = a.ease === 'linear' ? p : a.ease === 'hold' ? '0' : `(${p}*${p}*(3-2*${p}))`;
		out = `if(lt(${t},${b.t}),${a.v}+(${b.v - a.v})*${shaped},${out})`;
	}
	return `if(lt(${t},${keys[0].t}),${keys[0].v},${out})`;
}

async function videoCodec(options: ExportOptions): Promise<string[]> {
	const audio = options.preset.container === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k'] : options.preset.container === 'mov' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '320k'];
	if (options.preset.container === 'mov') {
		return ['-c:v', 'prores_ks', '-profile:v', '3', ...audio];
	}
	if (options.preset.container === 'webm') {
		return ['-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', ...audio];
	}
	const hw = options.hardware ? await hardwareEncoder() : undefined;
	const video = hw === 'h264_nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-profile:v', 'high']
		: hw === 'h264_videotoolbox' ? ['-c:v', 'h264_videotoolbox', '-q:v', '68', '-profile:v', 'high']
			: hw ? ['-c:v', hw, '-global_quality', '20']
				: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high'];
	return [...video, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...audio];
}

/** Runs ffmpeg in `cwd`: the ASS script is referenced relatively, which sidesteps filter escaping. */
function runIn(cwd: string, ffmpeg: string, args: string[], total: number, onProgress: (p: number) => void, token: vscode.CancellationToken): Promise<void> {
	return run(ffmpeg, args, total, onProgress, token, cwd);
}

function even(n: number): number {
	return Math.max(2, Math.round(n / 2) * 2);
}

function filterPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, '\\\'');
}
