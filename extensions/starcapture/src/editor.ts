/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { addMediaClip, removeRanges, sourceToTimeline } from './edits';
import { CACHE_DIR, filmstrip, probe, proxy, silences, speechAudio, waveform } from './ffmpeg';
import { Op, applyOps } from './ops';
import { Media, Project, Word, emptyProject, normalize, projectDuration } from './project';
import { transcribeMedia } from './whisper';
import { Creation, applyCreation, deleteCreation, findCreation, listCreations, saveCreation } from './creations';

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const MAX_UNDO = 300;

/** What the page tells us about the user's view, for Claude ("the clip I selected"). */
export interface ViewState {
	playhead: number;
	selection: string[];
	playing: boolean;
}

/**
 * One montage. Opening a video creates (or reopens) `<video>.starcapture` next to it;
 * the project file is the document, the video stays untouched.
 */
export class MontageDocument implements vscode.CustomDocument {

	project: Project;
	view: ViewState = { playhead: 0, selection: [], playing: false };
	readonly panels = new Set<vscode.WebviewPanel>();
	private undoStack: string[] = [];
	private redoStack: string[] = [];
	private readonly _onDidChange = new vscode.EventEmitter<{ label: string }>();
	readonly onDidChange = this._onDidChange.event;
	private readonly _onDidEdit = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<MontageDocument>>();
	readonly onDidEdit = this._onDidEdit.event;
	/** Renders and transcripts answered by the page. */
	readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

	private constructor(readonly uri: vscode.Uri, readonly file: string, project: Project) {
		this.project = project;
	}

	static async open(uri: vscode.Uri): Promise<MontageDocument> {
		const opened = uri.fsPath;
		if (!VIDEO.test(opened)) {
			const project = normalize(JSON.parse(await fs.promises.readFile(opened, 'utf8')) as Project);
			return new MontageDocument(uri, opened, project);
		}
		const file = opened.replace(/\.[^.\\/]+$/, '.starcapture');
		if (fs.existsSync(file)) {
			try {
				const project = normalize(JSON.parse(await fs.promises.readFile(file, 'utf8')) as Project);
				if (!project.media.some(m => samePath(m.path, opened))) {
					await addFile(project, opened, true);
				}
				return new MontageDocument(uri, file, project);
			} catch {
				// unreadable project: start a fresh one rather than failing to open the video
			}
		}
		// A video still being written (download, render) cannot be read yet: give it a few seconds.
		let media;
		for (let attempt = 0; ; attempt++) {
			try {
				media = await probe(opened);
				break;
			} catch (err) {
				if (attempt >= 4) {
					throw new Error(`Cette vidéo est illisible (fichier incomplet ou abîmé) : ${err instanceof Error ? err.message.split('\n').pop() : String(err)}`);
				}
				await new Promise(r => setTimeout(r, 1500));
			}
		}
		const project = emptyProject(path.basename(opened).replace(/\.[^.]+$/, ''), even(media.width ?? 1920), even(media.height ?? 1080), Math.round(media.fps ?? 30) || 30);
		project.media.push(media);
		addMediaClip(project, media, { start: 0 });
		return new MontageDocument(uri, file, project);
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._onDidEdit.dispose();
		for (const p of this.pending.values()) {
			p.reject(new Error('Montage fermé'));
		}
	}

	/** Applies editing steps as one undoable change, and tells every view. */
	edit(label: string, ops: Op[]): string[] {
		const before = JSON.stringify(this.project);
		let created: string[];
		try {
			created = applyOps(this.project, ops);
		} catch (err) {
			this.project = JSON.parse(before);
			throw err;
		}
		this.commit(label, before);
		return created;
	}

	/** Records a change made directly on `this.project`. */
	commit(label: string, before: string): void {
		this.undoStack.push(before);
		if (this.undoStack.length > MAX_UNDO) {
			this.undoStack.shift();
		}
		this.redoStack = [];
		this._onDidEdit.fire({
			document: this,
			label,
			undo: () => this.undo(),
			redo: () => this.redo(),
		});
		this._onDidChange.fire({ label });
	}

	undo(): void {
		const previous = this.undoStack.pop();
		if (previous) {
			this.redoStack.push(JSON.stringify(this.project));
			this.project = JSON.parse(previous);
			this._onDidChange.fire({ label: 'Annuler' });
		}
	}

	redo(): void {
		const next = this.redoStack.pop();
		if (next) {
			this.undoStack.push(JSON.stringify(this.project));
			this.project = JSON.parse(next);
			this._onDidChange.fire({ label: 'Rétablir' });
		}
	}

	async save(target = this.file): Promise<void> {
		await fs.promises.writeFile(target, JSON.stringify(this.project, null, '\t'));
	}

	async revert(): Promise<void> {
		if (fs.existsSync(this.file)) {
			this.project = normalize(JSON.parse(await fs.promises.readFile(this.file, 'utf8')));
			this._onDidChange.fire({ label: 'Rétabli' });
		}
	}

	/** Asks a view for something only the page can do (render a frame, transcribe). */
	request<T>(message: Record<string, unknown>, timeoutMs = 60000): Promise<T> {
		const panel = [...this.panels][0];
		if (!panel) {
			return Promise.reject(new Error('Le montage n\'est pas affiché'));
		}
		const id = randomBytes(6).toString('hex');
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error('La page du montage n\'a pas répondu'));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: v => { clearTimeout(timer); resolve(v as T); },
				reject: e => { clearTimeout(timer); reject(e); },
			});
			panel.webview.postMessage({ ...message, requestId: id });
		});
	}
}

/** Adds a file to the project's media (and, if asked, at the end of the timeline). */
export async function addFile(project: Project, file: string, toTimeline = false): Promise<Media> {
	const existing = project.media.find(m => samePath(m.path, file));
	if (existing) {
		return existing;
	}
	const media = await probe(file);
	project.media.push(media);
	if (toTimeline) {
		addMediaClip(project, media);
	}
	return media;
}

export class MontageEditorProvider implements vscode.CustomEditorProvider<MontageDocument> {

	/** The preview of a montage fills the screen (Zen mode entered by this editor). */
	private cinema = false;

	static readonly viewType = 'starcapture.editor';
	readonly documents = new Set<MontageDocument>();
	/** The montage the user last looked at (Claude's tools act on it by default). */
	active: MontageDocument | undefined;
	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<MontageDocument>>();
	readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

	constructor(private readonly context: vscode.ExtensionContext, private readonly orbitUri: vscode.Uri | undefined) { }

	async openCustomDocument(uri: vscode.Uri): Promise<MontageDocument> {
		const doc = await MontageDocument.open(uri);
		// Autosave, like editing software: a crash or a closed window never loses the edit.
		let timer: NodeJS.Timeout | undefined;
		doc.onDidEdit(e => this._onDidChangeCustomDocument.fire(e));
		// Every change, undo and redo included.
		doc.onDidChange(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				vscode.workspace.save(doc.uri).then(undefined, () => doc.save());
			}, 1500);
		});
		this.documents.add(doc);
		return doc;
	}

	/** Told when a montage opens in an editor (recent list of the StarCapture tab). */
	onOpened: (doc: MontageDocument) => void = () => undefined;

	async resolveCustomEditor(doc: MontageDocument, panel: vscode.WebviewPanel): Promise<void> {
		doc.panels.add(panel);
		this.active = doc;
		this.onOpened(doc);
		const webview = panel.webview;
		webview.options = { enableScripts: true, localResourceRoots: this.roots(doc) };
		webview.html = this.html(webview);
		const disposables: vscode.Disposable[] = [];
		const send = () => webview.postMessage({ type: 'project', project: doc.project, media: this.mediaUris(doc, webview), missing: doc.project.media.filter(m => !fs.existsSync(m.path)).map(m => m.id), duration: projectDuration(doc.project) });
		disposables.push(
			doc.onDidChange(() => {
				webview.options = { enableScripts: true, localResourceRoots: this.roots(doc) };
				send();
			}),
			panel.onDidChangeViewState(() => {
				if (panel.active) {
					this.active = doc;
				}
			}),
			webview.onDidReceiveMessage(msg => this.onMessage(doc, panel, msg, send).catch(err => {
				vscode.window.showErrorMessage(`StarCapture : ${err instanceof Error ? err.message : String(err)}`);
				send();
			})),
		);
		panel.onDidDispose(() => {
			if (this.cinema) {
				this.cinema = false;
				vscode.commands.executeCommand('workbench.action.toggleZenMode');
			}
			doc.panels.delete(panel);
			disposables.forEach(d => d.dispose());
			if (this.active === doc && !doc.panels.size) {
				this.active = [...this.documents].find(d => d.panels.size);
			}
		});
	}

	private async onMessage(doc: MontageDocument, panel: vscode.WebviewPanel, msg: { type: string; [key: string]: unknown }, send: () => void): Promise<void> {
		const webview = panel.webview;
		switch (msg.type) {
			case 'ready':
				send();
				this.sendCreations(webview);
				this.analyse(doc, webview);
				break;
			case 'applyCreation': {
				const creation = findCreation(String(msg.id));
				await this.applyCreation(doc, creation, {});
				webview.postMessage({ type: 'toast', text: `« ${creation.name} » appliqué` });
				break;
			}
			case 'saveCreation': {
				const clip = doc.project.clips.find(one => one.id === msg.from);
				if (!clip) {
					break;
				}
				const media = doc.project.media.find(m => m.id === clip.media);
				const name = await vscode.window.showInputBox({ title: 'Enregistrer dans mes créations', prompt: clip.text ? 'Ce style de texte sera réutilisable dans tous tes montages' : media?.kind === 'image' ? 'Cette image sera réutilisable par-dessus tous tes montages, à la même place' : 'Les réglages de ce clip (zoom, couleur, fondus, animation…) seront réutilisables sur n\'importe quel clip', placeHolder: 'Nom de la création', value: clip.text ? clip.text.content.slice(0, 30) : clip.name ?? '' });
				if (name?.trim()) {
					saveCreation({ name, from: clip.id }, doc.project);
					this.sendCreations();
				}
				break;
			}
			case 'deleteCreation': {
				const creation = findCreation(String(msg.id));
				if (await vscode.window.showWarningMessage(`Supprimer « ${creation.name} » de tes créations ?`, { modal: true, detail: 'Les montages qui l\'utilisent déjà ne changent pas.' }, 'Supprimer')) {
					deleteCreation(creation.id);
					this.sendCreations();
				}
				break;
			}
			case 'edit':
				doc.edit(String(msg.label ?? 'Modification'), msg.ops as Op[]);
				break;
			case 'undo':
				vscode.commands.executeCommand('undo');
				break;
			case 'redo':
				vscode.commands.executeCommand('redo');
				break;
			case 'cinema':
				// Zen mode gives the page the whole screen; it is left the same way, only if this editor entered it.
				if (!!msg.on !== this.cinema) {
					this.cinema = !!msg.on;
					await vscode.commands.executeCommand('workbench.action.toggleZenMode');
				}
				break;
			case 'view':
				doc.view = { playhead: Number(msg.playhead) || 0, selection: (msg.selection as string[]) ?? [], playing: !!msg.playing };
				break;
			case 'import': {
				const files = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Importer', filters: { 'Médias': ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'gif', 'webp'] } });
				if (files?.length) {
					await this.importFiles(doc, files.map(f => f.fsPath), msg.toTimeline === true);
					this.analyse(doc, webview);
				}
				break;
			}
			case 'upload': {
				// A file dropped from outside Orbit comes as its contents, in pieces: it is kept
				// next to the montage, in « medias », then imported like any other.
				const id = String(msg.id);
				let target = this.uploads.get(id);
				if (!target) {
					const folder = path.join(path.dirname(doc.file), 'medias');
					fs.mkdirSync(folder, { recursive: true });
					const name = path.basename(String(msg.name)).replace(/[<>:"/\\|?*]/g, '_') || 'media';
					const ext = path.extname(name);
					target = path.join(folder, name);
					for (let n = 2; fs.existsSync(target); n++) {
						target = path.join(folder, `${path.basename(name, ext)} (${n})${ext}`);
					}
					fs.writeFileSync(target, '');
					this.uploads.set(id, target);
				}
				const data = msg.data as Uint8Array | ArrayBuffer | { data?: number[] } | Record<string, number>;
				const piece = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(Array.isArray((data as { data?: number[] }).data) ? (data as { data: number[] }).data : Object.values(data as Record<string, number>));
				await fs.promises.appendFile(target, piece);
				if (msg.last) {
					this.uploads.delete(id);
					await this.importFiles(doc, [target], false, msg.at as number | undefined, msg.track as string | undefined);
					this.analyse(doc, webview);
				}
				webview.postMessage({ type: 'uploaded', id });
				break;
			}
			case 'relink': {
				const media = doc.project.media.find(m => m.id === msg.id);
				if (!media) {
					break;
				}
				const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Utiliser ce fichier', title: `Retrouver « ${media.name} »` });
				if (!picked?.length) {
					break;
				}
				const before = JSON.stringify(doc.project);
				media.path = picked[0].fsPath;
				// The others that went missing are usually in the same place: found without asking.
				let found = 1;
				for (const other of doc.project.media) {
					const beside = path.join(path.dirname(media.path), path.basename(other.path));
					if (other !== media && !fs.existsSync(other.path) && fs.existsSync(beside)) {
						other.path = beside;
						found++;
					}
				}
				doc.commit(found > 1 ? `Retrouver ${found} médias` : `Retrouver ${media.name}`, before);
				this.analyse(doc, webview);
				break;
			}
			case 'importPaths': {
				await this.importFiles(doc, (msg.paths as string[]).filter(p => fs.existsSync(p)), false, msg.at as number | undefined, msg.track as string | undefined);
				this.analyse(doc, webview);
				break;
			}
			case 'export':
				await vscode.commands.executeCommand('starcapture.export');
				break;
			case 'askClaude':
				await vscode.commands.executeCommand('starcapture.askClaude', String(msg.text ?? ''));
				break;
			case 'proxy': {
				const media = doc.project.media.find(m => m.id === msg.media);
				if (media) {
					await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Préparation de ${media.name} pour la lecture`, cancellable: false }, async progress => {
						let last = 0;
						const file = await proxy(media, p => {
							progress.report({ increment: (p - last) * 100 });
							last = p;
						});
						webview.postMessage({ type: 'proxy', media: media.id, uri: webview.asWebviewUri(vscode.Uri.file(file)).toString() });
					});
				}
				break;
			}
			case 'reveal':
				vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(String(msg.path)));
				break;
			case 'reply': {
				const pending = doc.pending.get(String(msg.requestId));
				if (pending) {
					doc.pending.delete(String(msg.requestId));
					if (msg.error) {
						pending.reject(new Error(String(msg.error)));
					} else {
						pending.resolve(msg.value);
					}
				}
				break;
			}
			case 'speechAudio': {
				// The page transcribes; it asks for 16 kHz audio of a piece of a file.
				const media = doc.project.media.find(m => m.id === msg.media);
				const pending = String(msg.requestId);
				try {
					if (!media) {
						throw new Error('Média introuvable');
					}
					const pcm = await speechAudio(media.path, Number(msg.from) || 0, Number(msg.to) || media.duration);
					webview.postMessage({ type: 'speechAudio', requestId: pending, data: pcm.toString('base64') });
				} catch (err) {
					webview.postMessage({ type: 'speechAudio', requestId: pending, error: err instanceof Error ? err.message : String(err) });
				}
				break;
			}
			case 'transcribeNative':
				await this.transcribe(doc, String(msg.media), String(msg.language ?? 'fr'));
				break;
			case 'cutSilences': {
				const media = doc.project.media.find(m => m.id === msg.media);
				if (!media) {
					break;
				}
				const removed = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Recherche des silences dans ${media.name}…` }, async () => {
					const found = await silences(media.path, Number(msg.thresholdDb ?? -38), Number(msg.minDuration ?? 0.5));
					const padding = 0.12;
					const ranges = sourceToTimeline(doc.project, media.id, found.map(([s, e]) => [s + padding, e - padding] as [number, number]).filter(([s, e]) => e - s > 0.15));
					if (!ranges.length) {
						return { cuts: 0, seconds: 0 };
					}
					const before = JSON.stringify(doc.project);
					const seconds = removeRanges(doc.project, ranges);
					doc.commit(`Couper ${ranges.length} silences`, before);
					return { cuts: ranges.length, seconds };
				});
				webview.postMessage({ type: 'toast', text: removed.cuts ? `${removed.cuts} silences coupés : ${Math.round(removed.seconds)} s de moins` : 'Aucun silence assez long trouvé' });
				break;
			}
			case 'transcript': {
				// Words the page recognised, kept in the project for captions and text-based editing.
				const before = JSON.stringify(doc.project);
				doc.project.transcripts = { ...doc.project.transcripts, [String(msg.media)]: msg.words as Word[] };
				doc.commit('Transcription', before);
				break;
			}
		}
	}

	/**
	 * Words of a media, kept in the project: whisper.cpp on this machine, or Whisper in the
	 * page when whisper.cpp cannot run. Progress shows in the page and in a notification.
	 */
	async transcribe(doc: MontageDocument, mediaId: string, language = 'fr'): Promise<Word[]> {
		const media = doc.project.media.find(m => m.id === mediaId);
		if (!media) {
			throw new Error('Média introuvable');
		}
		const tell = (text: string) => doc.panels.forEach(p => p.webview.postMessage({ type: 'trStatus', media: mediaId, text }));
		let words: Word[];
		try {
			words = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Transcription de ${media.name}`, cancellable: true }, async (progress, token) => {
				let last = 0;
				return transcribeMedia(media, language, (p, label) => {
					progress.report({ increment: Math.max(0, p - last) * 100, message: `${label} ${Math.round(p * 100)} %` });
					last = p;
					tell(`${label.replace(/…$/, '')} ${Math.round(p * 100)} %`);
				}, token);
			});
		} catch (err) {
			tell('');
			if (err instanceof Error && /annulée/.test(err.message)) {
				throw err;
			}
			// Fallback: Whisper inside the page (slower, needs the network the first time).
			console.error('[starcapture] whisper.cpp', err);
			vscode.window.showWarningMessage(`whisper.cpp indisponible (${err instanceof Error ? err.message : String(err)}) : transcription dans la page, plus lente.`);
			words = await doc.request<{ words: Word[] }>({ type: 'transcribe', media: mediaId, language }, 60 * 60 * 1000).then(v => v.words);
		}
		tell(`${words.length} mots`);
		const before = JSON.stringify(doc.project);
		doc.project.transcripts = { ...doc.project.transcripts, [mediaId]: words };
		doc.commit('Transcription', before);
		return words;
	}

	/** Puts a creation of the library into a montage, as one step that can be undone. */
	async applyCreation(doc: MontageDocument, creation: Creation, options: { ids?: string[]; start?: number; duration?: number; content?: string }): Promise<string[]> {
		const importImage = async (file: string) => (await this.importFiles(doc, [file], false))[0];
		// The image of an overlay joins the project's media first: the montage change that follows is one step.
		if (creation.kind === 'overlay' && creation.file && !doc.project.media.some(m => path.resolve(m.path) === path.resolve(String(creation.file)))) {
			await importImage(creation.file);
		}
		const before = JSON.stringify(doc.project);
		const ids = await applyCreation(doc.project, creation, { ...options, playhead: doc.view.playhead, selection: doc.view.selection }, importImage);
		doc.commit(`Appliquer « ${creation.name} »`, before);
		return ids;
	}

	/** What the library holds, for the pages: an overlay comes with its picture. */
	sendCreations(only?: vscode.Webview): void {
		const list = listCreations().map(creation => {
			let picture: string | undefined;
			try {
				if (creation.kind === 'overlay' && creation.file && fs.statSync(creation.file).size < 3 * 1024 * 1024) {
					const type = /\.jpe?g$/i.test(creation.file) ? 'jpeg' : path.extname(creation.file).slice(1).toLowerCase();
					picture = `data:image/${type};base64,${fs.readFileSync(creation.file).toString('base64')}`;
				}
			} catch {
				// the picture is gone: the card shows the name only
			}
			return { id: creation.id, name: creation.name, kind: creation.kind, description: creation.description, picture };
		});
		const targets = only ? [only] : [...this.documents].flatMap(document => [...document.panels].map(panel => panel.webview));
		targets.forEach(webview => webview.postMessage({ type: 'creations', list }));
	}

	/** Files being received from a page, by the identifier the page gave them. */
	private readonly uploads = new Map<string, string>();

	async importFiles(doc: MontageDocument, files: string[], toTimeline: boolean, at?: number, trackId?: string): Promise<Media[]> {
		const before = JSON.stringify(doc.project);
		const added: Media[] = [];
		for (const file of files) {
			const media = await addFile(doc.project, file);
			added.push(media);
			if (toTimeline || at !== undefined) {
				addMediaClip(doc.project, media, { start: at, track: trackId });
				if (at !== undefined) {
					at += media.duration;
				}
			}
		}
		doc.commit(added.length > 1 ? `Importer ${added.length} médias` : `Importer ${added[0]?.name ?? ''}`, before);
		return added;
	}

	/** Waveforms and thumbnails, computed once per file and cached. */
	private analyse(doc: MontageDocument, webview: vscode.Webview): void {
		for (const media of doc.project.media) {
			waveform(media).then(peaks => {
				if (peaks) {
					webview.postMessage({ type: 'peaks', media: media.id, peaks });
				}
			}).catch(() => undefined);
			filmstrip(media).then(strip => {
				if (strip) {
					webview.postMessage({ type: 'strip', media: media.id, uri: webview.asWebviewUri(vscode.Uri.file(strip.file)).toString(), every: strip.every, count: strip.count, width: strip.width, height: strip.height });
				}
			}).catch(() => undefined);
		}
	}

	private mediaUris(doc: MontageDocument, webview: vscode.Webview): Record<string, string> {
		return Object.fromEntries(doc.project.media.map(m => [m.id, webview.asWebviewUri(vscode.Uri.file(m.path)).toString()]));
	}

	private roots(doc: MontageDocument): vscode.Uri[] {
		const dirs = new Set([path.dirname(doc.file), CACHE_DIR, ...doc.project.media.map(m => path.dirname(m.path))]);
		return [
			vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			...(this.orbitUri ? [vscode.Uri.joinPath(this.orbitUri, 'media')] : []),
			...[...dirs].map(d => vscode.Uri.file(d)),
			...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri),
		];
	}

	private html(webview: vscode.Webview): string {
		const nonce = randomBytes(16).toString('base64');
		const own = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
		const orbit = (file: string) => this.orbitUri ? webview.asWebviewUri(vscode.Uri.joinPath(this.orbitUri, 'media', file)).toString() : '';
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} data: blob:`,
			`media-src ${webview.cspSource} blob: data:`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
			`font-src ${webview.cspSource} https://fonts.gstatic.com data:`,
			`script-src 'nonce-${nonce}' 'wasm-unsafe-eval' https://cdn.jsdelivr.net`,
			`worker-src blob: ${webview.cspSource}`,
			`connect-src ${webview.cspSource} https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co blob: data:`,
		].join('; ');
		return `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	${this.orbitUri ? `<link href="${orbit('base.css')}" rel="stylesheet">` : ''}
	<link href="${own('editor.css')}" rel="stylesheet">
</head>
<body class="page-starcapture">
	<div id="app"></div>
	${this.orbitUri ? `<script nonce="${nonce}" src="${orbit('icons.js')}"></script><script nonce="${nonce}" src="${orbit('select.js')}"></script>` : ''}
	<script nonce="${nonce}" src="${own('engine.js')}"></script>
	<script nonce="${nonce}" type="module" src="${own('transcribe.js')}"></script>
	<script nonce="${nonce}" src="${own('editor.js')}"></script>
</body>
</html>`;
	}

	saveCustomDocument(doc: MontageDocument): Thenable<void> {
		return doc.save();
	}

	async saveCustomDocumentAs(doc: MontageDocument, destination: vscode.Uri): Promise<void> {
		const target = VIDEO.test(destination.fsPath) ? destination.fsPath.replace(/\.[^.\\/]+$/, '.starcapture') : destination.fsPath;
		await doc.save(target);
	}

	revertCustomDocument(doc: MontageDocument): Thenable<void> {
		return doc.revert();
	}

	async backupCustomDocument(doc: MontageDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
		await fs.promises.mkdir(path.dirname(context.destination.fsPath), { recursive: true });
		await doc.save(context.destination.fsPath);
		return { id: context.destination.toString(), delete: () => fs.promises.rm(context.destination.fsPath, { force: true }) };
	}
}

function samePath(a: string, b: string): boolean {
	return process.platform === 'win32' ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase() : path.normalize(a) === path.normalize(b);
}

function even(n: number): number {
	return Math.max(2, Math.round(n / 2) * 2);
}
