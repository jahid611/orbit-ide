/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Clip, Media, Project, TextStyle, Track, TrackKind, TransitionType, duration, end, newClip, uid } from './project';

const EPS = 1e-4;

/** Text looks, from the classic title to the big YouTube captions. */
export const TEXT_PRESETS: Record<string, { label: string; style: Partial<TextStyle>; y: number }> = {
	title: { label: 'Titre', y: 0, style: { font: 'Arial Black', size: 120, weight: 900, color: '#ffffff', stroke: '#000000', strokeWidth: 0, shadow: 6, animation: 'pop' } },
	youtube: { label: 'Mot choc (YouTube)', y: 0, style: { font: 'Arial Black', size: 140, weight: 900, color: '#ffffff', stroke: '#000000', strokeWidth: 12, shadow: 8, uppercase: true, animation: 'pop' } },
	beast: { label: 'Énorme jaune', y: -200, style: { font: 'Impact', size: 180, weight: 900, color: '#ffe600', stroke: '#000000', strokeWidth: 14, shadow: 10, uppercase: true, animation: 'bounce' } },
	caption: { label: 'Sous-titre karaoké', y: 330, style: { font: 'Arial Black', size: 78, weight: 900, color: '#ffffff', stroke: '#000000', strokeWidth: 8, shadow: 4, uppercase: true, highlight: '#ffe600', animation: 'pop' } },
	subtitle: { label: 'Sous-titre sobre', y: 400, style: { font: 'Segoe UI', size: 56, weight: 600, color: '#ffffff', stroke: '#000000', strokeWidth: 4, shadow: 2, animation: 'none' } },
	lowerThird: { label: 'Bandeau nom', y: 360, style: { font: 'Segoe UI', size: 54, weight: 700, color: '#ffffff', background: '#8b7bffee', stroke: '#000000', strokeWidth: 0, shadow: 0, animation: 'slide-up', align: 'center' } },
	minimal: { label: 'Minimal', y: 0, style: { font: 'Segoe UI', size: 72, weight: 300, color: '#ffffff', stroke: '#000000', strokeWidth: 0, shadow: 3, animation: 'fade' } },
	typewriter: { label: 'Machine à écrire', y: 0, style: { font: 'Consolas', size: 72, weight: 600, color: '#5eead4', stroke: '#000000', strokeWidth: 0, shadow: 4, animation: 'typewriter' } },
};

export function textStyle(content: string, preset = 'title', overrides: Partial<TextStyle> = {}): TextStyle {
	return {
		content,
		font: 'Arial Black',
		size: 96,
		weight: 800,
		color: '#ffffff',
		stroke: '#000000',
		strokeWidth: 0,
		background: '',
		shadow: 4,
		align: 'center',
		animation: 'none',
		...(TEXT_PRESETS[preset]?.style ?? {}),
		...overrides,
	};
}

export function track(project: Project, id: string): Track | undefined {
	return project.tracks.find(t => t.id === id);
}

/** First track of a kind (the main one: lowest video track, first audio track), creating it if needed. */
export function mainTrack(project: Project, kind: TrackKind): Track {
	const list = project.tracks.filter(t => t.kind === kind);
	const found = kind === 'video' ? list[list.length - 1] : list[0];
	return found ?? addTrack(project, kind);
}

export function addTrack(project: Project, kind: TrackKind): Track {
	const n = project.tracks.filter(t => t.kind === kind).length + 1;
	const prefix = kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'T';
	let id = `${prefix}${n}`;
	while (project.tracks.some(t => t.id === id)) {
		id = `${prefix}${Number(id.slice(1)) + 1}`;
	}
	const t: Track = { id, kind, name: kind === 'video' ? `Vidéo ${n}` : kind === 'audio' ? `Audio ${n}` : `Textes ${n}` };
	// Video and text tracks stack upwards: the new one goes above its kind.
	const index = kind === 'audio' ? project.tracks.length : Math.max(0, project.tracks.findIndex(x => x.kind === kind));
	project.tracks.splice(index, 0, t);
	return t;
}

/** Puts a clip on its track, cutting away whatever it covers (overwrite edit). */
export function place(project: Project, clip: Clip): void {
	const a = clip.start;
	const b = end(clip);
	const others = project.clips.filter(c => c.track === clip.track && c.id !== clip.id);
	for (const o of others) {
		const oa = o.start;
		const ob = end(o);
		if (ob <= a + EPS || oa >= b - EPS) {
			continue;
		}
		if (oa >= a - EPS && ob <= b + EPS) {
			project.clips.splice(project.clips.indexOf(o), 1);
		} else if (oa < a && ob > b) {
			// The new clip lands in the middle: keep both sides.
			const right: Clip = { ...structuredClone(o), id: uid('c'), link: undefined, start: b, in: o.in + (b - oa) * o.speed, transitionIn: undefined };
			o.out = o.in + (a - oa) * o.speed;
			project.clips.push(right);
		} else if (oa < a) {
			o.out = o.in + (a - oa) * o.speed;
		} else {
			o.in += (b - oa) * o.speed;
			o.start = b;
			o.transitionIn = undefined;
		}
	}
	if (!project.clips.includes(clip)) {
		project.clips.push(clip);
	}
}

/** A media file on the timeline: its picture on a video track, its sound on a linked audio clip. */
export function addMediaClip(project: Project, media: Media, options: { start?: number; in?: number; out?: number; track?: string } = {}): Clip[] {
	const from = Math.max(0, options.in ?? 0);
	const to = Math.min(media.duration, options.out ?? media.duration);
	// Pictures follow each other; a music or a sound goes under the edit, from its beginning.
	const start = options.start ?? (media.kind === 'audio' ? 0 : Math.max(0, ...project.clips.filter(c => c.media && track(project, c.track)?.kind === 'video').map(end)));
	const added: Clip[] = [];
	const link = media.kind === 'video' && media.hasAudio ? uid('l') : undefined;
	if (media.kind !== 'audio') {
		const t = options.track && track(project, options.track)?.kind === 'video' ? options.track : mainTrack(project, 'video').id;
		const clip = newClip({ track: t, media: media.id, name: media.name, start, in: from, out: to, link });
		// Portrait footage in a landscape project (or the reverse) fills the frame height; a crop is one click away.
		place(project, clip);
		added.push(clip);
	}
	if (media.kind === 'audio' || link) {
		// A recording's sound goes with it on the main audio track; a music or sound file
		// goes to the first audio track free at that moment, never over the voice.
		const free = (id: string) => !project.clips.some(c => c.track === id && c.start < start + (to - from) - EPS && end(c) > start + EPS);
		const freeTrack = () => project.tracks.filter(t => t.kind === 'audio').find(t => free(t.id))?.id ?? addTrack(project, 'audio').id;
		const audioTrack = options.track && track(project, options.track)?.kind === 'audio' ? options.track : link ? mainTrack(project, 'audio').id : freeTrack();
		const clip = newClip({ track: audioTrack, media: media.id, name: media.name, start, in: from, out: to, link });
		place(project, clip);
		added.push(clip);
	}
	return added;
}

export function addText(project: Project, content: string, start: number, length: number, preset = 'title', overrides: Partial<TextStyle> = {}, trackId?: string): Clip {
	const t = trackId && track(project, trackId)?.kind === 'text' ? trackId : mainTrack(project, 'text').id;
	// Presets are drawn for 1080p: scale them to the frame (720p, 4K, vertical).
	const k = Math.min(project.width, project.height) / 1080;
	const style = textStyle(content, preset, overrides);
	if (overrides.size === undefined) {
		style.size = Math.round(style.size * k);
	}
	if (overrides.strokeWidth === undefined) {
		style.strokeWidth = Math.round(style.strokeWidth * k * 10) / 10;
	}
	if (overrides.shadow === undefined) {
		style.shadow = Math.round(style.shadow * k * 10) / 10;
	}
	// Vertical frames keep captions in the lower third, above the app's interface.
	const y = (TEXT_PRESETS[preset]?.y ?? 0) * (project.height > project.width ? project.height / 1920 * 1.6 : project.height / 1080);
	const clip = newClip({ track: t, name: content.slice(0, 40), start, in: 0, out: Math.max(0.1, length), y: Math.round(y), text: style });
	place(project, clip);
	return clip;
}

/** Clips moving together: a picture and its sound. */
export function linked(project: Project, ids: string[]): Clip[] {
	const set = new Set(ids);
	const links = new Set(project.clips.filter(c => set.has(c.id) && c.link).map(c => c.link));
	return project.clips.filter(c => set.has(c.id) || (c.link && links.has(c.link)));
}

/** Cuts every clip under `time` (or only the given ones and their linked sound). Returns the new right-hand clips. */
export function split(project: Project, time: number, ids?: string[]): Clip[] {
	const targets = (ids?.length ? linked(project, ids) : project.clips).filter(c => c.start < time - EPS && end(c) > time + EPS && !track(project, c.track)?.locked);
	const relink = new Map<string, string>();
	const created: Clip[] = [];
	for (const c of targets) {
		const right: Clip = structuredClone(c);
		right.id = uid('c');
		right.start = time;
		right.in = c.in + (time - c.start) * c.speed;
		right.transitionIn = undefined;
		right.fadeIn = 0;
		if (c.link) {
			right.link = relink.get(c.link) ?? uid('l');
			relink.set(c.link, right.link);
		}
		// Keyframes follow the time they belong to.
		const local = time - c.start;
		for (const key of Object.keys(c.keyframes) as (keyof Clip['keyframes'])[]) {
			right.keyframes[key] = c.keyframes[key]!.filter(k => k.t >= local).map(k => ({ ...k, t: k.t - local }));
			c.keyframes[key] = c.keyframes[key]!.filter(k => k.t <= local);
		}
		if (c.text?.wordTimes) {
			right.text!.wordTimes = c.text.wordTimes.map(w => Math.max(0, w - local));
		}
		c.out = right.in;
		c.fadeOut = 0;
		project.clips.push(right);
		created.push(right);
	}
	return created;
}

/** Removes clips; `ripple` closes the holes on every track so everything stays in sync. */
export function remove(project: Project, ids: string[], ripple = false): void {
	const doomed = linked(project, ids).filter(c => !track(project, c.track)?.locked);
	const ranges = merge(doomed.map(c => [c.start, end(c)] as [number, number]));
	project.clips = project.clips.filter(c => !doomed.includes(c));
	if (ripple) {
		closeGaps(project, ranges);
	}
}

/** Cuts a stretch of time out of the whole timeline (silences, a flubbed sentence…) and closes it. */
export function removeRanges(project: Project, ranges: [number, number][]): number {
	const merged = merge(ranges.filter(([a, b]) => b - a > EPS));
	let removed = 0;
	for (const [a, b] of [...merged].reverse()) {
		split(project, a);
		split(project, b);
		const inside = project.clips.filter(c => c.start >= a - EPS && end(c) <= b + EPS && !track(project, c.track)?.locked && !c.text);
		project.clips = project.clips.filter(c => !inside.includes(c));
		// Texts spanning the hole get shorter instead of vanishing.
		for (const t of project.clips.filter(c => c.text && c.start < b && end(c) > a)) {
			const cutA = Math.max(a, t.start);
			const cutB = Math.min(b, end(t));
			t.out -= (cutB - cutA) * t.speed;
			if (t.start > a) {
				t.start = a;
			}
		}
		project.clips = project.clips.filter(c => duration(c) > 0.04);
		closeGaps(project, [[a, b]]);
		removed += b - a;
	}
	return removed;
}

function closeGaps(project: Project, ranges: [number, number][]): void {
	for (const [a, b] of [...ranges].sort((x, y) => y[0] - x[0])) {
		for (const c of project.clips) {
			if (c.start >= b - EPS && !track(project, c.track)?.locked) {
				c.start -= b - a;
			}
		}
		for (const m of project.markers) {
			if (m.t >= b) {
				m.t -= b - a;
			}
		}
	}
}

function merge(ranges: [number, number][]): [number, number][] {
	const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
	const out: [number, number][] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r[0] <= last[1] + EPS) {
			last[1] = Math.max(last[1], r[1]);
		} else {
			out.push([r[0], r[1]]);
		}
	}
	return out;
}

/** Source-time ranges of a media → timeline ranges, through its clips on audio tracks. */
export function sourceToTimeline(project: Project, mediaId: string, ranges: [number, number][]): [number, number][] {
	const clips = project.clips.filter(c => c.media === mediaId && track(project, c.track)?.kind === 'audio');
	const out: [number, number][] = [];
	for (const c of clips) {
		for (const [s, e] of ranges) {
			const a = Math.max(s, c.in);
			const b = Math.min(e, c.out);
			if (b > a) {
				out.push([c.start + (a - c.in) / c.speed, c.start + (b - c.in) / c.speed]);
			}
		}
	}
	return out.sort((x, y) => x[0] - y[0]);
}

/** Deep-merges a patch into a clip (crop, colour, text, keyframes are merged field by field). */
export function update(project: Project, id: string, patch: Partial<Clip> & Record<string, unknown>): Clip {
	const clip = project.clips.find(c => c.id === id);
	if (!clip) {
		throw new Error(`Clip introuvable : ${id}`);
	}
	const { crop, color, text, keyframes, ...rest } = patch;
	const moved = rest.start !== undefined || rest.track !== undefined || rest.in !== undefined || rest.out !== undefined || rest.speed !== undefined;
	Object.assign(clip, rest);
	if (crop) {
		clip.crop = { ...clip.crop, ...crop };
	}
	if (color) {
		clip.color = { ...clip.color, ...color };
	}
	if (text) {
		clip.text = { ...(clip.text ?? textStyle('')), ...text };
	}
	if (keyframes) {
		clip.keyframes = { ...clip.keyframes, ...keyframes };
	}
	clip.start = Math.max(0, clip.start);
	clip.speed = Math.min(16, Math.max(0.1, clip.speed || 1));
	if (clip.out <= clip.in) {
		clip.out = clip.in + 0.04;
	}
	const media = clip.media ? project.media.find(m => m.id === clip.media) : undefined;
	if (media && media.kind !== 'image') {
		clip.in = Math.max(0, clip.in);
		clip.out = Math.min(media.duration, clip.out);
	}
	if (moved) {
		place(project, clip);
	}
	return clip;
}

export function setTransition(project: Project, id: string, type: TransitionType | 'none', length = 0.5): void {
	const clip = project.clips.find(c => c.id === id);
	if (!clip) {
		throw new Error(`Clip introuvable : ${id}`);
	}
	clip.transitionIn = type === 'none' ? undefined : { type, duration: Math.max(0.1, Math.min(3, length)) };
}

/**
 * Music ducking: the music clip drops to `level` whenever someone speaks (transcript words,
 * on the timeline) and comes back up in pauses longer than `gap` seconds, with soft ramps.
 */
export function duck(project: Project, musicId: string, speech: { t: number; end: number }[], level = 0.2, gap = 1.2, ramp = 0.25): number {
	const music = project.clips.find(c => c.id === musicId);
	if (!music) {
		throw new Error(`Clip introuvable : ${musicId}`);
	}
	// Speaking stretches, joined across short pauses.
	const spans: [number, number][] = [];
	for (const w of [...speech].sort((a, b) => a.t - b.t)) {
		const last = spans[spans.length - 1];
		if (last && w.t - last[1] < gap) {
			last[1] = Math.max(last[1], w.end);
		} else {
			spans.push([w.t, w.end]);
		}
	}
	const full = music.volume || 1;
	const low = full * level;
	const keys: { t: number; v: number; ease?: 'linear' | 'in' | 'out' | 'inout' | 'hold' }[] = [{ t: 0, v: full, ease: 'linear' }];
	const length = duration(music);
	for (const [a, b] of spans) {
		const from = a - music.start - ramp;
		const to = b - music.start + ramp;
		if (to < 0 || from > length) {
			continue;
		}
		keys.push({ t: Math.max(0, from), v: full, ease: 'inout' }, { t: Math.max(0, from + ramp), v: low, ease: 'hold' }, { t: Math.max(0, to - ramp), v: low, ease: 'inout' }, { t: Math.min(length, to), v: full, ease: 'linear' });
	}
	music.keyframes.volume = keys.sort((x, y) => x.t - y.t);
	return spans.length;
}

/** Zooms in on a moment (the classic "punch in" of YouTube edits), with an optional hold. */
export function punchIn(project: Project, id: string, at: number, zoom = 1.25, hold = 1.2, smooth = 0.12): void {
	const clip = project.clips.find(c => c.id === id);
	if (!clip) {
		throw new Error(`Clip introuvable : ${id}`);
	}
	const local = at - clip.start;
	const keys = (clip.keyframes.scale ?? []).filter(k => k.t < local - smooth || k.t > local + hold + smooth);
	const base = clip.scale;
	keys.push({ t: Math.max(0, local - 0.001), v: base, ease: 'out' }, { t: local + smooth, v: base * zoom, ease: 'hold' }, { t: local + hold, v: base * zoom, ease: 'out' }, { t: local + hold + smooth, v: base });
	clip.keyframes.scale = keys.sort((a, b) => a.t - b.t);
}
