/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { PLAYER_SCRIPT, STARTER_SCRIPT, projectSettings } from './templates';

const BRIDGE = 'com.orbit.bridge';

/** Built-in engine modules every Unity version since 2021 ships: a game needs physics, audio, UI… */
const MODULES = [
	'ai', 'androidjni', 'animation', 'assetbundle', 'audio', 'cloth', 'director', 'imageconversion', 'imgui', 'jsonserialize',
	'particlesystem', 'physics', 'physics2d', 'screencapture', 'terrain', 'terrainphysics', 'tilemap', 'ui', 'uielements', 'umbra',
	'unitywebrequest', 'unitywebrequestassetbundle', 'unitywebrequestaudio', 'unitywebrequesttexture', 'unitywebrequestwww',
	'vehicles', 'video', 'vr', 'wind', 'xr',
];

export interface UnityEditor {
	version: string;
	/** The editor executable. */
	path: string;
}

/** A Unity project has ProjectSettings/ProjectVersion.txt next to its Assets folder. */
export function isUnityProject(root: string | undefined): root is string {
	return !!root && fs.existsSync(path.join(root, 'ProjectSettings', 'ProjectVersion.txt')) && fs.existsSync(path.join(root, 'Assets'));
}

export function projectVersion(root: string): string | undefined {
	try {
		return fs.readFileSync(path.join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8').match(/m_EditorVersion:\s*(\S+)/)?.[1];
	} catch {
		return undefined;
	}
}

function hubData(): string {
	return process.platform === 'win32'
		? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'UnityHub')
		: process.platform === 'darwin'
			? path.join(os.homedir(), 'Library', 'Application Support', 'UnityHub')
			: path.join(os.homedir(), '.config', 'UnityHub');
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return undefined;
	}
}

function editorExecutable(versionDir: string): string {
	return process.platform === 'win32'
		? path.join(versionDir, 'Editor', 'Unity.exe')
		: process.platform === 'darwin'
			? path.join(versionDir, 'Unity.app', 'Contents', 'MacOS', 'Unity')
			: path.join(versionDir, 'Editor', 'Unity');
}

/** Every Unity editor on this machine, newest first. */
export function findEditors(): UnityEditor[] {
	const found = new Map<string, UnityEditor>();
	const add = (version: string | undefined, file: string) => {
		if (version && fs.existsSync(file) && !found.has(version)) {
			found.set(version, { version, path: file });
		}
	};

	const custom = vscode.workspace.getConfiguration('novagame').get<string>('unityPath')?.trim();
	if (custom && fs.existsSync(custom)) {
		add(path.basename(path.dirname(path.dirname(custom))).match(/^\d+\.\d+\.\S+$/)?.[0] ?? 'personnalisé', custom);
	}

	// Folders that hold one sub-folder per version, the way Unity Hub lays them out.
	const roots: string[] = [];
	const secondary = readJson(path.join(hubData(), 'secondaryInstallPath.json'));
	if (typeof secondary === 'string' && secondary) {
		roots.push(secondary);
	}
	if (process.platform === 'win32') {
		for (const drive of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
			if (drive) {
				roots.push(path.join(drive, 'Unity', 'Hub', 'Editor'));
			}
		}
	} else if (process.platform === 'darwin') {
		roots.push('/Applications/Unity/Hub/Editor');
	} else {
		roots.push(path.join(os.homedir(), 'Unity', 'Hub', 'Editor'));
	}
	for (const root of roots) {
		let names: string[] = [];
		try {
			names = fs.readdirSync(root);
		} catch {
			continue;
		}
		for (const name of names) {
			add(name, editorExecutable(path.join(root, name)));
		}
	}

	// Editors added to the Hub from elsewhere ("Locate").
	const located = readJson(path.join(hubData(), 'editors-v2.json')) as { data?: { version?: string; location?: string[] }[] } | undefined;
	for (const entry of located?.data ?? []) {
		for (const file of entry.location ?? []) {
			add(entry.version, file);
		}
	}

	return [...found.values()].sort((a, b) => compareVersions(b.version, a.version));
}

function compareVersions(a: string, b: string): number {
	const parts = (v: string) => (v.match(/\d+/g) ?? []).map(Number);
	const [x, y] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d) {
			return d;
		}
	}
	return 0;
}

/** Unity Hub's executable, when the Hub is installed. */
export function findHub(): string | undefined {
	const candidates = process.platform === 'win32'
		? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter((d): d is string => !!d).map(d => path.join(d, 'Unity Hub', 'Unity Hub.exe'))
		: process.platform === 'darwin'
			? ['/Applications/Unity Hub.app']
			: ['/opt/unityhub/unityhub', '/usr/bin/unityhub'];
	return candidates.find(c => fs.existsSync(c));
}

/** The projects Unity Hub knows about. */
export function hubProjects(): string[] {
	const out: string[] = [];
	for (const name of ['projects-v1.json', 'projectDir.json']) {
		const json = readJson(path.join(hubData(), name)) as { data?: Record<string, { path?: string }> } | undefined;
		for (const entry of Object.values(json?.data ?? {})) {
			if (typeof entry?.path === 'string' && isUnityProject(entry.path)) {
				out.push(path.normalize(entry.path));
			}
		}
	}
	return out;
}

/** Starts the Hub's installer, in a terminal the user can watch, or sends them to the download page. */
export function installHub(): void {
	if (process.platform === 'win32') {
		const terminal = vscode.window.createTerminal({ name: 'Installation de Unity Hub', shellPath: 'powershell.exe' });
		terminal.show(true);
		terminal.sendText('winget install -e --id Unity.UnityHub --accept-source-agreements --accept-package-agreements', true);
	} else if (process.platform === 'darwin') {
		const terminal = vscode.window.createTerminal({ name: 'Installation de Unity Hub' });
		terminal.show(true);
		terminal.sendText('brew install --cask unity-hub || open https://unity.com/download', true);
	} else {
		vscode.env.openExternal(vscode.Uri.parse('https://unity.com/download'));
	}
}

/** Opens the Hub: that is where an editor version gets installed. */
export function openHub(hub: string): void {
	if (process.platform === 'darwin') {
		spawn('open', [hub], { detached: true, stdio: 'ignore' }).unref();
	} else {
		spawn(hub, [], { detached: true, stdio: 'ignore' }).unref();
	}
}

/** True while a Unity editor has this project open. */
export function unityIsOpen(root: string): boolean {
	const bridge = readJson(path.join(root, 'Library', 'OrbitBridge.json')) as { pid?: number } | undefined;
	if (typeof bridge?.pid === 'number') {
		try {
			process.kill(bridge.pid, 0);
			return true;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'EPERM') {
				return true;
			}
		}
	}
	// Unity keeps this file locked while the project is open; a leftover one can be removed.
	const lock = path.join(root, 'Temp', 'UnityLockfile');
	if (!fs.existsSync(lock)) {
		return false;
	}
	try {
		fs.closeSync(fs.openSync(lock, 'r+'));
		return false;
	} catch {
		return true;
	}
}

export function launchEditor(editor: UnityEditor, root: string): void {
	spawn(editor.path, ['-projectPath', root], { detached: true, stdio: 'ignore' }).unref();
}

/** Orbit's bridge package: what lets the game studio and Claude see and drive the editor. */
export async function installBridge(root: string): Promise<boolean> {
	const orbit = vscode.extensions.getExtension('vscode.orbit')?.extensionPath;
	const source = orbit && path.join(orbit, 'unity', BRIDGE);
	if (!source || !fs.existsSync(source)) {
		return false;
	}
	const target = path.join(root, 'Packages', BRIDGE);
	const current = readJson(path.join(target, 'package.json')) as { version?: string } | undefined;
	const shipped = readJson(path.join(source, 'package.json')) as { version?: string } | undefined;
	if (current?.version && current.version === shipped?.version) {
		return true;
	}
	await fs.promises.cp(source, target, { recursive: true, force: true, filter: file => !file.endsWith('.meta') });
	return true;
}

/**
 * Writes a Unity project by hand: the folders and the three files Unity needs to recognise it.
 * Unity generates everything else the first time it opens the project, so nothing heavy runs here.
 */
export async function createProject(root: string, editor: UnityEditor, kind: 'sandbox' | 'game'): Promise<void> {
	const name = path.basename(root);
	await fs.promises.mkdir(path.join(root, 'Assets', 'Scripts'), { recursive: true });
	await fs.promises.mkdir(path.join(root, 'Assets', 'Scenes'), { recursive: true });
	await fs.promises.mkdir(path.join(root, 'ProjectSettings'), { recursive: true });
	await fs.promises.mkdir(path.join(root, 'Packages'), { recursive: true });
	await fs.promises.writeFile(path.join(root, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${editor.version}\n`);

	await fs.promises.writeFile(path.join(root, 'ProjectSettings', 'ProjectSettings.asset'), projectSettings(kind === 'sandbox' ? 'Bac à sable' : name));

	// The Input System is what lets you play from Orbit: the game then takes keys and mouse from the game studio.
	const unity6 = compareVersions(editor.version, '6000.0') >= 0;
	const dependencies: Record<string, string> = { 'com.unity.inputsystem': unity6 ? '1.11.2' : '1.7.0', 'com.unity.ugui': unity6 ? '2.0.0' : '1.0.0' };
	for (const module of MODULES) {
		dependencies[`com.unity.modules.${module}`] = '1.0.0';
	}
	await fs.promises.writeFile(path.join(root, 'Packages', 'manifest.json'), JSON.stringify({ dependencies }, null, 2) + '\n');

	await fs.promises.writeFile(path.join(root, '.gitignore'), ['/[Ll]ibrary/', '/[Tt]emp/', '/[Oo]bj/', '/[Bb]uild/', '/[Bb]uilds/', '/[Ll]ogs/', '/[Uu]ser[Ss]ettings/', '*.csproj', '*.sln', '*.user', '.vs/', ''].join('\n'));
	const intro = kind === 'sandbox'
		? `# Bac à sable NovaGame\n\nCe projet Unity est le bac à sable de NovaGame (Orbit) : un terrain d'essai, rien n'y est précieux. Tu peux tout y créer, casser et recommencer.`
		: `# ${name}\n\nJeu Unity créé avec NovaGame (Orbit).`;
	await fs.promises.writeFile(path.join(root, 'CLAUDE.md'), `${intro}

- Version de Unity : ${editor.version}, rendu intégré (pas d'URP), modules du moteur activés dans \`Packages/manifest.json\`.
- Les entrées passent par le paquet Input System (\`Keyboard.current\`, \`Mouse.current\`, actions) : c'est ce qui permet de jouer depuis Orbit. N'utilise jamais l'ancienne classe \`Input\`.
- Les scripts C# vont dans \`Assets/Scripts\`, les scènes dans \`Assets/Scenes\`.
- Tu vois et pilotes l'éditeur avec les outils \`orbit-unity\` : hiérarchie, création d'objets, composants, capture de la vue du jeu, console, lecture.
- Après avoir écrit un script, appelle \`unity_refresh\` puis vérifie \`unity_console\` ; regarde le résultat avec \`unity_screenshot\`.
`);
	if (kind === 'sandbox') {
		// A scene to play in right away: Unity builds it the first time it opens the project.
		await fs.promises.mkdir(path.join(root, 'Assets', 'Editor'), { recursive: true });
		await fs.promises.writeFile(path.join(root, 'Assets', 'Scripts', 'NovaPlayer.cs'), PLAYER_SCRIPT);
		await fs.promises.writeFile(path.join(root, 'Assets', 'Editor', 'NovaGameStarter.cs'), STARTER_SCRIPT);
	}
	await installBridge(root);
}
