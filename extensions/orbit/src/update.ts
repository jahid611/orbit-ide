/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

/** Where Orbit's releases are published. */
const RELEASES = 'https://api.github.com/repos/jahid611/orbit-ide/releases/latest';
const RELEASES_PAGE = 'https://github.com/jahid611/orbit-ide/releases/latest';
const SIX_HOURS = 6 * 60 * 60 * 1000;

interface Release {
	tag_name: string;
	html_url: string;
	body?: string;
	assets: { name: string; browser_download_url: string; size: number }[];
}

/** The version of this Orbit, written in its `product.json` (`orbitVersion`). None when run from sources. */
export function orbitVersion(): string | undefined {
	if (process.env.VSCODE_DEV) {
		return undefined;
	}
	try {
		const version = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8')).orbitVersion;
		return typeof version === 'string' ? version : undefined;
	} catch {
		return undefined;
	}
}

/** 1.2.10 is newer than 1.2.9: numbers compared one by one, not as text. */
export function isNewer(candidate: string, current: string): boolean {
	const parts = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
	const a = parts(candidate);
	const b = parts(current);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) {
			return (a[i] ?? 0) > (b[i] ?? 0);
		}
	}
	return false;
}

/**
 * Updates. Orbit has no update server: its releases are on GitHub, and this looks there a little
 * after start, then every six hours. A newer one is announced once per version; on Windows
 * « Mettre à jour » downloads the installer, and it runs by itself as soon as Orbit is closed,
 * then opens Orbit again. On macOS and Linux the download page opens: an unsigned application
 * cannot replace itself there.
 */
export class Updater implements vscode.Disposable {

	private timer: NodeJS.Timeout | undefined;
	private readonly first: NodeJS.Timeout;
	private busy = false;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.first = setTimeout(() => this.check(false), 45_000);
		this.timer = setInterval(() => this.check(false), SIX_HOURS);
	}

	dispose(): void {
		clearTimeout(this.first);
		clearInterval(this.timer);
	}

	/** `asked`: the user ran the command, so every outcome is said; otherwise only a new version is. */
	async check(asked: boolean): Promise<void> {
		const current = orbitVersion();
		const mode = vscode.workspace.getConfiguration('orbit').get<string>('update.mode', 'notify');
		if (!current) {
			if (asked) {
				vscode.window.showInformationMessage('Cet Orbit est lancé depuis ses sources : il se met à jour avec git, pas par ici.');
			}
			return;
		}
		if ((!asked && mode === 'off') || this.busy) {
			return;
		}
		let release: Release;
		try {
			const answer = await fetch(RELEASES, { headers: { 'accept': 'application/vnd.github+json', 'user-agent': 'orbit-ide' }, signal: AbortSignal.timeout(15000) });
			if (!answer.ok) {
				throw new Error(`GitHub a répondu ${answer.status}`);
			}
			release = await answer.json() as Release;
		} catch (error) {
			if (asked) {
				vscode.window.showWarningMessage(`Impossible de vérifier les mises à jour : ${error instanceof Error ? error.message : String(error)}`);
			}
			return;
		}
		const latest = String(release.tag_name ?? '').replace(/^v/i, '');
		if (!latest || !isNewer(latest, current)) {
			if (asked) {
				vscode.window.showInformationMessage(`Orbit est à jour (version ${current}).`);
			}
			return;
		}
		// Announced once: « Plus tard » means until the next version, or until the user asks.
		if (!asked && this.context.globalState.get<string>('orbit.update.announced') === latest) {
			return;
		}
		this.context.globalState.update('orbit.update.announced', latest);
		const installer = process.platform === 'win32' ? release.assets.find(a => /^OrbitSetup-x64.*\.exe$/i.test(a.name)) : undefined;
		const choice = await vscode.window.showInformationMessage(`Orbit ${latest} est disponible (tu as la ${current}).`, installer ? 'Mettre à jour' : 'Télécharger', 'Voir les nouveautés', 'Plus tard');
		if (choice === 'Voir les nouveautés') {
			vscode.env.openExternal(vscode.Uri.parse(release.html_url || RELEASES_PAGE));
			this.context.globalState.update('orbit.update.announced', undefined);
		} else if (choice === 'Télécharger') {
			vscode.env.openExternal(vscode.Uri.parse(release.html_url || RELEASES_PAGE));
		} else if (choice === 'Mettre à jour' && installer) {
			await this.install(installer, latest);
		}
	}

	private async install(asset: Release['assets'][number], version: string): Promise<void> {
		this.busy = true;
		const file = path.join(os.tmpdir(), `OrbitSetup-${version}.exe`);
		try {
			await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Téléchargement d'Orbit ${version}`, cancellable: true }, async (progress, token) => {
				const abort = new AbortController();
				token.onCancellationRequested(() => abort.abort());
				const answer = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'orbit-ide' }, signal: abort.signal });
				if (!answer.ok || !answer.body) {
					throw new Error(`le téléchargement a répondu ${answer.status}`);
				}
				const total = Number(answer.headers.get('content-length')) || asset.size || 0;
				const out = fs.createWriteStream(`${file}.part`);
				let received = 0;
				let said = 0;
				try {
					for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) {
						received += chunk.length;
						if (!out.write(chunk)) {
							await new Promise<void>(resolve => out.once('drain', () => resolve()));
						}
						const percent = total ? Math.floor(received / total * 100) : 0;
						if (percent > said) {
							progress.report({ increment: percent - said, message: `${percent} %` });
							said = percent;
						}
					}
				} finally {
					await new Promise<void>(resolve => out.end(() => resolve()));
				}
				if (total && received !== total) {
					throw new Error('le fichier reçu est incomplet');
				}
				fs.rmSync(file, { force: true });
				fs.renameSync(`${file}.part`, file);
			});
		} catch (error) {
			fs.rmSync(`${file}.part`, { force: true });
			this.busy = false;
			if (!(error instanceof Error && error.name === 'AbortError')) {
				vscode.window.showErrorMessage(`La mise à jour n'a pas pu être téléchargée : ${error instanceof Error ? error.message : String(error)}`, 'Ouvrir la page').then(choice => choice && vscode.env.openExternal(vscode.Uri.parse(RELEASES_PAGE)));
			}
			return;
		}
		// The installer cannot replace an Orbit that runs. A small watcher waits for every window of
		// this Orbit to be closed, then installs without a question and opens Orbit again.
		const exe = process.execPath;
		const wait = [
			`$exe = '${exe.replace(/'/g, `''`)}'`,
			`$setup = '${file.replace(/'/g, `''`)}'`,
			`for ($i = 0; $i -lt 43200; $i++) { if (-not (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) { break }; Start-Sleep -Seconds 2 }`,
			`Start-Sleep -Seconds 2`,
			`Start-Process -FilePath $setup -ArgumentList '/VERYSILENT','/NORESTART','/MERGETASKS=runcode,!desktopicon,!quicklaunchicon'`,
		].join('; ');
		spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', wait], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
		this.busy = false;
		const choice = await vscode.window.showInformationMessage(`Orbit ${version} est prêt : il s'installera dès qu'Orbit sera fermé, puis se rouvrira. Les agents en cours s'arrêtent à la fermeture.`, { modal: true }, 'Fermer Orbit et installer');
		if (choice) {
			vscode.commands.executeCommand('workbench.action.quit');
		}
	}
}
