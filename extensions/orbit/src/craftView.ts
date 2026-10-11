/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { CraftApp, craftGui, craftIcon, craftPort, craftTokenFile } from './craft';
import { Page } from './page';

/** Where the application's window is kept while Orbit shows it: far to the left of every screen. */
const AWAY = -20000;

/**
 * Moves the application's window: away from the screens (it keeps drawing there, which a
 * minimized window does not) and out of the taskbar, or back in front of the user.
 */
const PLACE = `
param([int]$ProcessId, [string]$Name, [string]$Where)
Add-Type @"
using System; using System.Runtime.InteropServices;
public class OrbitWindow {
	[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
	[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
	[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int index, int value);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$window = [IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $window -eq [IntPtr]::Zero; $i++) {
	$process = if ($ProcessId) { Get-Process -Id $ProcessId -ErrorAction SilentlyContinue } else { Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1 }
	if (-not $process) { exit 1 }
	$window = $process.MainWindowHandle
	if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($window -eq [IntPtr]::Zero) { exit 1 }
$style = [OrbitWindow]::GetWindowLong($window, -20)
[void][OrbitWindow]::ShowWindow($window, 0)
if ($Where -eq 'away') {
	[void][OrbitWindow]::SetWindowLong($window, -20, ($style -bor 0x80) -band (-bnot 0x40000))
	[void][OrbitWindow]::SetWindowPos($window, [IntPtr]::Zero, ${AWAY}, 80, 0, 0, 0x0001 -bor 0x0004 -bor 0x0010)
	[void][OrbitWindow]::ShowWindow($window, 4)
} else {
	[void][OrbitWindow]::SetWindowLong($window, -20, ($style -band (-bnot 0x80)) -bor 0x40000)
	[void][OrbitWindow]::SetWindowPos($window, [IntPtr]::Zero, 120, 90, 1440, 900, 0x0004)
	[void][OrbitWindow]::ShowWindow($window, 5)
	[void][OrbitWindow]::SetForegroundWindow($window)
}
'ok'`;

/**
 * A Crafting App shown inside Orbit. The real application runs with its control channel, its
 * window kept away from the screens; this page shows what it draws, twice a second, and sends
 * it clicks and keys. The agents of the project drive that same running application (their
 * `<app>_live` tools, see `craft.ts`), so the user watches them work, here.
 *
 * It is a view of a window, not the window: no dragging (painting, sliders), no wheel. The
 * application's own window is one button away for that.
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

	constructor(context: vscode.ExtensionContext, private readonly app: CraftApp, private readonly root: () => string | undefined) {
		super(context, 'craft', app.name);
		this.disposables.push(vscode.commands.registerCommand(`orbit.craft.show.${app.id}`, () => this.show()));
	}

	override dispose(): void {
		// The application may hold unsaved work: it is handed back to the user, never killed.
		this.place('front');
		this.socket?.destroy();
		super.dispose();
	}

	/** The page is closed: the application comes back in front of the user, who may have work to save. */
	protected override closed(): void {
		if (this.state === 'live') {
			this.place('front');
		}
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
					await this.call('ui.resize', this.size);
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
			while (this.visible && this.state === 'live' && this.socket) {
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

	private place(where: 'away' | 'front'): Promise<void> {
		// An application found already running was not started here: it is looked up by its name.
		const pid = this.process?.pid ?? 0;
		if (process.platform !== 'win32' || (!pid && !this.socket)) {
			return Promise.resolve();
		}
		return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& { ${PLACE} } -ProcessId ${pid} -Name ${this.app.id} -Where ${where}`], { windowsHide: true, timeout: 30000 }, () => resolve()));
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
