/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import { CraftApp, craftGui, craftIcon, craftPort, craftTokenFile } from './craft';
import { Page } from './page';

/**
 * A Crafting App shown inside Orbit. The real application runs with its control channel, and
 * the agents of the project drive that same running application (their `<app>_live` tools,
 * see `craft.ts`), so the user watches them work, here.
 *
 * Two ways of showing it, one after the other:
 * - its pictures: the window is kept away from the screens and the page shows what it draws.
 *   The application hands out two or three pictures a second, no more (it waits for its own
 *   animations before each one): enough to see where things are, far too slow to work.
 * - its window: as soon as the mouse rests on the page, the real window is laid exactly over
 *   it (`media/dock.ps1`) and follows the Orbit window. Full speed, every gesture. A window
 *   laid over Orbit hides what Orbit opens there (the command palette): it steps aside for those.
 */
export class CraftView extends Page {

	private process: ReturnType<typeof spawn> | undefined;
	private socket: net.Socket | undefined;
	private buffer = '';
	private readonly waiting = new Map<number | string, (reply: { ok?: boolean; result?: unknown; error?: string }) => void>();
	private nextId = 1;
	private state: 'idle' | 'starting' | 'live' | 'out' | 'failed' = 'idle';
	private problem = '';
	private looping = false;
	private size = { width: 1280, height: 800 };
	/** The helper that holds the application's window (see `media/dock.ps1`), and what it last said. */
	private helper: ReturnType<typeof spawn> | undefined;
	private helperSaid: ((word: string) => void) | undefined;
	/** Whether the real window is laid over the page. */
	private docked = false;

	constructor(context: vscode.ExtensionContext, private readonly app: CraftApp, private readonly root: () => string | undefined) {
		super(context, 'craft', app.name);
		this.disposables.push(vscode.commands.registerCommand(`orbit.craft.show.${app.id}`, () => this.show()));
		// What Orbit opens over the page would be hidden by the window: it steps aside first.
		for (const [id, command] of [['palette', 'workbench.action.showCommands'], ['files', 'workbench.action.quickOpen']]) {
			this.disposables.push(vscode.commands.registerCommand(`orbit.craft.${id}`, async () => {
				await this.undock();
				await vscode.commands.executeCommand(command);
			}));
		}
	}

	/** The window laid over the page: only while this is true do Orbit's shortcuts step it aside. */
	private setDocked(on: boolean): void {
		this.docked = on;
		vscode.commands.executeCommand('setContext', 'orbit.craftDocked', on);
		this.post({ type: 'docked', on });
	}

	private async undock(): Promise<void> {
		if (this.docked) {
			this.setDocked(false);
			await this.place('away');
			this.loop();
		}
	}

	/** The page went behind another tab, or came back. */
	protected override viewChanged(visible: boolean): void {
		if (!visible) {
			this.undock();
		}
	}

	override dispose(): void {
		// The application may hold unsaved work: it is handed back to the user, never killed.
		this.place('front');
		this.socket?.destroy();
		setTimeout(() => this.helper?.kill(), 1500);
		super.dispose();
	}

	/** The page is closed: the application comes back in front of the user, who may have work to save. */
	protected override closed(): void {
		if (this.state === 'live') {
			this.place('front');
		}
		this.docked = false;
		vscode.commands.executeCommand('setContext', 'orbit.craftDocked', false);
		this.state = this.socket ? 'out' : 'idle';
	}

	protected send(): void {
		this.post({ type: 'state', name: this.app.name, state: this.state, problem: this.problem, icon: this.icon() });
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
		if (this.state === 'idle' || this.state === 'failed') {
			await this.start();
		}
		this.loop();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'size': {
				const width = Math.max(820, Math.min(2400, Math.round(Number(msg.width) || 0)));
				const height = Math.max(520, Math.min(1600, Math.round(Number(msg.height) || 0)));
				if (width !== this.size.width || height !== this.size.height) {
					this.size = { width, height };
					// The page changed shape: the window no longer fits it, back to pictures until the mouse rests again.
					await this.undock();
					await this.call('ui.resize', this.size);
				}
				break;
			}
			case 'anchor': {
				// The mouse rests on the page: the real window is laid over it, at the pointer.
				if (this.state === 'live' && !this.docked) {
					const said = await this.place(`dock ${Math.round(msg.dx)} ${Math.round(msg.dy)} ${Math.round(msg.width)} ${Math.round(msg.height)}`);
					if (said === 'docked') {
						this.setDocked(true);
					}
				}
				break;
			}
			case 'click':
				await this.call('ui.click', { x: Number(msg.x), y: Number(msg.y), button: msg.button === 'right' ? 'right' : 'left', count: msg.count === 2 ? 2 : 1 });
				break;
			case 'move':
				await this.call('ui.move', { x: Number(msg.x), y: Number(msg.y) });
				break;
			case 'key':
				await this.call('ui.key', { key: String(msg.key), shift: !!msg.shift, alt: !!msg.alt, ctrl: !!msg.ctrl });
				break;
			case 'text':
				await this.call('ui.type', { text: String(msg.text) });
				break;
			case 'open':
				await this.openPicture();
				break;
			case 'out':
				this.state = 'out';
				this.setDocked(false);
				this.send();
				await this.place('front');
				break;
			case 'in':
				await this.place('away');
				await this.call('ui.resize', this.size);
				this.state = 'live';
				this.send();
				this.loop();
				break;
			case 'retry':
				await this.start();
				this.loop();
				break;
		}
	}

	/** Starts the application for this project (or joins the one already running), then keeps its window away. */
	private async start(): Promise<void> {
		const root = this.root();
		const program = craftGui(this.app);
		if (!root || !program) {
			this.state = 'failed';
			this.problem = !root ? 'Ouvre d\'abord un projet : l\'application travaille dans son dossier.' : `La fenêtre de ${this.app.name} n'est fournie que sous Windows pour l'instant. Tes agents gardent ses outils sans fenêtre.`;
			this.send();
			return;
		}
		this.state = 'starting';
		this.problem = '';
		this.send();
		const port = craftPort(root);
		const token = craftTokenFile(this.app, root);
		if (!await this.connect(port, token)) {
			this.process = spawn(program, ['--control', String(port), '--control-token-file', token, '--automation-read-root', root, '--automation-write-root', root], { detached: true, stdio: 'ignore' });
			this.process.unref();
			const pid = this.process.pid;
			this.process.on('exit', () => {
				if (this.process?.pid === pid) {
					this.process = undefined;
					this.socket?.destroy();
				}
			});
			this.helper?.kill();
			this.helper = undefined;
			await this.place('away');
			for (let i = 0; i < 40 && !await this.connect(port, token); i++) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
		}
		if (!this.socket) {
			this.state = 'failed';
			this.problem = `${this.app.name} n'a pas répondu. Réessaie, ou ouvre-le dans sa propre fenêtre depuis « Outils du projet ».`;
			this.send();
			return;
		}
		this.state = 'live';
		// Once it answers, the application has put its window back where it last was: away again.
		await this.place('away');
		await this.call('ui.resize', this.size);
		this.send();
	}

	private connect(port: number, tokenFile: string): Promise<boolean> {
		let token = '';
		try {
			token = fs.readFileSync(tokenFile, 'utf8').trim();
		} catch {
			return Promise.resolve(false);
		}
		return new Promise(resolve => {
			const socket = net.connect(port, '127.0.0.1');
			const fail = () => { socket.destroy(); resolve(false); };
			socket.once('error', fail);
			socket.once('connect', async () => {
				socket.off('error', fail);
				this.socket?.destroy();
				this.socket = socket;
				this.buffer = '';
				socket.on('data', chunk => this.read(String(chunk)));
				socket.on('error', () => undefined);
				socket.on('close', () => {
					if (this.socket === socket) {
						this.socket = undefined;
						for (const reply of this.waiting.values()) {
							reply({ ok: false, error: 'fermé' });
						}
						this.waiting.clear();
						if (this.state === 'live' || this.state === 'out') {
							this.state = 'idle';
							this.send();
						}
					}
				});
				resolve((await this.call('auth', { token }, 'auth')).ok === true);
			});
		});
	}

	private read(text: string): void {
		this.buffer += text;
		let end: number;
		while ((end = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, end);
			this.buffer = this.buffer.slice(end + 1);
			try {
				const reply = JSON.parse(line);
				this.waiting.get(reply.id)?.(reply);
				this.waiting.delete(reply.id);
			} catch {
				// not a reply
			}
		}
	}

	private call(method: string, params: object = {}, id: number | string = this.nextId++): Promise<{ ok?: boolean; result?: unknown; error?: string }> {
		const socket = this.socket;
		if (!socket) {
			return Promise.resolve({ ok: false, error: 'pas de connexion' });
		}
		return new Promise(resolve => {
			this.waiting.set(id, resolve);
			socket.write(`${JSON.stringify({ id, method, params })}\n`);
			setTimeout(() => {
				if (this.waiting.delete(id)) {
					resolve({ ok: false, error: 'délai dépassé' });
				}
			}, 20000);
		});
	}

	/** One picture after the other, for as long as the page is in front and the window is away. */
	private async loop(): Promise<void> {
		if (this.looping) {
			return;
		}
		this.looping = true;
		try {
			while (this.visible && this.state === 'live' && this.socket && !this.docked) {
				const shot = await this.call('ui.screenshot', { focus: false });
				const picture = (shot.result as { base64?: string } | undefined)?.base64;
				if (picture) {
					this.post({ type: 'frame', picture, width: this.size.width, height: this.size.height });
				} else {
					await new Promise(resolve => setTimeout(resolve, 700));
				}
			}
		} finally {
			this.looping = false;
		}
	}

	/**
	 * Tells the helper where the application's window goes, and resolves with its answer
	 * (`away`, `front`, `docked`, or `missed` when the pointer was not over Orbit).
	 */
	private place(order: string): Promise<string> {
		const root = this.root();
		if (process.platform !== 'win32' || !root || (!this.process?.pid && !this.socket)) {
			return Promise.resolve('');
		}
		if (!this.helper || this.helper.exitCode !== null) {
			const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.context.extensionPath, 'media', 'dock.ps1'), '-Port', String(craftPort(root))], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
			this.helper = helper;
			let pending = '';
			helper.stdout?.on('data', chunk => {
				pending += String(chunk);
				let end: number;
				while ((end = pending.indexOf('\n')) >= 0) {
					const word = pending.slice(0, end).trim();
					pending = pending.slice(end + 1);
					if (word === 'gone' || word === 'lost') {
						this.setDocked(false);
					} else if (word && word !== 'ready') {
						this.helperSaid?.(word);
					}
				}
			});
			helper.on('exit', () => {
				if (this.helper === helper) {
					this.helper = undefined;
					this.helperSaid?.('');
				}
			});
		}
		const helper = this.helper;
		return new Promise(resolve => {
			const timer = setTimeout(() => done(''), 30000);
			const done = (word: string) => {
				clearTimeout(timer);
				if (this.helperSaid === done) {
					this.helperSaid = undefined;
				}
				resolve(word);
			};
			this.helperSaid = done;
			helper.stdin?.write(`${order}\n`);
		});
	}

	/** A picture of the project, opened in the application. */
	private async openPicture(): Promise<void> {
		const root = this.root();
		if (!root) {
			return;
		}
		const files = await vscode.workspace.findFiles('**/*.{png,jpg,jpeg,webp,gif,bmp,tif,tiff,psd,psb,avif}', '**/{node_modules,.git,dist,build,out,.next,.orbit}/**', 400);
		const items = files.map(uri => path.relative(root, uri.fsPath).split(path.sep).join('/')).filter(file => !file.startsWith('..')).sort();
		const pick = await vscode.window.showQuickPick(items, { title: this.app.name, placeHolder: 'Image du projet à ouvrir' });
		if (pick) {
			const opened = await this.call('app.open', { path: pick });
			if (opened.ok === false) {
				vscode.window.showErrorMessage(`${this.app.name} : ${opened.error ?? 'ouverture impossible'}`);
			}
		}
	}
}
