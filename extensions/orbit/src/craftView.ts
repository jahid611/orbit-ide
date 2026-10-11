/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { CRAFT_APPS, CraftApp, craftGui, craftIcon, craftPort, craftTokenFile } from './craft';
import { Page } from './page';

type Reply = { ok?: boolean; result?: unknown; error?: string };

/**
 * A Crafting App shown inside Orbit. The real application runs with its control channel, and
 * the agents of the project drive that same running application (their `<app>_live` tools,
 * see `craft.ts`), so the user watches them work, here, and works in it too.
 *
 * What the tab shows is the application's own window, held exactly over the page by a helper
 * (`media/dock.ps1`): full speed, every gesture, as if it were open beside. The page only
 * paints its area in one plain colour with a small mark in two corners; the helper looks at
 * what Orbit draws, finds that area, keeps the window on it while Orbit's window moves, takes
 * it off when another tab is in front, and cuts out of it whatever Orbit shows over the tab
 * (a list, a menu). So this side has little to follow: it starts the application, says
 * « hold it », and listens to the helper, which also says when the application is closed.
 *
 * The control channel is only spoken to for one thing, opening a file of the project, on a
 * connection made for the occasion: a connection kept open had to be watched, lost and found
 * again, and that is where the page used to stay on « starting » for ever.
 *
 * (Showing pictures of the window instead was tried first: the application hands out two or
 * three a second, no more, and takes neither a drag nor the wheel. Making the window a child
 * of Orbit's was tried too: it was destroyed with Orbit, work included.)
 */
export class CraftView extends Page {

	private state: 'idle' | 'starting' | 'live' | 'out' | 'failed' = 'idle';
	private problem = '';
	private starting: Promise<void> | undefined;
	/** The helper that holds the application's window (see `media/dock.ps1`). */
	private link: net.Socket | undefined;
	private linking: Promise<net.Socket | undefined> | undefined;
	private helperSaid: ((word: string) => void) | undefined;
	/** Orders to the helper go one at a time: it answers each with one word. */
	private orders: Promise<unknown> = Promise.resolve();
	/** Whether the window is over the page right now (the helper says so). */
	private shown = false;
	/** The user sent the application to a window of its own: it stays there until asked back. */
	private keptOut = false;

	constructor(context: vscode.ExtensionContext, private readonly app: CraftApp, private readonly root: () => string | undefined) {
		super(context, `craft-${app.id}`, app.name, undefined, 'craft');
		// With a file, the page opens it: in the application shown here, never in another window.
		this.disposables.push(vscode.commands.registerCommand(`orbit.craft.show.${app.id}`, (file?: vscode.Uri | string) => {
			const wanted = file instanceof vscode.Uri ? file.fsPath : typeof file === 'string' ? file : undefined;
			this.show();
			return wanted ? this.openFile(wanted) : undefined;
		}));
	}

	override dispose(): void {
		// The application may hold unsaved work: it is handed back to the user, never killed.
		// The helper does it by itself when its input closes, which also covers an Orbit that
		// goes away without a word (the order below may not have the time to reach it).
		this.place('front');
		this.link?.end();
		super.dispose();
	}

	/** The page is closed: the application comes back in front of the user, who may have work to save. */
	protected override closed(): void {
		if (this.state === 'live') {
			this.place('front');
			this.state = 'out';
		}
		this.shown = false;
	}

	/** The tab went behind another, or came back: the helper need not find out by itself. */
	protected override viewChanged(): void {
		if (this.state === 'live' && this.link) {
			this.place('look');
		}
	}

	private port(root: string): number {
		return craftPort(this.app, root);
	}

	/**
	 * What the page paints for the helper to find it: a mark at the top left, one at the bottom
	 * right, and one plain colour between them. Colours no interface uses, a little different
	 * for each project and each application (two pages side by side, or two windows of Orbit,
	 * must not be taken for one another). The marks are vivid on purpose: dark ones were found,
	 * by chance, in the wallpaper.
	 */
	private colours(): [number[], number[], number[]] {
		// The helper takes a colour for another within two units: the steps here are five and six.
		const project = this.port(this.root() ?? '') % 400;
		const a = project % 10, b = Math.floor(project / 10) % 10, place = Math.max(0, CRAFT_APPS.indexOf(this.app));
		// Both marks tell the applications apart: a helper that still sees one mark where it was
		// takes its tab to be there, and the other pages paint theirs at the same place.
		return [[203 - 6 * place, 2 + 5 * a, 119 - 5 * b], [17, 119 - 6 * place, 150 + 5 * a], [29, 27, 41]];
	}

	protected send(): void {
		const [first, second, plain] = this.colours().map(colour => `rgb(${colour.join(',')})`);
		this.post({ type: 'state', name: this.app.name, state: this.state, problem: this.problem, icon: this.icon(), shown: this.shown, marks: [first, second], plain, opens: !!this.app.open });
	}

	private icon(): string | undefined {
		const file = craftIcon(this.app);
		try {
			return file ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : undefined;
		} catch {
			return undefined;
		}
	}

	protected override async refresh(): Promise<void> {
		this.send();
		if (this.state === 'idle') {
			await this.start();
		} else if (this.state === 'out' && !this.keptOut) {
			// The page was closed, or the helper left: opening the page again takes the window back
			// (or starts the application again, if it was closed meanwhile).
			const root = this.root();
			if (root && await this.listening(this.port(root))) {
				this.state = 'live';
				this.send();
				await this.hold();
			} else {
				this.state = 'idle';
				await this.start();
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'open':
				await this.openPicture();
				break;
			case 'out':
				this.state = 'out';
				this.keptOut = true;
				this.shown = false;
				this.send();
				await this.place('front');
				break;
			case 'in':
				// As when the page opens again: taken back if it still runs, started again if not.
				this.keptOut = false;
				this.state = 'out';
				await this.refresh();
				break;
			case 'retry':
				this.keptOut = false;
				this.state = 'idle';
				await this.refresh();
				break;
		}
	}

	/** Starts the application for this project (or joins the one already running). Never twice at once. */
	private start(): Promise<void> {
		this.starting ??= this.launch().finally(() => { this.starting = undefined; });
		return this.starting;
	}

	private async launch(): Promise<void> {
		const root = this.root();
		const program = craftGui(this.app);
		if (!root || !program || !this.app.window || process.platform !== 'win32') {
			this.fail(!root ? 'Ouvre d\'abord un projet : l\'application travaille dans son dossier.' : `La fenêtre de ${this.app.name} ne s'affiche dans Orbit que sous Windows pour l'instant. Tes agents gardent ses outils sans fenêtre.`);
			return;
		}
		this.state = 'starting';
		this.problem = '';
		this.send();
		const port = this.port(root);
		if (!await this.listening(port)) {
			const started = spawn(program, this.app.window(port, craftTokenFile(this.app, root), root), { cwd: root, detached: true, stdio: 'ignore' });
			started.on('error', () => undefined);
			started.unref();
			this.link?.end();
			this.link = undefined;
			// Not awaited: the helper waits for the window, which the loop below also waits for.
			this.place('away');
			for (let i = 0; i < 60 && !await this.listening(port); i++) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
			if (!await this.listening(port)) {
				this.fail(`${this.app.name} n'a pas répondu au bout de trente secondes.`);
				return;
			}
		}
		this.state = 'live';
		this.send();
		await this.hold();
	}

	/** Tells the helper to keep the window over the page, from now on and by itself. */
	private hold(): Promise<string> {
		const [first, second, plain] = this.colours();
		// Orbit's windows belong to the process this one was started by.
		return this.place(`dock ${process.ppid} ${first.join(' ')} ${second.join(' ')} ${plain.join(' ')}`);
	}

	private fail(problem: string): void {
		this.state = 'failed';
		this.problem = problem;
		this.shown = false;
		this.send();
	}

	/** Whether the application answers on its control channel: that is how it is known to run. */
	private listening(port: number): Promise<boolean> {
		return new Promise(resolve => {
			const socket = net.connect(port, '127.0.0.1');
			const done = (there: boolean) => { socket.destroy(); resolve(there); };
			socket.setTimeout(1500, () => done(false));
			socket.once('error', () => done(false));
			socket.once('connect', () => done(true));
		});
	}

	/** One request to the application's control channel, on a connection of its own. */
	private ask(method: string, params: object): Promise<Reply> {
		const root = this.root();
		if (!root) {
			return Promise.resolve({ ok: false, error: 'pas de projet' });
		}
		let token = '';
		if (this.app.token) {
			try {
				token = fs.readFileSync(craftTokenFile(this.app, root), 'utf8').trim();
			} catch {
				return Promise.resolve({ ok: false, error: 'secret du canal introuvable' });
			}
		}
		return new Promise(resolve => {
			const socket = net.connect(this.port(root), '127.0.0.1');
			let buffer = '';
			const done = (reply: Reply) => { clearTimeout(timer); socket.destroy(); resolve(reply); };
			const timer = setTimeout(() => done({ ok: false, error: 'délai dépassé' }), 20000);
			const request = () => socket.write(`${JSON.stringify({ id: 'ask', method, params })}\n`);
			socket.once('error', () => done({ ok: false, error: `${this.app.name} ne répond pas` }));
			socket.once('close', () => done({ ok: false, error: `${this.app.name} a coupé la liaison` }));
			socket.once('connect', () => token ? socket.write(`${JSON.stringify({ id: 'auth', method: 'auth', params: { token } })}\n`) : request());
			socket.on('data', chunk => {
				buffer += String(chunk);
				let end: number;
				while ((end = buffer.indexOf('\n')) >= 0) {
					const line = buffer.slice(0, end);
					buffer = buffer.slice(end + 1);
					let reply: Reply & { id?: unknown };
					try {
						reply = JSON.parse(line);
					} catch {
						continue;
					}
					if (reply.id === 'auth') {
						if (reply.ok === true) {
							request();
						} else {
							done({ ok: false, error: 'accès refusé' });
						}
					} else if (reply.id === 'ask') {
						done(reply);
					}
				}
			});
		});
	}

	/**
	 * Opens a file of the project in the application shown here. An application held to the
	 * project's folder takes a path written from that folder, with forward slashes.
	 */
	private async openFile(file: string): Promise<string> {
		const root = this.root();
		if (!this.app.open) {
			return `${this.app.name} est affiché dans Orbit. Ouvre le fichier par ses outils en direct (mcp__${this.app.id}_live__*).`;
		}
		for (let i = 0; i < 80 && (this.state === 'idle' || this.state === 'starting'); i++) {
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		const full = root ? (path.isAbsolute(file) ? file : path.join(root, file)) : '';
		const relative = root ? path.relative(root, full).split(path.sep).join('/') : '';
		if (!relative || relative.startsWith('..')) {
			const why = `${this.app.name} n'ouvre ici que les fichiers du projet.`;
			vscode.window.showWarningMessage(why);
			return why;
		}
		const opened = await this.ask('app.open', { path: this.app.confined ? relative : full });
		return opened.ok === false ? `${this.app.name} : ${opened.error ?? 'ouverture impossible'}` : `${relative} est ouvert dans ${this.app.name}, dans Orbit.`;
	}

	/**
	 * Gives the helper an order, and resolves with its answer (`away`, `front`, `held`, `looked`,
	 * or nothing when the helper is gone). The helper also speaks by itself: `shown` and
	 * `hidden` as the window comes over the page and leaves it, `gone` when the application is closed.
	 */
	private place(order: string): Promise<string> {
		const root = this.root();
		if (process.platform !== 'win32' || !root) {
			return Promise.resolve('');
		}
		const sent = this.orders.then(async () => {
			const link = await this.helper(root);
			if (!link) {
				return '';
			}
			return new Promise<string>(resolve => {
				const timer = setTimeout(() => done(''), 40000);
				const done = (word: string) => {
					clearTimeout(timer);
					if (this.helperSaid === done) {
						this.helperSaid = undefined;
					}
					resolve(word);
				};
				this.helperSaid = done;
				link.write(`${order}\n`);
			});
		});
		this.orders = sent.catch(() => undefined);
		return sent.catch(() => '');
	}

	/**
	 * The line to the helper, which is started if it is not there. The helper is a program of its
	 * own, not a child held by pipes: started the ordinary way, the system stopped it together
	 * with Orbit's extensions (a reload, Orbit closing) before it had put the window back in
	 * front of the user, and the application stayed hidden or off the screens. So it is started
	 * apart and calls back on a local port; when that line drops, it knows Orbit is gone and
	 * brings the application back by itself.
	 */
	private helper(root: string): Promise<net.Socket | undefined> {
		if (this.link && !this.link.destroyed) {
			return Promise.resolve(this.link);
		}
		this.linking ??= new Promise<net.Socket | undefined>(resolve => {
			const key = randomBytes(16).toString('hex');
			const server = net.createServer(socket => {
				let pending = '';
				let known = false;
				let gone = false;
				socket.on('error', () => undefined);
				socket.on('data', chunk => {
					pending += String(chunk);
					let end: number;
					while ((end = pending.indexOf('\n')) >= 0) {
						const word = pending.slice(0, end).trim();
						pending = pending.slice(end + 1);
						if (!known) {
							// The first line is the secret given to the helper: nobody else gives orders here.
							if (word !== key) {
								socket.destroy();
								return;
							}
							known = true;
							this.link = socket;
							server.close();
							finish(socket);
						} else if (word === 'shown' || word === 'hidden') {
							this.shown = word === 'shown';
							this.post({ type: 'shown', on: this.shown });
						} else if (word === 'gone' || word === 'nowindow') {
							gone = true;
						} else if (word && word !== 'ready') {
							this.helperSaid?.(word);
						}
					}
				});
				socket.on('close', () => {
					if (this.link !== socket) {
						return;
					}
					this.link = undefined;
					if (gone && (this.state === 'live' || this.state === 'out')) {
						// Closed by its own button, or stopped: said plainly, with a way back.
						this.fail(`${this.app.name} a été fermé.`);
					} else if (this.state === 'live') {
						// Nobody holds the window any more (the helper put it back in front of the
						// user as it left): the page says where the application is.
						this.state = 'out';
						this.shown = false;
						this.send();
					}
					this.helperSaid?.('');
				});
			});
			const timer = setTimeout(() => finish(undefined), 45000);
			const finish = (socket: net.Socket | undefined) => {
				clearTimeout(timer);
				this.linking = undefined;
				if (!socket) {
					server.close();
				}
				resolve(socket);
			};
			server.on('error', () => finish(undefined));
			server.listen(0, '127.0.0.1', () => {
				const address = server.address();
				// PowerShell runs under a small host of its own (`media/dock-host.js`, on Orbit's runtime),
				// started detached: see there why neither can be done more simply.
				const media = path.join(this.context.extensionPath, 'media');
				const started = spawn(process.execPath, [path.join(media, 'dock-host.js'), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(media, 'dock.ps1'), '-Port', String(this.port(root)), '-Link', String(typeof address === 'object' && address ? address.port : 0), '-Key', key], { windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
				started.stdout?.resume();
				started.stderr?.resume();
				started.on('error', () => finish(undefined));
				// Left before calling back (no window found in time, PowerShell refused): nothing to wait for.
				started.on('exit', () => setTimeout(() => { if (this.linking) { finish(undefined); } }, 500));
				started.unref();
			});
		});
		return this.linking;
	}

	/** A file of the project, opened in the application. (The list shows over the page: the window makes room by itself.) */
	private async openPicture(): Promise<void> {
		const root = this.root();
		if (!root || !this.app.open) {
			return;
		}
		const files = await vscode.workspace.findFiles(`**/*.{${this.app.open.join(',')}}`, '**/{node_modules,.git,dist,build,out,.next,.orbit}/**', 400);
		const items = files.map(uri => path.relative(root, uri.fsPath).split(path.sep).join('/')).filter(file => !file.startsWith('..')).sort();
		if (!items.length) {
			vscode.window.showInformationMessage(`Aucun fichier du projet que ${this.app.name} sache ouvrir (${this.app.open.join(', ')}).`);
			return;
		}
		const pick = await vscode.window.showQuickPick(items, { title: this.app.name, placeHolder: 'Fichier du projet à ouvrir' });
		if (pick) {
			const said = await this.openFile(pick);
			if (!said.includes('est ouvert')) {
				vscode.window.showErrorMessage(said);
			}
		}
	}
}
