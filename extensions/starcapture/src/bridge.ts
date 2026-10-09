/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { AddressInfo } from 'net';
import { TEXT_PRESETS, removeRanges, sourceToTimeline } from './edits';
import { MontageDocument, MontageEditorProvider } from './editor';
import { PRESETS } from './export';
import { silences } from './ffmpeg';
import { Op, OP_REFERENCE } from './ops';
import { CreationInput, deleteCreation, findCreation, listCreations, saveCreation } from './creations';
import { Clip, Project, duration, end, projectDuration } from './project';

const REGISTRY = path.join(os.homedir(), '.orbit', 'starcapture', 'windows');
const MCP_CONFIG = path.join(os.homedir(), '.orbit', 'mcp', 'ext-starcapture.json');

/**
 * Claude's side of StarCapture: a local server the `starcapture` MCP tools call. Each window
 * registers itself; the tools act on the montage the user last looked at.
 */
export class Bridge implements vscode.Disposable {

	private readonly server = http.createServer((req, res) => this.handle(req, res));
	private readonly token = randomBytes(24).toString('hex');
	private readonly entry = path.join(REGISTRY, `${process.pid}.json`);
	private port = 0;
	private focusedAt = Date.now();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(context: vscode.ExtensionContext, private readonly provider: MontageEditorProvider, private readonly exportCommand: (doc: MontageDocument, preset?: string, file?: string, range?: [number, number]) => Promise<string>) {
		fs.mkdirSync(path.dirname(MCP_CONFIG), { recursive: true });
		const config = JSON.stringify({
			mcpServers: {
				starcapture: {
					type: 'stdio',
					command: process.execPath,
					args: [path.join(context.extensionPath, 'mcp', 'starcapture-mcp.js')],
					env: { ELECTRON_RUN_AS_NODE: '1' },
				},
			},
		}, null, 2);
		try {
			if (!fs.existsSync(MCP_CONFIG) || fs.readFileSync(MCP_CONFIG, 'utf8') !== config) {
				fs.writeFileSync(MCP_CONFIG, config);
			}
		} catch (err) {
			console.error('[starcapture] MCP config', err);
		}
		this.server.listen(0, '127.0.0.1', () => {
			this.port = (this.server.address() as AddressInfo).port;
			this.register();
		});
		this.disposables.push(vscode.window.onDidChangeWindowState(s => {
			if (s.focused) {
				this.focusedAt = Date.now();
				this.register();
			}
		}));
	}

	dispose(): void {
		this.server.close();
		fs.rmSync(this.entry, { force: true });
		this.disposables.forEach(d => d.dispose());
	}

	private register(): void {
		try {
			fs.mkdirSync(REGISTRY, { recursive: true });
			fs.writeFileSync(this.entry, JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${this.port}`, token: this.token, focusedAt: this.focusedAt, open: [...this.provider.documents].map(d => d.file) }));
		} catch {
			// registry unavailable: tools will say Orbit is not reachable
		}
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const reply = (status: number, body: unknown) => {
			res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(body ?? { ok: true }));
		};
		let raw = '';
		req.setEncoding('utf8');
		req.on('data', c => raw += c);
		await new Promise(r => req.on('end', r));
		let body: { token?: string; tool?: string; args?: Record<string, unknown>; cwd?: string };
		try {
			body = JSON.parse(raw || '{}');
		} catch {
			return reply(400, { error: 'JSON invalide' });
		}
		if (body.token !== this.token) {
			return reply(403, { error: 'bad token' });
		}
		try {
			reply(200, await this.tool(String(body.tool), body.args ?? {}, body.cwd));
		} catch (err) {
			reply(400, { error: err instanceof Error ? err.message : String(err) });
		}
	}

	private doc(): MontageDocument {
		const doc = this.provider.active ?? [...this.provider.documents][0];
		if (!doc) {
			throw new Error('Aucun montage ouvert. Ouvre une vidéo ou un projet avec sc_open.');
		}
		return doc;
	}

	private async tool(name: string, a: Record<string, unknown>, cwd?: string): Promise<unknown> {
		const resolve = (p: unknown) => {
			const raw = String(p ?? '').replace(/^~(?=$|[\\/])/, os.homedir());
			return path.isAbsolute(raw) ? path.normalize(raw) : path.join(cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(), raw);
		};
		switch (name) {
			case 'open': {
				const file = resolve(a.path);
				if (a.create === true && !fs.existsSync(file)) {
					const { emptyProject } = await import('./project');
					const [w, h] = a.vertical === true ? [1080, 1920] : [1920, 1080];
					await fs.promises.mkdir(path.dirname(file), { recursive: true });
					await fs.promises.writeFile(file.endsWith('.starcapture') ? file : `${file}.starcapture`, JSON.stringify(emptyProject(path.basename(file).replace(/\.[^.]+$/, ''), w, h, 30), null, '\t'));
				}
				const target = fs.existsSync(file) ? file : `${file}.starcapture`;
				if (!fs.existsSync(target)) {
					throw new Error(`${file} n'existe pas (create=true pour un nouveau montage)`);
				}
				await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), MontageEditorProvider.viewType);
				await waitFor(() => [...this.provider.documents].some(d => samePath(d.uri.fsPath, target) && d.panels.size > 0), 20000);
				await new Promise(r => setTimeout(r, 600));
				return this.state(this.doc());
			}
			case 'state':
				return this.state(this.doc(), a.detail === true);
			case 'import': {
				const doc = this.doc();
				const paths = (Array.isArray(a.paths) ? a.paths : [a.paths]).map(resolve);
				const missing = paths.filter(p => !fs.existsSync(p));
				if (missing.length) {
					throw new Error(`Introuvable : ${missing.join(', ')}`);
				}
				const media = await this.provider.importFiles(doc, paths, a.toTimeline === true, a.at as number | undefined, a.track as string | undefined);
				return media.map(m => ({ id: m.id, name: m.name, kind: m.kind, duration: round(m.duration), width: m.width, height: m.height }));
			}
			case 'edit': {
				const doc = this.doc();
				const ops = (a.ops ?? []) as Op[];
				if (!Array.isArray(ops) || !ops.length) {
					throw new Error('ops doit être une liste d\'opérations');
				}
				const created = doc.edit(String(a.label ?? `Claude : ${ops.length} modification${ops.length > 1 ? 's' : ''}`), ops);
				return { ok: true, created, duration: round(projectDuration(doc.project)) };
			}
			case 'undo':
				this.doc().undo();
				return { ok: true };
			case 'redo':
				this.doc().redo();
				return { ok: true };
			case 'seek': {
				const doc = this.doc();
				for (const panel of doc.panels) {
					panel.webview.postMessage({ type: 'command', name: a.play === true ? 'play' : 'seek', t: Number(a.t) || 0, select: a.select });
				}
				return { ok: true };
			}
			case 'frame': {
				const doc = this.doc();
				const t = Number(a.t ?? doc.view.playhead) || 0;
				const value = await doc.request<{ dataUrl: string }>({ type: 'renderFrame', t, width: Math.min(1280, Number(a.width) || 960) });
				return { image: value.dataUrl, t };
			}
			case 'transcribe': {
				const doc = this.doc();
				const media = this.pickMedia(doc, a.media);
				const words = doc.project.transcripts?.[media.id] && a.force !== true
					? doc.project.transcripts[media.id]
					: await this.provider.transcribe(doc, media.id, String(a.language ?? 'fr'));
				return { media: media.id, ...this.onTimeline(doc.project, media.id, words) };
			}
			case 'silences': {
				const doc = this.doc();
				const media = this.pickMedia(doc, a.media);
				const found = await silences(media.path, Number(a.thresholdDb ?? -38), Number(a.minDuration ?? 0.5));
				const padding = Number(a.padding ?? 0.12);
				// Silences in source time → timeline ranges, through every clip of that media on audio tracks.
				const ranges = sourceToTimeline(doc.project, media.id, found.map(([s, e]) => [s + padding, e - padding] as [number, number]).filter(([s, e]) => e - s > 0.15));
				if (a.apply === true) {
					const before = JSON.stringify(doc.project);
					const removed = removeRanges(doc.project, ranges);
					doc.commit(`Supprimer ${ranges.length} silences`, before);
					return { removedSeconds: round(removed), cuts: ranges.length, duration: round(projectDuration(doc.project)) };
				}
				return { ranges: ranges.map(([s, e]) => [round(s), round(e)]), total: round(ranges.reduce((t, [s, e]) => t + e - s, 0)) };
			}
			case 'export': {
				const doc = this.doc();
				const file = await this.exportCommand(doc, a.preset as string | undefined, a.path ? resolve(a.path) : undefined, Array.isArray(a.range) ? a.range as [number, number] : undefined);
				return { ok: true, file };
			}
			case 'creations':
				return listCreations().map(creation => ({ id: creation.id, name: creation.name, kind: creation.kind, description: creation.description }));
			case 'creationSave': {
				const input = { ...a, file: a.file ? resolve(a.file) : undefined } as unknown as CreationInput;
				const creation = saveCreation(input, input.from ? this.doc().project : undefined);
				this.provider.sendCreations();
				return { ok: true, id: creation.id, name: creation.name, kind: creation.kind };
			}
			case 'creationApply': {
				const doc = this.doc();
				const creation = findCreation(String(a.name ?? a.id ?? ''));
				const clips = await this.provider.applyCreation(doc, creation, { ids: Array.isArray(a.ids) ? a.ids.map(String) : undefined, start: typeof a.start === 'number' ? a.start : undefined, duration: typeof a.duration === 'number' ? a.duration : undefined, content: typeof a.content === 'string' ? a.content : undefined });
				return { ok: true, clips, duration: round(projectDuration(doc.project)) };
			}
			case 'creationDelete': {
				const creation = deleteCreation(String(a.name ?? a.id ?? ''));
				this.provider.sendCreations();
				return { ok: true, deleted: creation.name };
			}
			case 'guide':
				return GUIDE;
			default:
				throw new Error(`Outil inconnu : ${name}`);
		}
	}

	private pickMedia(doc: MontageDocument, ref: unknown) {
		const media = ref ? doc.project.media.find(m => m.id === ref || m.name === ref || samePath(m.path, String(ref))) : doc.project.media.find(m => m.kind !== 'image' && m.hasAudio !== false);
		if (!media) {
			throw new Error(ref ? `Média introuvable : ${ref}` : 'Aucun média avec du son dans ce montage');
		}
		return media;
	}

	/** Transcript words placed on the timeline (words cut out of the edit are left out). */
	private onTimeline(project: Project, mediaId: string, words: { w: string; start: number; end: number }[]) {
		const clips = project.clips.filter(c => c.media === mediaId && project.tracks.find(t => t.id === c.track)?.kind === 'audio').sort((a, b) => a.start - b.start);
		const placed: { w: string; t: number; end: number }[] = [];
		for (const c of clips) {
			for (const w of words) {
				if (w.start >= c.in - 0.02 && w.end <= c.out + 0.02) {
					placed.push({ w: w.w, t: round(c.start + (w.start - c.in) / c.speed), end: round(c.start + (w.end - c.in) / c.speed) });
				}
			}
		}
		placed.sort((a, b) => a.t - b.t);
		// Sentences make the transcript readable for Claude; words keep exact timing.
		const sentences: { t: number; end: number; text: string }[] = [];
		for (const w of placed) {
			const last = sentences[sentences.length - 1];
			if (last && w.t - last.end < 0.7 && !/[.!?]$/.test(last.text)) {
				last.text += ` ${w.w}`;
				last.end = w.end;
			} else {
				sentences.push({ t: w.t, end: w.end, text: w.w });
			}
		}
		return { sentences, words: placed };
	}

	private state(doc: MontageDocument, detail = false) {
		const p = doc.project;
		const describe = (c: Clip) => {
			const media = c.media ? p.media.find(m => m.id === c.media) : undefined;
			const item: Record<string, unknown> = {
				id: c.id,
				track: c.track,
				start: round(c.start),
				end: round(end(c)),
				...(media ? { media: media.name, in: round(c.in), out: round(c.out) } : {}),
				...(c.text ? { text: c.text.content } : {}),
			};
			if (c.speed !== 1) {
				item.speed = c.speed;
			}
			if (c.link) {
				item.link = c.link;
			}
			if (c.transitionIn) {
				item.transition = `${c.transitionIn.type} ${c.transitionIn.duration}s`;
			}
			if (detail) {
				Object.assign(item, { volume: c.volume, opacity: c.opacity, x: c.x, y: c.y, scale: c.scale, rotation: c.rotation, fit: c.fit, color: c.color, crop: c.crop, keyframes: c.keyframes, fadeIn: c.fadeIn, fadeOut: c.fadeOut, textStyle: c.text });
			}
			return item;
		};
		return {
			file: doc.file,
			name: p.name,
			format: `${p.width}x${p.height} ${p.fps} i/s`,
			duration: round(projectDuration(p)),
			playhead: round(doc.view.playhead),
			selection: doc.view.selection,
			media: p.media.map(m => ({ id: m.id, name: m.name, kind: m.kind, duration: round(m.duration), size: m.width ? `${m.width}x${m.height}` : undefined, transcribed: !!p.transcripts?.[m.id] })),
			tracks: p.tracks.map(t => ({ id: t.id, kind: t.kind, name: t.name, muted: t.muted || undefined, hidden: t.hidden || undefined, locked: t.locked || undefined, clips: p.clips.filter(c => c.track === t.id).sort((x, y) => x.start - y.start).length })),
			clips: [...p.clips].sort((x, y) => x.start - y.start || x.track.localeCompare(y.track)).slice(0, detail ? 2000 : 400).map(describe),
			clipCount: p.clips.length,
			markers: p.markers,
			textPresets: Object.fromEntries(Object.entries(TEXT_PRESETS).map(([k, v]) => [k, v.label])),
			exportPresets: PRESETS.map(x => x.id),
			totalClipSeconds: round(p.clips.reduce((t, c) => t + duration(c), 0)),
		};
	}
}

const GUIDE = `StarCapture — guide pour Claude

MODÈLE
- Temps en secondes. start = position sur la timeline ; in/out = secondes dans le fichier source ; durée = (out-in)/speed.
- Pistes listées de haut en bas : la première piste vidéo est dessinée au-dessus des autres ; les pistes "text" sont au-dessus de tout.
- Une vidéo importée donne un clip image sur une piste vidéo et un clip son lié (même "link") sur une piste audio : couper/déplacer l'un agit sur l'autre, sauf si tu vises un seul clip par son id dans split.
- Placer un clip écrase ce qu'il recouvre sur sa piste (montage par écrasement).
- x/y en pixels depuis le centre du cadre, scale 1 = taille d'origine, rotation en degrés, opacity 0-1, volume 1 = normal (2 = +6 dB).
- Keyframes : keyframes.scale = [{t (s depuis le début du clip), v, ease: linear|in|out|inout|hold}] ; idem x, y, rotation, opacity, volume.
- color : brightness/contrast/saturation (-1 à 1), hue (degrés), temperature (-1 froid à 1 chaud), vignette (0-1). blur (0-10), shake (secousse, 0-1), mirror.
- Transitions sur le clip entrant : crossfade, dip-black, dip-white, slide-left, slide-right, slide-up, zoom-in, zoom-out.

OPÉRATIONS (outil sc_edit, plusieurs à la fois dans "ops", appliquées comme UNE modification annulable)
${Object.values(OP_REFERENCE).join('\n')}

CRÉATIONS (la bibliothèque personnelle de l'utilisateur : ce que tu fabriques une fois se réutilise dans tous ses montages)
- Trois sortes : "effect" (réglages d'un clip : scale, x, y, rotation, opacity, fit, crop, color, blur, shake, mirror, speed, fadeIn, fadeOut, keyframes, transitionIn), "text" (un style de texte et sa place), "overlay" (une image par-dessus l'image : filigrane, logo, cadre, avec x, y, scale, opacity).
- sc_creation_save {name, kind?, description?, et soit from (id d'un clip déjà réglé dans le montage), soit patch (effect) / style (text) / file (overlay : chemin d'une image png, jpg, webp)}. Même nom = remplace.
- sc_creation_apply {name, ids? (effect), start?, duration?, content? (text)} : sans ids, l'effet va sur la sélection de l'utilisateur ; une incrustation couvre tout le montage, sur sa propre piste « Habillage ».
- sc_creations pour la liste, sc_creation_delete pour retirer.
- Filigrane sur mesure : fabrique d'abord l'image (un PNG transparent : dessine-le, ou génère-le), enregistre-la avec sc_creation_save kind "overlay" et sa place (x, y en pixels depuis le centre, scale, opacity 0.3 à 0.6 pour rester discret), puis sc_creation_apply.
- Quand l'utilisateur te demande un effet, un habillage ou un style qu'il voudra retrouver (« mon style », « mon logo », « comme d'habitude »), enregistre-le en création au lieu de le refaire à chaque fois, et dis-lui son nom.

MÉTHODE DE MONTEUR (vidéos YouTube rythmées, style Squeezie / MrBeast)
1. sc_state pour voir le montage, sc_transcribe pour savoir ce qui est dit (phrases et mots horodatés sur la timeline).
2. Rythme : sc_silences apply=true pour retirer les blancs ; puis removeRanges sur les phrases ratées, répétitions, hésitations (« euh », faux départs) à partir de la transcription.
3. Accroche : les 5 premières secondes doivent être fortes. Déplace la meilleure phrase au début si besoin.
4. Dynamisme : punchIn sur les punchlines (zoom 1.15-1.3), changements de cadrage toutes les 3-8 s en alternant scale 1 et 1.15 (jump cut zoom), shake sur les moments forts.
5. Textes : mots-clés à l'écran (preset "youtube", 0.6-1.2 s, au moment où le mot est dit), sous-titres karaoké (preset "caption", 1 à 3 mots par sous-titre, style.wordTimes = instants de chaque mot depuis le début du clip, style.highlight = couleur du mot dit).
6. Son : musique sur la piste "Musique" (sc_import), puis {op:"duck"} pour qu'elle baisse sous la voix ; fadeIn/fadeOut sur la musique.
7. Vérifie avec sc_frame (tu VOIS l'image du montage à un instant), puis exporte avec sc_export.
Toujours expliquer brièvement à l'utilisateur ce que tu as changé ; tout est annulable (sc_undo).`;

function round(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function samePath(a: string, b: string): boolean {
	return process.platform === 'win32' ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase() : path.normalize(a) === path.normalize(b);
}

async function waitFor(test: () => boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!test()) {
		if (Date.now() > deadline) {
			throw new Error('Le montage ne s\'est pas ouvert à temps');
		}
		await new Promise(r => setTimeout(r, 150));
	}
}
