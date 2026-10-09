/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addMediaClip, addTrack, update } from './edits';
import { applyOps } from './ops';
import { Clip, Media, Project, TextStyle, uid } from './project';

/**
 * A creation: something made once (by the user or by the agent) and kept to be used again, in any
 * montage. Three kinds:
 * - `effect`: a set of clip settings (zoom, colour, blur, keyframes, fades, a transition…);
 * - `text`: a text style, with its place on the picture;
 * - `overlay`: an image laid over the picture (a watermark, a logo, a frame), with its place.
 * They live in the user's own library (`~/.orbit/starcapture/creations.json`, images next to it),
 * outside any project.
 */
export interface Creation {
	id: string;
	name: string;
	kind: 'effect' | 'text' | 'overlay';
	description?: string;
	createdAt: number;
	/** effect: clip fields to set. */
	patch?: Record<string, unknown>;
	/** text: the style, and the words it was saved with. */
	style?: Partial<TextStyle>;
	/** overlay: the image, kept in the library. */
	file?: string;
	x?: number;
	y?: number;
	scale?: number;
	opacity?: number;
}

const FOLDER = path.join(os.homedir(), '.orbit', 'starcapture');
const FILE = path.join(FOLDER, 'creations.json');
const ASSETS = path.join(FOLDER, 'creations');
/** What an effect may carry: how a clip looks and moves, never where it sits in time. */
const EFFECT_FIELDS = ['scale', 'x', 'y', 'rotation', 'opacity', 'fit', 'crop', 'color', 'blur', 'shake', 'mirror', 'speed', 'fadeIn', 'fadeOut', 'keyframes', 'transitionIn'];

export function listCreations(): Creation[] {
	try {
		const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
		return (Array.isArray(data.creations) ? data.creations : []).filter((c: Creation) => c && typeof c.id === 'string' && typeof c.name === 'string');
	} catch {
		return [];
	}
}

function write(list: Creation[]): void {
	fs.mkdirSync(FOLDER, { recursive: true });
	fs.writeFileSync(FILE, `${JSON.stringify({ creations: list }, null, '\t')}\n`);
}

export function findCreation(nameOrId: string): Creation {
	const wanted = nameOrId.trim().toLowerCase();
	const found = listCreations().find(c => c.id === nameOrId || c.name.toLowerCase() === wanted);
	if (!found) {
		throw new Error(`Aucune création « ${nameOrId} ». Créations : ${listCreations().map(c => c.name).join(', ') || 'aucune'}`);
	}
	return found;
}

export interface CreationInput {
	name: string;
	kind?: Creation['kind'];
	description?: string;
	/** Take it from this clip of the montage. */
	from?: string;
	patch?: Record<string, unknown>;
	style?: Partial<TextStyle>;
	/** overlay: an image file on the disk. */
	file?: string;
	x?: number;
	y?: number;
	scale?: number;
	opacity?: number;
}

/** Saves a creation, replacing the one of the same name. `project` is needed to take it from a clip. */
export function saveCreation(input: CreationInput, project?: Project): Creation {
	const name = String(input.name ?? '').trim().slice(0, 60);
	if (!name) {
		throw new Error('Il faut un nom.');
	}
	const source = input.from ? project?.clips.find(c => c.id === input.from) : undefined;
	if (input.from && !source) {
		throw new Error(`Clip introuvable : ${input.from}`);
	}
	const sourceMedia = source?.media ? project?.media.find(m => m.id === source.media) : undefined;
	const kind: Creation['kind'] = input.kind ?? (input.file || sourceMedia?.kind === 'image' ? 'overlay' : input.style || source?.text ? 'text' : 'effect');
	const list = listCreations();
	const previous = list.find(c => c.name.toLowerCase() === name.toLowerCase());
	const creation: Creation = { id: previous?.id ?? uid('k'), name, kind, description: input.description ? String(input.description).slice(0, 200) : undefined, createdAt: Date.now() };
	if (kind === 'effect') {
		const from = (input.patch ?? source ?? {}) as Record<string, unknown>;
		const patch = Object.fromEntries(EFFECT_FIELDS.filter(field => from[field] !== undefined && from[field] !== null).map(field => [field, from[field]]));
		if (!Object.keys(patch).length) {
			throw new Error(`Un effet a besoin de réglages : patch avec ${EFFECT_FIELDS.join(', ')}, ou from = l'identifiant d'un clip déjà réglé.`);
		}
		creation.patch = patch;
	} else if (kind === 'text') {
		const style = input.style ?? source?.text;
		if (!style) {
			throw new Error('Un style de texte a besoin de style, ou de from = l\'identifiant d\'un clip de texte.');
		}
		creation.style = { ...style };
		creation.x = input.x ?? source?.x;
		creation.y = input.y ?? source?.y;
		creation.scale = input.scale ?? source?.scale;
	} else {
		const file = input.file ?? sourceMedia?.path;
		if (!file || !fs.existsSync(file) || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file)) {
			throw new Error('Une incrustation a besoin d\'une image (png, jpg, webp, gif) : file = son chemin, ou from = l\'identifiant d\'un clip image.');
		}
		// The library keeps its own copy: the creation outlives the project it came from.
		fs.mkdirSync(ASSETS, { recursive: true });
		const kept = path.join(ASSETS, `${creation.id}${path.extname(file).toLowerCase()}`);
		if (path.resolve(file) !== path.resolve(kept)) {
			fs.copyFileSync(file, kept);
		}
		creation.file = kept;
		creation.x = input.x ?? source?.x ?? 0;
		creation.y = input.y ?? source?.y ?? 0;
		creation.scale = input.scale ?? source?.scale ?? 1;
		creation.opacity = input.opacity ?? source?.opacity ?? 1;
	}
	write([creation, ...list.filter(c => c.id !== creation.id)]);
	return creation;
}

export function deleteCreation(nameOrId: string): Creation {
	const creation = findCreation(nameOrId);
	write(listCreations().filter(c => c.id !== creation.id));
	if (creation.file && path.dirname(creation.file) === ASSETS) {
		fs.rmSync(creation.file, { force: true });
	}
	return creation;
}

export interface ApplyOptions {
	/** effect: the clips to set. */
	ids?: string[];
	/** text and overlay: where on the timeline, and for how long. */
	start?: number;
	duration?: number;
	/** text: the words. */
	content?: string;
	/** Where the user is: used when nothing else says. */
	playhead: number;
	selection: string[];
}

const length = (project: Project) => project.clips.reduce((max, c) => Math.max(max, c.start + (c.out - c.in) / (c.speed || 1)), 0);

/**
 * Puts a creation into the montage. `importImage` adds the image of an overlay to the project's
 * media (the document does it, with its own bookkeeping). Returns the clips created or changed.
 */
export async function applyCreation(project: Project, creation: Creation, options: ApplyOptions, importImage: (file: string) => Promise<Media>): Promise<string[]> {
	if (creation.kind === 'effect') {
		// Asked clips, else the selected pictures, else the picture under the playhead.
		const isPicture = (c: Clip) => project.tracks.find(t => t.id === c.track)?.kind === 'video';
		let targets = (options.ids?.length ? options.ids : options.selection).map(id => project.clips.find(c => c.id === id)).filter((c): c is Clip => !!c && isPicture(c));
		if (!targets.length) {
			targets = project.clips.filter(c => isPicture(c) && c.start <= options.playhead && options.playhead < c.start + (c.out - c.in) / (c.speed || 1)).slice(0, 1);
		}
		if (!targets.length) {
			throw new Error('Aucun clip vidéo à qui appliquer l\'effet : donne ids, ou sélectionne un clip.');
		}
		for (const clip of targets) {
			update(project, clip.id, JSON.parse(JSON.stringify(creation.patch ?? {})));
		}
		return targets.map(c => c.id);
	}
	if (creation.kind === 'text') {
		const content = options.content ?? creation.style?.content ?? creation.name;
		const { content: _saved, ...style } = creation.style ?? {};
		void _saved;
		const created = applyOps(project, [{ op: 'addText', content, start: options.start ?? options.playhead, duration: options.duration ?? 3, style, x: creation.x, y: creation.y }]);
		if (creation.scale !== undefined && created[0]) {
			update(project, created[0], { scale: creation.scale });
		}
		return created;
	}
	if (!creation.file || !fs.existsSync(creation.file)) {
		throw new Error(`L'image de « ${creation.name} » a disparu de la bibliothèque.`);
	}
	const media = project.media.find(m => path.resolve(m.path) === path.resolve(String(creation.file))) ?? await importImage(creation.file);
	const start = options.start ?? 0;
	// A watermark covers the whole montage unless told otherwise.
	const duration = options.duration ?? Math.max(1, length(project) - start);
	// Its own track, above the pictures: laid on an existing one it would cut what it covers.
	const track = project.tracks.find(t => t.kind === 'video' && t.name === 'Habillage' && !project.clips.some(c => c.track === t.id && c.start < start + duration && c.start + (c.out - c.in) / (c.speed || 1) > start)) ?? addTrack(project, 'video');
	track.name = 'Habillage';
	const [clip] = addMediaClip(project, media, { start, in: 0, out: Math.min(media.duration, duration), track: track.id });
	clip.out = duration;
	clip.name = creation.name;
	update(project, clip.id, { x: creation.x ?? 0, y: creation.y ?? 0, scale: creation.scale ?? 1, opacity: creation.opacity ?? 1, fit: 'contain' });
	return [clip.id];
}
