/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { workspaceRoot } from './config';
import { Page } from './page';
import { Store } from './store';

const HISTORY_KEY = 'orbit.figma.links';
const LINK = /^https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto|board|make)\/[\w-]+/;

interface Past {
	url: string;
	name: string;
	at: number;
}

/** What the project is built with, read from its package.json: the agent builds the screen with the same. */
function stack(root: string): string[] {
	let deps: Record<string, string> = {};
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
		deps = { ...pkg.dependencies, ...pkg.devDependencies };
	} catch {
		return fs.existsSync(path.join(root, 'index.html')) ? ['HTML et CSS'] : [];
	}
	const has = (name: string) => name in deps;
	return [
		has('next') ? 'Next.js' : has('nuxt') ? 'Nuxt' : has('@sveltejs/kit') ? 'SvelteKit' : has('astro') ? 'Astro' : has('expo') ? 'Expo' : has('react-native') ? 'React Native' : '',
		has('react') ? 'React' : has('vue') ? 'Vue' : has('svelte') ? 'Svelte' : has('@angular/core') ? 'Angular' : has('solid-js') ? 'Solid' : '',
		has('tailwindcss') ? 'Tailwind CSS' : has('styled-components') ? 'styled-components' : has('sass') ? 'Sass' : '',
		has('typescript') ? 'TypeScript' : '',
		has('@radix-ui/react-slot') || has('class-variance-authority') ? 'shadcn/ui' : has('@mui/material') ? 'MUI' : has('@chakra-ui/react') ? 'Chakra UI' : '',
		has('framer-motion') || has('motion') ? 'Motion' : '',
	].filter(Boolean);
}

/**
 * Figma to code: the user pastes the link of a frame, the agent reads the design through Figma's
 * own connector (structure, styles, variables, a picture of the frame) and builds the screen with
 * what the project already uses. Orbit never reads the Figma account itself.
 */
export class Figma extends Page {

	constructor(context: vscode.ExtensionContext, private readonly store: Store, private readonly tellAgent: (message: string) => boolean) {
		super(context, 'figma', 'Figma vers code', 'figma.svg');
		this.disposables.push(vscode.commands.registerCommand('orbit.figma.show', () => this.show()));
	}

	private past(): Past[] {
		return this.context.workspaceState.get<Past[]>(HISTORY_KEY, []);
	}

	protected send(): void {
		const root = workspaceRoot();
		this.post({ type: 'state', project: path.basename(root), stack: stack(root), connected: this.connected, working: this.working, past: this.past().slice(0, 8) });
	}

	private connected: boolean | undefined;
	private working: string | undefined;

	protected override async refresh(): Promise<void> {
		this.send();
		await this.store.loadInstalled();
		this.connected = this.store.has('figma');
		this.send();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'connect': {
				const connector = this.store.connector('figma');
				if (connector) {
					this.working = 'Figma : valide la connexion dans le navigateur…';
					this.send();
					await this.store.install(connector);
					this.working = undefined;
					await this.refresh();
				}
				break;
			}
			case 'recheck':
				this.connected = undefined;
				await this.refresh();
				break;
			case 'build': {
				const url = String(msg.url ?? '').trim();
				if (!LINK.test(url)) {
					this.post({ type: 'toast', text: 'Ce n\'est pas un lien Figma : copie-le depuis Figma avec « Copy link to selection ».' });
					break;
				}
				const root = workspaceRoot();
				const built = stack(root);
				const kind = msg.kind === 'component' ? 'un composant réutilisable' : msg.kind === 'section' ? 'une section de page' : 'un écran complet';
				const message = [
					`Construis ${kind} à partir de cette maquette Figma : ${url}`,
					'',
					'Méthode :',
					'1. Lis la maquette avec les outils Figma (contexte du design, variables, et une capture de la sélection). Si le lien pointe sur un grand cadre, traite-le section par section.',
					built.length ? `2. Écris le code avec ce que le projet utilise déjà : ${built.join(', ')}. Réutilise les composants, les couleurs et les espacements existants du projet avant d'en créer de nouveaux.` : '2. Regarde d\'abord comment le projet est construit, et écris le code avec les mêmes outils et les mêmes conventions.',
					'3. Respecte la maquette au pixel : tailles, espacements, polices, couleurs, arrondis, ombres. Les images et icônes de la maquette sont à récupérer depuis Figma, pas à remplacer par des substituts.',
					msg.responsive !== false ? '4. La maquette montre une seule taille : rends le résultat propre aussi sur téléphone et sur grand écran.' : '',
					'5. Ouvre le résultat dans la vue vivante d\'Orbit et compare-le à la capture de la maquette. Corrige les écarts avant de me rendre la main.',
					String(msg.note ?? '').trim() ? `\nPrécisions : ${String(msg.note).trim()}` : '',
				].filter(line => line !== '').join('\n');
				if (this.tellAgent(message)) {
					const name = decodeURIComponent(url.match(/figma\.com\/\w+\/[\w-]+\/([^?/]+)/)?.[1] ?? 'Maquette').replace(/-/g, ' ');
					await this.context.workspaceState.update(HISTORY_KEY, [{ url, name, at: Date.now() }, ...this.past().filter(p => p.url !== url)].slice(0, 12));
					this.post({ type: 'sent' });
					this.send();
				}
				break;
			}
			case 'open':
				if (/^https:\/\//.test(String(msg.url))) {
					vscode.env.openExternal(vscode.Uri.parse(String(msg.url), true));
				}
				break;
		}
	}
}
