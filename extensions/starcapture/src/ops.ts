/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addMediaClip, addText, addTrack, duck, punchIn, remove, removeRanges, setTransition, split, update } from './edits';
import { Clip, Project, TextStyle, TrackKind, TransitionType, uid } from './project';

/** One editing step, as the page and Claude's tools send it. */
export type Op =
	| { op: 'update'; id: string; patch: Partial<Clip> & Record<string, unknown> }
	| { op: 'addMedia'; media: string; start?: number; in?: number; out?: number; track?: string }
	| { op: 'split'; t: number; ids?: string[] }
	| { op: 'remove'; ids: string[]; ripple?: boolean }
	| { op: 'removeRanges'; ranges: [number, number][] }
	| { op: 'addText'; content: string; start: number; duration: number; preset?: string; style?: Partial<TextStyle>; track?: string; x?: number; y?: number }
	| { op: 'transition'; id: string; type: TransitionType | 'none'; duration?: number }
	| { op: 'punchIn'; id: string; t: number; zoom?: number; hold?: number }
	| { op: 'duck'; id: string; media?: string; level?: number }
	| { op: 'marker'; t: number; label: string; color?: string }
	| { op: 'removeMarker'; t: number }
	| { op: 'track'; id?: string; kind?: TrackKind; patch?: { name?: string; muted?: boolean; hidden?: boolean; locked?: boolean }; remove?: boolean }
	| { op: 'project'; patch: Partial<Pick<Project, 'name' | 'width' | 'height' | 'fps' | 'background'>>; fit?: 'cover' | 'contain' }
	| { op: 'duplicate'; ids: string[]; offset?: number }
	| { op: 'removeMedia'; id: string };

/**
 * What the agent is told about each operation, in its guide (`sc_guide`). The type makes the list
 * complete by construction: an operation added to `Op` without its line here does not compile,
 * so the guide can never fall behind the code.
 */
/**
 * Positions, text sizes and outlines are counted in pixels of the frame: when the frame changes,
 * they follow it, or a title set for 4K fills half of a 1080p picture and sits off its place.
 * Positions follow each side of the frame; sizes follow the side that shrank the most, so that a
 * text that fitted still fits. When the proportions change, videos fill the new frame (or show
 * whole, with `fit`), and images, often transparent overlays, stay whole.
 */
function reframe(project: Project, before: { width: number; height: number }, fit?: 'cover' | 'contain'): void {
	const kx = project.width / before.width;
	const ky = project.height / before.height;
	if (kx === 1 && ky === 1) {
		return;
	}
	const k = Math.min(kx, ky);
	const round = (value: number) => Math.round(value * 100) / 100;
	const sameShape = Math.abs(project.width / project.height - before.width / before.height) < 0.01;
	for (const c of project.clips) {
		c.x = round(c.x * kx);
		c.y = round(c.y * ky);
		for (const key of c.keyframes.x ?? []) {
			key.v = round(key.v * kx);
		}
		for (const key of c.keyframes.y ?? []) {
			key.v = round(key.v * ky);
		}
		if (c.text) {
			c.text.size = Math.max(4, Math.round(c.text.size * k));
			c.text.strokeWidth = Math.round(c.text.strokeWidth * k * 10) / 10;
			c.text.shadow = Math.round(c.text.shadow * k * 10) / 10;
		}
		const media = c.media ? project.media.find(m => m.id === c.media) : undefined;
		if (sameShape || !media?.width || !media.height || project.tracks.find(t => t.id === c.track)?.kind !== 'video') {
			continue;
		}
		const fits = Math.abs(media.width / media.height - project.width / project.height) < 0.01;
		c.fit = fits || media.kind === 'image' ? 'contain' : fit ?? 'cover';
	}
}

export const OP_REFERENCE: Record<Op['op'], string> = {
	addMedia: '{op:"addMedia", media (id, nom ou chemin), start?, in?, out?, track?} : pose un média sur la timeline (une vidéo donne un clip image et son clip son lié)',
	split: '{op:"split", t, ids?} : coupe à l\'instant t (tous les clips sous t, ou seulement ids)',
	remove: '{op:"remove", ids, ripple?} : supprime des clips ; ripple=true referme le trou',
	removeRanges: '{op:"removeRanges", ranges:[[a,b],...]} : retire ces moments de toute la timeline et recolle (coupes nettes)',
	update: '{op:"update", id, patch:{start, in, out, speed, volume, x, y, scale, rotation, opacity, fit, crop:{...}, color:{...}, keyframes:{...}, text:{...}, fadeIn, fadeOut, shake, blur, mirror}} : modifie un clip',
	addText: '{op:"addText", content, start, duration, preset?, style?, track?, x?, y?} : ajoute un texte',
	transition: '{op:"transition", id, type, duration?} : transition à l\'entrée du clip (type "none" pour la retirer)',
	punchIn: '{op:"punchIn", id, t, zoom?, hold?} : zoom rapide sur un moment (effet YouTube)',
	duck: '{op:"duck", id (clip de musique), media?, level? (0.2 par défaut)} : la musique baisse toute seule quand on parle (d\'après la transcription)',
	marker: '{op:"marker", t, label, color?} : pose un marqueur',
	removeMarker: '{op:"removeMarker", t} : retire le marqueur posé à cet instant',
	track: '{op:"track", kind} : nouvelle piste (video, audio ou text) · {op:"track", id, patch:{name, muted, hidden, locked}} · {op:"track", id, remove:true} : supprime la piste et ses clips',
	project: '{op:"project", patch:{name, width, height, fps, background}, fit?} : changer la taille garde le montage tel qu\'il est composé (positions, tailles de texte, contours et images clés suivent le nouveau cadre). Si les proportions changent (16:9 vers 9:16…), fit dit quoi faire des vidéos : "cover" les fait remplir le cadre en les rognant (défaut), "contain" les montre entières avec des bandes ; les images restent entières',
	duplicate: '{op:"duplicate", ids, offset?} : copie des clips, à la suite ou décalés de offset secondes',
	removeMedia: '{op:"removeMedia", id} : retire un média du projet, avec tous ses clips',
};

/** Applies steps in order; returns the ids of clips it created. */
export function applyOps(project: Project, ops: Op[]): string[] {
	const created: string[] = [];
	for (const o of ops) {
		switch (o.op) {
			case 'update':
				update(project, o.id, o.patch);
				break;
			case 'addMedia': {
				const media = project.media.find(m => m.id === o.media || m.name === o.media || m.path === o.media);
				if (!media) {
					throw new Error(`Média introuvable : ${o.media}`);
				}
				created.push(...addMediaClip(project, media, o).map(c => c.id));
				break;
			}
			case 'split':
				created.push(...split(project, o.t, o.ids).map(c => c.id));
				break;
			case 'remove':
				remove(project, o.ids, o.ripple);
				break;
			case 'removeRanges':
				removeRanges(project, o.ranges);
				break;
			case 'addText': {
				const clip = addText(project, o.content, o.start, o.duration, o.preset, o.style, o.track);
				if (o.x !== undefined) {
					clip.x = o.x;
				}
				if (o.y !== undefined) {
					clip.y = o.y;
				}
				created.push(clip.id);
				break;
			}
			case 'transition':
				setTransition(project, o.id, o.type, o.duration);
				break;
			case 'punchIn':
				punchIn(project, o.id, o.t, o.zoom, o.hold);
				break;
			case 'duck': {
				// Speech: the transcript of the given media (or every transcribed media), on the timeline.
				const speech: { t: number; end: number }[] = [];
				for (const [mediaId, words] of Object.entries(project.transcripts ?? {})) {
					if (o.media && o.media !== mediaId) {
						continue;
					}
					for (const c of project.clips.filter(x => x.media === mediaId && x.id !== o.id && project.tracks.find(t => t.id === x.track)?.kind === 'audio')) {
						for (const w of words) {
							if (w.start >= c.in && w.end <= c.out) {
								speech.push({ t: c.start + (w.start - c.in) / c.speed, end: c.start + (w.end - c.in) / c.speed });
							}
						}
					}
				}
				if (!speech.length) {
					throw new Error('Transcris d\'abord la voix (sc_transcribe) : le ducking suit la parole.');
				}
				duck(project, o.id, speech, o.level);
				break;
			}
			case 'marker':
				project.markers.push({ t: o.t, label: o.label, color: o.color });
				project.markers.sort((a, b) => a.t - b.t);
				break;
			case 'removeMarker':
				project.markers = project.markers.filter(m => Math.abs(m.t - o.t) > 0.02);
				break;
			case 'track':
				if (o.remove && o.id) {
					project.tracks = project.tracks.filter(t => t.id !== o.id);
					project.clips = project.clips.filter(c => c.track !== o.id);
				} else if (o.id) {
					const t = project.tracks.find(x => x.id === o.id);
					if (t && o.patch) {
						Object.assign(t, o.patch);
					}
				} else if (o.kind) {
					created.push(addTrack(project, o.kind).id);
				}
				break;
			case 'project': {
				const before = { width: project.width, height: project.height };
				Object.assign(project, o.patch);
				project.width = Math.max(16, Math.round(project.width / 2) * 2);
				project.height = Math.max(16, Math.round(project.height / 2) * 2);
				reframe(project, before, o.fit);
				project.fps = Math.min(120, Math.max(1, project.fps));
				break;
			}
			case 'duplicate': {
				const sources = project.clips.filter(c => o.ids.includes(c.id));
				const span = Math.max(...sources.map(c => c.start + (c.out - c.in) / c.speed)) - Math.min(...sources.map(c => c.start));
				const links = new Map<string, string>();
				for (const c of sources) {
					const copy: Clip = structuredClone(c);
					copy.id = uid('c');
					copy.start += o.offset ?? span;
					if (c.link) {
						copy.link = links.get(c.link) ?? uid('l');
						links.set(c.link, copy.link);
					}
					project.clips.push(copy);
					created.push(copy.id);
				}
				break;
			}
			case 'removeMedia':
				project.media = project.media.filter(m => m.id !== o.id);
				project.clips = project.clips.filter(c => c.media !== o.id);
				break;
		}
	}
	return created;
}
