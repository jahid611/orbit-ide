/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A StarCapture project: plain JSON, saved as `<name>.starcapture` next to the media.
 * Times are seconds on the timeline; `in`/`out` are seconds in the source media.
 */
export interface Project {
	version: 1;
	name: string;
	width: number;
	height: number;
	fps: number;
	background: string;
	media: Media[];
	/** Top to bottom as displayed: the first video track is drawn on top of the others. */
	tracks: Track[];
	clips: Clip[];
	markers: Marker[];
	/** Word-level transcripts per media id, in source time. */
	transcripts?: Record<string, Word[]>;
}

export interface Media {
	id: string;
	/** Absolute path. */
	path: string;
	name: string;
	kind: 'video' | 'audio' | 'image';
	duration: number;
	width?: number;
	height?: number;
	fps?: number;
	hasAudio?: boolean;
}

export type TrackKind = 'video' | 'audio' | 'text';

export interface Track {
	id: string;
	kind: TrackKind;
	name: string;
	muted?: boolean;
	hidden?: boolean;
	locked?: boolean;
}

export interface Keyframe {
	/** Seconds from the start of the clip. */
	t: number;
	v: number;
	ease?: 'linear' | 'in' | 'out' | 'inout' | 'hold';
}

export type Animatable = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export interface TextStyle {
	content: string;
	font: string;
	size: number;
	weight: number;
	color: string;
	stroke: string;
	strokeWidth: number;
	background: string;
	shadow: number;
	align: 'left' | 'center' | 'right';
	uppercase?: boolean;
	/** Entrance animation. */
	animation: 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter' | 'bounce';
	/** Words of the content highlighted in `highlight` colour (karaoke captions). */
	highlight?: string;
	/** Seconds from the clip start at which each word lights up (captions). */
	wordTimes?: number[];
}

export type TransitionType = 'crossfade' | 'dip-black' | 'dip-white' | 'slide-left' | 'slide-right' | 'slide-up' | 'zoom-in' | 'zoom-out' | 'wipe-left';

export interface Clip {
	id: string;
	track: string;
	/** Media id; text clips have none. */
	media?: string;
	name?: string;
	/** Timeline start. */
	start: number;
	/** Source in/out (seconds). Text and image clips: 0 → duration. */
	in: number;
	out: number;
	speed: number;
	volume: number;
	fadeIn: number;
	fadeOut: number;
	opacity: number;
	x: number;
	y: number;
	scale: number;
	rotation: number;
	crop: { left: number; top: number; right: number; bottom: number };
	color: { brightness: number; contrast: number; saturation: number; hue: number; temperature: number; vignette: number };
	/** Video track clips: fit the frame (`contain`) or fill it (`cover`). */
	fit: 'contain' | 'cover' | 'stretch';
	keyframes: Partial<Record<Animatable, Keyframe[]>>;
	transitionIn?: { type: TransitionType; duration: number };
	text?: TextStyle;
	/** Video and audio of the same recording move together. */
	link?: string;
	/** Colour label shown on the timeline. */
	label?: string;
	mirror?: boolean;
	/** Short camera shake (seconds of intensity), the classic punchline effect. */
	shake?: number;
	blur?: number;
}

export interface Marker {
	t: number;
	label: string;
	color?: string;
}

export interface Word {
	w: string;
	start: number;
	end: number;
}

export function uid(prefix: string): string {
	return `${prefix}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyProject(name: string, width = 1920, height = 1080, fps = 30): Project {
	return {
		version: 1,
		name,
		width,
		height,
		fps,
		background: '#000000',
		media: [],
		tracks: [
			{ id: 'T1', kind: 'text', name: 'Textes' },
			{ id: 'V2', kind: 'video', name: 'Vidéo 2' },
			{ id: 'V1', kind: 'video', name: 'Vidéo 1' },
			{ id: 'A1', kind: 'audio', name: 'Audio 1' },
			{ id: 'A2', kind: 'audio', name: 'Musique' },
		],
		clips: [],
		markers: [],
	};
}

export function newClip(fields: Partial<Clip> & Pick<Clip, 'track' | 'start' | 'in' | 'out'>): Clip {
	return {
		id: uid('c'),
		speed: 1,
		volume: 1,
		fadeIn: 0,
		fadeOut: 0,
		opacity: 1,
		x: 0,
		y: 0,
		scale: 1,
		rotation: 0,
		crop: { left: 0, top: 0, right: 0, bottom: 0 },
		color: { brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, vignette: 0 },
		fit: 'contain',
		keyframes: {},
		...fields,
	};
}

export function duration(clip: Clip): number {
	return Math.max(0, (clip.out - clip.in) / (clip.speed || 1));
}

export function end(clip: Clip): number {
	return clip.start + duration(clip);
}

export function projectDuration(project: Project): number {
	return project.clips.reduce((max, c) => Math.max(max, end(c)), 0);
}

/** Fills fields missing in projects written by hand or by older versions. */
export function normalize(project: Project): Project {
	const base = emptyProject(project.name || 'Projet');
	const p: Project = { ...base, ...project, version: 1 };
	p.media = project.media ?? [];
	p.tracks = project.tracks?.length ? project.tracks : base.tracks;
	p.markers = project.markers ?? [];
	p.clips = (project.clips ?? []).map(c => {
		const fresh = newClip({ track: c.track, start: c.start, in: c.in, out: c.out });
		return { ...fresh, ...c, crop: { ...fresh.crop, ...c.crop }, color: { ...fresh.color, ...c.color }, keyframes: c.keyframes ?? {} };
	});
	return p;
}

/** Value of an animatable property at `local` seconds into the clip. */
export function valueAt(clip: Clip, prop: Animatable, local: number): number {
	const base = prop === 'volume' ? clip.volume : clip[prop];
	const keys = clip.keyframes[prop];
	if (!keys?.length) {
		return base;
	}
	const sorted = [...keys].sort((a, b) => a.t - b.t);
	if (local <= sorted[0].t) {
		return sorted[0].v;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (local <= b.t) {
			if (a.ease === 'hold') {
				return a.v;
			}
			const p = (local - a.t) / Math.max(1e-6, b.t - a.t);
			return a.v + (b.v - a.v) * ease(p, a.ease);
		}
	}
	return sorted[sorted.length - 1].v;
}

export function ease(p: number, kind: Keyframe['ease'] = 'inout'): number {
	switch (kind) {
		case 'linear': return p;
		case 'in': return p * p * p;
		case 'out': return 1 - Math.pow(1 - p, 3);
		default: return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
	}
}
