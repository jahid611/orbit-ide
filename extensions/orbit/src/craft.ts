/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * The Crafting Apps (ArtCraft: PhotoCraft and its siblings), open-source creative tools that
 * an agent can drive: each ships a command-line program whose `mcp` mode exposes every command
 * of the application. Orbit does not contain them. It fetches the official build from the
 * project's own releases on GitHub, checks it, keeps it under `~/.orbit/tools`, and hands its
 * tools to the agents of a project, limited to that project's folder.
 */
export interface CraftApp {
	id: string;
	name: string;
	/** `owner/name` of the official repository on GitHub. */
	repo: string;
	/** The command-line program, without extension. */
	cli: string;
}

export const CRAFT_APPS: CraftApp[] = [
	{ id: 'photocraft', name: 'PhotoCraft', repo: 'storytold/photocraft', cli: 'photocraft-cli' },
];

const TOOLS = path.join(os.homedir(), '.orbit', 'tools');
const WINDOWS = process.platform === 'win32';

export function craftApp(id: string): CraftApp | undefined {
	return CRAFT_APPS.find(app => app.id === id);
}

/** The program Orbit installed (the newest version), or one found on the PATH. */
export function findCraft(app: CraftApp): string | undefined {
	const name = WINDOWS ? `${app.cli}.exe` : app.cli;
	const home = path.join(TOOLS, app.id);
	try {
		const versions = fs.readdirSync(home).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
		for (const version of versions) {
			const found = locate(path.join(home, version), name, 3);
			if (found) {
				return found;
			}
		}
	} catch {
		// nothing installed by Orbit
	}
	for (const dir of (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter)) {
		if (dir && fs.existsSync(path.join(dir, name))) {
			return path.join(dir, name);
		}
	}
	return undefined;
}

function locate(dir: string, name: string, depth: number): string | undefined {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return undefined;
	}
	if (entries.some(entry => entry.isFile() && entry.name === name)) {
		return path.join(dir, name);
	}
	for (const entry of entries) {
		const found = depth > 0 && entry.isDirectory() ? locate(path.join(dir, entry.name), name, depth - 1) : undefined;
		if (found) {
			return found;
		}
	}
	return undefined;
}

/**
 * The MCP configurations of the installed apps for an agent started in a folder. Each app may
 * only read and write under that folder: it is the authority its `mcp` mode is given.
 */
export function craftMcpConfigs(cwd: string | undefined): string[] {
	if (!cwd) {
		return [];
	}
	const files: string[] = [];
	for (const app of CRAFT_APPS) {
		const program = findCraft(app);
		if (!program) {
			continue;
		}
		const file = path.join(os.homedir(), '.orbit', 'mcp', `${app.id}-${createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 10)}.json`);
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			// Two servers: the application without a window, always there, and the one shown in
			// Orbit (`<app>_live`), which answers only while its page is open.
			const servers: Record<string, { command: string; args: string[] }> = { [app.id]: { command: program, args: ['mcp', '--automation-read-root', cwd, '--automation-write-root', cwd] } };
			if (craftGui(app)) {
				servers[`${app.id}_live`] = { command: program, args: ['mcp', '--bridge', `127.0.0.1:${craftPort(cwd)}`, '--control-token-file', craftTokenFile(app, cwd)] };
			}
			fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, undefined, '\t'));
			files.push(file);
		} catch {
			// the agent starts without this app
		}
	}
	return files;
}

/** The archive of a release that holds the command-line program for this machine. */
function assetFor(app: CraftApp, version: string): string | undefined {
	const arch = process.arch;
	if (WINDOWS) {
		return arch === 'x64' || arch === 'arm64' ? `${app.id}-${version}-windows-${arch}-portable.zip` : arch === 'ia32' ? `${app.id}-${version}-windows-x86-portable.zip` : undefined;
	}
	if (process.platform === 'darwin') {
		return `${app.cli}-${version}-macos-universal.zip`;
	}
	if (process.platform === 'linux') {
		return arch === 'x64' ? `${app.id}-${version}-linux-x86_64.tar.gz` : arch === 'arm64' ? `${app.id}-${version}-linux-aarch64.tar.gz` : undefined;
	}
	return undefined;
}

/**
 * Fetches the latest official release, checks it against the checksums published with it (and,
 * on Windows, that the program is signed), and unpacks it under `~/.orbit/tools`. Returns the
 * version installed. Throws with a message for the user when anything does not add up.
 */
export async function installCraft(app: CraftApp, say: (step: string) => void): Promise<string> {
	say(`${app.name} : recherche de la dernière version…`);
	const headers = { 'accept': 'application/vnd.github+json', 'user-agent': 'Orbit' };
	const answer = await fetch(`https://api.github.com/repos/${app.repo}/releases/latest`, { headers, signal: AbortSignal.timeout(30000) });
	if (!answer.ok) {
		throw new Error(answer.status === 403 ? 'GitHub limite les demandes pour l\'instant : réessaie dans quelques minutes.' : `GitHub a répondu ${answer.status}.`);
	}
	const release = await answer.json() as { tag_name: string; assets: { name: string; browser_download_url: string; size: number }[] };
	const version = release.tag_name.replace(/^v/, '');
	const wanted = assetFor(app, version);
	const asset = release.assets.find(a => a.name === wanted);
	const sums = release.assets.find(a => a.name === 'SHA256SUMS.txt');
	if (!asset || !sums) {
		throw new Error(`La version ${version} n'a pas de programme pour cette machine (${process.platform} ${process.arch}).`);
	}
	const target = path.join(TOOLS, app.id, version);
	await fs.promises.rm(target, { recursive: true, force: true });
	await fs.promises.mkdir(target, { recursive: true });
	const archive = path.join(target, asset.name);
	try {
		say(`${app.name} ${version} : téléchargement (${Math.round(asset.size / 1048576)} Mo)…`);
		const [body, list] = await Promise.all([
			fetch(asset.browser_download_url, { headers: { 'user-agent': 'Orbit' }, signal: AbortSignal.timeout(15 * 60 * 1000) }).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Téléchargement refusé (${r.status}).`))),
			fetch(sums.browser_download_url, { headers: { 'user-agent': 'Orbit' }, signal: AbortSignal.timeout(60000) }).then(r => r.ok ? r.text() : Promise.reject(new Error(`Empreintes introuvables (${r.status}).`))),
		]);
		say(`${app.name} ${version} : vérification…`);
		const data = Buffer.from(body);
		const expected = list.split(/\r?\n/).map(line => /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())).find(match => match?.[2] === asset.name)?.[1];
		if (!expected || createHash('sha256').update(data).digest('hex') !== expected.toLowerCase()) {
			throw new Error('Le fichier téléchargé ne correspond pas à l\'empreinte publiée par le projet : rien n\'a été installé.');
		}
		await fs.promises.writeFile(archive, data);
		// The system's own `tar` reads zip archives on Windows 10 and later, and on macOS. On
		// Windows another `tar` (the one of Git) is often first on the PATH, and cannot.
		const tar = WINDOWS ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
		await execFileAsync(tar, ['-xf', archive, '-C', target], { timeout: 5 * 60 * 1000, windowsHide: true });
		await fs.promises.rm(archive, { force: true });
		const program = locate(target, WINDOWS ? `${app.cli}.exe` : app.cli, 3);
		if (!program) {
			throw new Error('L\'archive ne contient pas le programme attendu.');
		}
		if (WINDOWS) {
			const signed = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${program.replace(/'/g, `''`)}').Status`], { timeout: 60000, windowsHide: true }).then(r => r.stdout.trim(), () => '');
			if (signed !== 'Valid') {
				throw new Error('Le programme téléchargé n\'est pas signé par son éditeur : rien n\'a été installé.');
			}
		} else {
			await fs.promises.chmod(program, 0o755);
		}
		// Older versions installed by Orbit make room for this one.
		for (const other of await fs.promises.readdir(path.join(TOOLS, app.id))) {
			if (other !== version) {
				await fs.promises.rm(path.join(TOOLS, app.id, other), { recursive: true, force: true });
			}
		}
		ensureCraftIcon(app);
		await writeCraftGuide(app).catch(() => undefined);
		return version;
	} catch (err) {
		await fs.promises.rm(target, { recursive: true, force: true });
		throw err;
	}
}

/** The application's window program, where it comes with what Orbit installed (the Windows archive). */
export function craftGui(app: CraftApp): string | undefined {
	const cli = findCraft(app);
	const program = cli && path.join(path.dirname(cli), WINDOWS ? `${app.id}.exe` : app.id);
	return program && fs.existsSync(program) ? program : undefined;
}

/** The port of the application's control channel for a project: always the same, so agents find it. */
export function craftPort(cwd: string): number {
	return 45500 + parseInt(createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 6), 16) % 400;
}

/** Where the application keeps the secret of that channel (it writes the file itself). */
export function craftTokenFile(app: CraftApp, cwd: string): string {
	return path.join(TOOLS, `${app.id}-control-${createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 10)}.token`);
}

/** The application's own icon, kept beside what Orbit installed (fetched once from its repository). */
export function craftIcon(app: CraftApp): string | undefined {
	const file = path.join(TOOLS, `${app.id}.png`);
	return fs.existsSync(file) ? file : undefined;
}

export function ensureCraftIcon(app: CraftApp): void {
	if (craftIcon(app) || !findCraft(app)) {
		return;
	}
	fetch(`https://raw.githubusercontent.com/${app.repo}/HEAD/assets/app-icon/hicolor/128x128/apps/ai.storyteller.${app.id}.png`, { signal: AbortSignal.timeout(30000) })
		.then(answer => answer.ok ? answer.arrayBuffer() : undefined)
		.then(data => data && fs.promises.writeFile(path.join(TOOLS, `${app.id}.png`), Buffer.from(data)))
		.catch(() => undefined);
}

/**
 * Opens the application itself, on a picture when one is given. Only where its window comes
 * with what Orbit installed (the Windows archive): elsewhere the command-line program is alone.
 */
export function openCraft(app: CraftApp, file?: string): boolean {
	const cli = findCraft(app);
	const program = cli && path.join(path.dirname(cli), WINDOWS ? `${app.id}.exe` : app.id);
	if (!program || !fs.existsSync(program)) {
		return false;
	}
	spawn(program, file ? [file] : [], { detached: true, stdio: 'ignore' }).unref();
	return true;
}

const LOCAL_GUIDE = path.join(os.homedir(), '.orbit', 'guide');

/**
 * Everything the installed application can do, for the agents' manual. The program lists its
 * own commands (`commands --json`: id, label, menu, parameters), so the pages describe exactly
 * the version on this machine: one map of every command, then one page per family with the
 * parameters, short enough to be read in one go. The project's own list of what it cannot do
 * yet comes with it. Written once per version.
 */
export async function writeCraftGuide(app: CraftApp): Promise<void> {
	const cli = findCraft(app);
	if (!cli) {
		return;
	}
	const dir = path.join(LOCAL_GUIDE, app.id);
	// « photocraft-cli 0.7.0 (792616159, 2026-10-11) »: only the number is kept.
	const said = await execFileAsync(cli, ['--version'], { timeout: 20000, windowsHide: true }).then(r => r.stdout, () => '');
	const version = /\d+\.\d+\.\d+/.exec(said)?.[0] ?? /\d+\.\d+\.\d+/.exec(cli)?.[0] ?? '';
	const stamp = path.join(dir, '.version');
	if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === `${cli}\n${version}`) {
		return;
	}
	const listed = await execFileAsync(cli, ['commands', '--json'], { timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
	const parsed = JSON.parse(listed.stdout);
	const commands: { id: string; label?: string; menu?: string[]; params?: string; shortcut?: string | null }[] = Array.isArray(parsed) ? parsed : parsed.commands;
	const families = new Map<string, typeof commands>();
	for (const command of commands) {
		const family = command.id.split('.')[0];
		families.set(family, [...families.get(family) ?? [], command]);
	}
	await fs.promises.rm(dir, { recursive: true, force: true });
	await fs.promises.mkdir(dir, { recursive: true });
	const head = (title: string, description: string) => `---\ntitle: ${title}\ndescription: ${description}\n---\n\n`;
	const names = [...families.keys()].sort((a, b) => families.get(b)!.length - families.get(a)!.length);
	const map = [
		head(`${app.name} : toutes les commandes`, `La carte complète des ${commands.length} commandes de ${app.name} ${version}, par famille. À lire avant de s'en servir.`),
		`Voici **toutes** les commandes de ${app.name} ${version} installé sur cette machine : ${commands.length}, tirées du programme lui-même. Rien d'autre n'existe. Si une action n'est pas ici, ${app.name} ne sait pas la faire : passe par un autre moyen et dis-le.`,
		'',
		`Les paramètres de chaque commande sont dans la page de sa famille : \`guide page="${app.id}/commandes-<famille>"\` (par exemple \`${app.id}/commandes-${names[0]}\`). Les limites connues du logiciel : \`${app.id}/limites\`. Le mode d'emploi et les recettes : \`outils/${app.id}\`.`,
		'',
		...names.flatMap(family => [`## ${family} (${families.get(family)!.length})`, '', families.get(family)!.map(c => c.id).join(' · '), '']),
	].join('\n');
	await fs.promises.writeFile(path.join(dir, 'commandes.md'), map);
	for (const family of names) {
		const lines = families.get(family)!.map(c => `- \`${c.id}\`${c.label ? ` — ${c.label}` : ''}${c.menu?.length ? ` (${c.menu.join(' › ')})` : ''}${c.params && c.params !== '{}' ? `\n  ${c.params}` : ''}`);
		// A family too long for one reading is cut in parts.
		const parts: string[][] = [[]];
		let size = 0;
		for (const line of lines) {
			if (size + line.length > 42000) {
				parts.push([]);
				size = 0;
			}
			parts[parts.length - 1].push(line);
			size += line.length;
		}
		for (const [index, part] of parts.entries()) {
			const suffix = parts.length > 1 ? `-${index + 1}` : '';
			const more = parts.length > 1 ? ` Partie ${index + 1} sur ${parts.length} (les autres : ${parts.map((_, i) => `\`${app.id}/commandes-${family}-${i + 1}\``).join(', ')}).` : '';
			await fs.promises.writeFile(path.join(dir, `commandes-${family}${suffix}.md`), [
				head(`${app.name} : commandes ${family}${suffix}`, `Les commandes « ${family} » de ${app.name} ${version}, avec leurs paramètres.`),
				`Commandes « ${family} » de ${app.name} ${version}, avec leur libellé, leur menu et leurs paramètres (\`nom: valeurs possibles = valeur par défaut\`). À lancer avec \`command_run {"id": …, "params": {…}}\`.${more}`,
				'',
				...part,
				'',
			].join('\n'));
		}
	}
	// What the project itself says its software cannot do yet.
	const gaps = await fetch(`https://raw.githubusercontent.com/${app.repo}/v${version}/docs/gaps.md`, { signal: AbortSignal.timeout(30000) }).then(r => r.ok ? r.text() : '', () => '');
	if (gaps) {
		await fs.promises.writeFile(path.join(dir, 'limites.md'), `${head(`${app.name} : ce qu'il ne sait pas encore faire`, `La liste que le projet ${app.name} tient lui-même de ses manques (en anglais), version ${version}.`)}${gaps.slice(0, 60000)}\n`);
	}
	await fs.promises.writeFile(stamp, `${cli}\n${version}`);
}

/** Removes what Orbit installed of an app. A copy the user installed elsewhere is not touched. */
export async function removeCraft(app: CraftApp): Promise<void> {
	await fs.promises.rm(path.join(TOOLS, app.id), { recursive: true, force: true });
	await fs.promises.rm(path.join(LOCAL_GUIDE, app.id), { recursive: true, force: true });
}
