// Met à jour une extension d'Orbit dans la version installée, sans la construction complète :
// empaquette l'extension (esbuild), puis copie le résultat, ses fichiers et son manifeste.
// Usage : node scripts/orbit-extension-update.mjs [orbit] [starcapture] [novagame]
// Orbit peut rester ouvert ; redémarrer Orbit pour charger la mise à jour.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(import.meta.dirname, '..');
// ORBIT_TARGET points at another copy of Orbit, e.g. a build waiting to be installed (..VSCode-win32-x64).
const installed = path.join(process.env.ORBIT_TARGET ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Orbit'), 'resources', 'app', 'extensions');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['orbit', 'starcapture', 'novagame'];
// Folders an extension ships besides its bundle.
const FOLDERS = ['media', 'control', 'team', 'unity', 'mcp', 'themes', 'icons'];

for (const name of names) {
	const source = path.join(repo, 'extensions', name);
	const target = path.join(installed, name);
	if (!fs.existsSync(target)) {
		console.log(`${name} : absente de l'installation, laissée de côté`);
		continue;
	}
	const built = spawnSync(process.execPath, [path.join(source, 'esbuild.mts')], { cwd: source, stdio: 'inherit' });
	if (built.status !== 0) {
		throw new Error(`${name} : l'empaquetage a échoué`);
	}
	fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
	for (const folder of FOLDERS) {
		if (fs.existsSync(path.join(source, folder)) && fs.existsSync(path.join(target, folder))) {
			fs.cpSync(path.join(source, folder), path.join(target, folder), { recursive: true });
		}
	}
	// The installed manifest starts the bundle, not the development output.
	const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
	manifest.main = './dist/extension';
	fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest));
	console.log(`${name} : mise à jour`);
}

// Orbit keeps what it read of the built-in manifests (commands, editors, settings) in a cache and
// starts from it: a new contribution, such as an editor for a new kind of file, stayed unknown
// after a reload. Without the cache, the next reload reads the manifests again.
if (!process.env.ORBIT_TARGET) {
	const profiles = path.join(process.env.APPDATA ?? '', 'Orbit', 'CachedProfilesData');
	for (const profile of fs.existsSync(profiles) ? fs.readdirSync(profiles) : []) {
		fs.rmSync(path.join(profiles, profile, 'extensions.builtin.cache'), { force: true });
	}
}
