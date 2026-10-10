/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { workspaceRoot } from './config';
import { storeProjectSecrets } from './envVars';
import { Page, requestJson } from './page';

const API = 'https://api.supabase.com/v1';
const TOKEN_KEY = 'orbit.supabase.token';
const LINK_KEY = 'orbit.supabase.project';
const REGIONS: [string, string][] = [['eu-west-3', 'Paris'], ['eu-central-1', 'Francfort'], ['eu-west-2', 'Londres'], ['us-east-1', 'Virginie'], ['us-west-1', 'Californie'], ['ap-southeast-1', 'Singapour'], ['ap-northeast-1', 'Tokyo'], ['sa-east-1', 'São Paulo']];

interface Project {
	ref: string;
	name: string;
	region: string;
	status: string;
	organization: string;
	createdAt: string;
}

interface Table {
	name: string;
	rows: number;
	rls: boolean;
	columns: { name: string; type: string }[];
}

interface Overview {
	tables: Table[];
	users?: number;
	buckets?: number;
	error?: string;
}

/** The prefix a framework wants on the variables its browser code may read. */
function publicPrefix(root: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
		const deps = { ...pkg.dependencies, ...pkg.devDependencies };
		return 'next' in deps ? 'NEXT_PUBLIC_' : 'vite' in deps ? 'VITE_' : 'nuxt' in deps ? 'NUXT_PUBLIC_' : 'expo' in deps ? 'EXPO_PUBLIC_' : '@sveltejs/kit' in deps ? 'PUBLIC_' : '';
	} catch {
		return '';
	}
}

/**
 * Supabase: database, user accounts and storage for the project, linked in one click. Orbit talks
 * to Supabase's management API with an access token the user creates in their Supabase account;
 * it is kept in the system keychain (SecretStorage) and never shown to the agent. Linking a
 * project writes its address and public key into `.env.local`; the agent is given the schema and
 * the names of those variables, never a key.
 */
export class Supabase extends Page {

	private token: string | undefined;
	private projects: Project[] | undefined;
	private organizations: { id: string; name: string }[] = [];
	private overview: Overview | undefined;
	private working: string | undefined;
	private error: string | undefined;
	private result: { sql: string; rows?: unknown[]; error?: string } | undefined;

	constructor(context: vscode.ExtensionContext, private readonly tellAgent: (message: string) => boolean) {
		super(context, 'supabase', 'Supabase', 'supabase.svg');
		this.disposables.push(
			vscode.commands.registerCommand('orbit.supabase.show', () => this.show()),
			vscode.commands.registerCommand('orbit.supabase.dashboard', () => {
				const ref = this.linked();
				if (!ref) {
					vscode.window.showInformationMessage('Ce projet ne dit pas quel Supabase il utilise : relie-le depuis la page Supabase d\'Orbit.', 'Ouvrir la page').then(choice => choice && this.show());
				}
				return vscode.env.openExternal(vscode.Uri.parse(ref ? `https://supabase.com/dashboard/project/${ref}` : 'https://supabase.com/dashboard'));
			}),
		);
	}

	/** The project's Supabase: the one linked from this page, else the one the project itself names. */
	private linked(): string | undefined {
		return this.context.workspaceState.get<string>(LINK_KEY) ?? this.detected();
	}

	private found: { root: string; ref: string | undefined } | undefined;

	/**
	 * A project that already uses Supabase says which one somewhere: the Supabase tool's own files,
	 * an address `https://<ref>.supabase.co` in a `.env`, in the code or in its notes. Read once per
	 * folder, so that the page opens on the right project without asking.
	 */
	private detected(): string | undefined {
		const root = workspaceRoot();
		if (!root) {
			return undefined;
		}
		if (this.found?.root === root) {
			return this.found.ref;
		}
		const read = (file: string) => {
			try {
				return fs.statSync(file).size < 400_000 ? fs.readFileSync(file, 'utf8') : '';
			} catch {
				return '';
			}
		};
		let ref: string | undefined = /^[a-z0-9]{20}$/.exec(read(path.join(root, 'supabase', '.temp', 'project-ref')).trim())?.[0];
		if (!ref) {
			// Counted over the files most likely to hold it: the address used most is the project's.
			const counts = new Map<string, number>();
			const scan = (folder: string, depth: number) => {
				let entries: fs.Dirent[];
				try {
					entries = fs.readdirSync(folder, { withFileTypes: true }).slice(0, 400);
				} catch {
					return;
				}
				for (const entry of entries) {
					const file = path.join(folder, entry.name);
					if (entry.isDirectory()) {
						if (depth < 3 && !/^(node_modules|dist|build|out|\.git|\.next|android|ios|coverage|public|assets)$/.test(entry.name)) {
							scan(file, depth + 1);
						}
					} else if (/^\.env|\.(ts|tsx|js|jsx|mjs|json|toml|md|ya?ml|sql|py|vue|svelte)$/.test(entry.name) && !/lock/.test(entry.name)) {
						// A `.env` counts for more than a note: it is what the application really uses.
						const weight = entry.name.startsWith('.env') || entry.name === 'config.toml' ? 5 : 1;
						for (const match of read(file).matchAll(/\b([a-z0-9]{20})\.supabase\.(?:co|in)\b/g)) {
							counts.set(match[1], (counts.get(match[1]) ?? 0) + weight);
						}
					}
				}
			};
			scan(root, 0);
			ref = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
		}
		this.found = { root, ref };
		return ref;
	}

	private call(method: string, route: string, body?: unknown) {
		return requestJson(method, `${API}${route}`, { 'authorization': `Bearer ${this.token}`, 'content-type': 'application/json', 'accept': 'application/json' }, body === undefined ? undefined : JSON.stringify(body));
	}

	private async sql(ref: string, query: string): Promise<{ rows?: Record<string, unknown>[]; error?: string }> {
		const answer = await this.call('POST', `/projects/${ref}/database/query`, { query });
		return answer.ok && Array.isArray(answer.json) ? { rows: answer.json as Record<string, unknown>[] } : { error: answer.error ?? 'Supabase a refusé la requête.' };
	}

	protected send(): void {
		const ref = this.linked();
		const root = workspaceRoot();
		this.post({
			type: 'state',
			project: path.basename(root),
			connected: !!this.token,
			projects: this.projects,
			organizations: this.organizations,
			regions: REGIONS,
			linked: ref,
			overview: this.overview,
			working: this.working,
			error: this.error,
			result: this.result,
			prefix: publicPrefix(root),
		});
	}

	protected override async refresh(): Promise<void> {
		this.token ??= await this.context.secrets.get(TOKEN_KEY);
		this.send();
		if (!this.token) {
			return;
		}
		const [projects, organizations] = await Promise.all([this.call('GET', '/projects'), this.call('GET', '/organizations')]);
		if (projects.status === 401) {
			this.error = 'Supabase refuse ce jeton (expiré ou retiré). Connecte-toi à nouveau.';
			this.token = undefined;
			await this.context.secrets.delete(TOKEN_KEY);
			this.send();
			return;
		}
		if (!projects.ok || !Array.isArray(projects.json)) {
			this.error = `Supabase ne répond pas : ${projects.error ?? 'réessaie dans un instant.'}`;
			this.send();
			return;
		}
		this.error = undefined;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.projects = projects.json.map((p: any) => ({ ref: String(p.id ?? p.ref), name: String(p.name), region: String(p.region ?? ''), status: String(p.status ?? ''), organization: String(p.organization_id ?? ''), createdAt: String(p.created_at ?? '') }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.organizations = Array.isArray(organizations.json) ? organizations.json.map((o: any) => ({ id: String(o.id), name: String(o.name) })) : [];
		this.send();
		const ref = this.linked();
		if (ref && this.projects.some(p => p.ref === ref)) {
			await this.loadOverview(ref);
		}
	}

	/** What the linked project holds: its tables (and whether each is protected), accounts, storage. */
	private async loadOverview(ref: string): Promise<void> {
		const [tables, columns, counts] = await Promise.all([
			this.sql(ref, `select c.relname as name, greatest(c.reltuples, 0)::bigint as rows, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by c.relname`),
			this.sql(ref, `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`),
			this.sql(ref, `select (select count(*) from auth.users) as users, (select count(*) from storage.buckets) as buckets`),
		]);
		if (!tables.rows) {
			this.overview = { tables: [], error: tables.error };
		} else {
			this.overview = {
				tables: tables.rows.map(t => ({
					name: String(t.name),
					rows: Number(t.rows) || 0,
					rls: !!t.rls,
					columns: (columns.rows ?? []).filter(c => c.table_name === t.name).map(c => ({ name: String(c.column_name), type: String(c.data_type) })),
				})),
				users: counts.rows ? Number(counts.rows[0]?.users) : undefined,
				buckets: counts.rows ? Number(counts.rows[0]?.buckets) : undefined,
			};
		}
		this.send();
	}

	private async link(ref: string): Promise<void> {
		this.working = 'Liaison du projet…';
		this.send();
		const keys = await this.call('GET', `/projects/${ref}/api-keys`);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const list: any[] = Array.isArray(keys.json) ? keys.json : [];
		const anon = list.find(k => k.name === 'anon' || k.type === 'publishable')?.api_key;
		this.working = undefined;
		if (typeof anon !== 'string') {
			this.error = `Impossible de lire les clés du projet : ${keys.error ?? 'il démarre peut-être encore, réessaie dans une minute.'}`;
			this.send();
			return;
		}
		const root = workspaceRoot();
		const prefix = publicPrefix(root);
		// The public key is made to be shipped to browsers; the secret one is only written on request.
		const file = storeProjectSecrets(root, { [`${prefix}SUPABASE_URL`]: `https://${ref}.supabase.co`, [`${prefix}SUPABASE_ANON_KEY`]: anon });
		await this.context.workspaceState.update(LINK_KEY, ref);
		this.error = undefined;
		this.overview = undefined;
		this.result = undefined;
		this.post({ type: 'toast', text: `Projet relié : adresse et clé publique écrites dans ${file}` });
		this.send();
		await this.loadOverview(ref);
	}

	/** The linked project, ready for an agent's tool; says what is missing otherwise. */
	private async forAgent(): Promise<string> {
		this.token ??= await this.context.secrets.get(TOKEN_KEY);
		if (!this.token) {
			vscode.commands.executeCommand('orbit.supabase.show');
			throw new Error('Orbit n\'est pas connecté à Supabase. La page Supabase vient de s\'ouvrir : demande à l\'utilisateur de s\'y connecter, puis réessaie.');
		}
		const ref = this.linked();
		if (!ref) {
			vscode.commands.executeCommand('orbit.supabase.show');
			throw new Error('Ce projet n\'est relié à aucun projet Supabase. La page Supabase vient de s\'ouvrir : demande à l\'utilisateur d\'en relier un, puis réessaie.');
		}
		return ref;
	}

	/** `supabase_state`: which project, its tables, accounts and storage. Never a key. */
	async agentState(): Promise<unknown> {
		const ref = await this.forAgent();
		await this.loadOverview(ref);
		return { project: ref, dashboard: `https://supabase.com/dashboard/project/${ref}`, tables: this.overview?.tables, users: this.overview?.users, buckets: this.overview?.buckets, error: this.overview?.error };
	}

	/**
	 * `supabase_sql`: a query that only reads runs at once, in a read-only transaction. Anything
	 * that writes is shown to the user first: a live database has no undo.
	 */
	async agentSql(query: string, file: string | undefined, write: boolean): Promise<unknown> {
		const ref = await this.forAgent();
		if (file) {
			query = await fs.promises.readFile(file, 'utf8');
		}
		query = query.trim();
		if (!query) {
			throw new Error('Il faut une requête (query) ou un fichier .sql (file).');
		}
		if (write) {
			const lines = query.split(/\r?\n/);
			const shown = lines.slice(0, 28).join('\n').slice(0, 1800) + (lines.length > 28 || query.length > 1800 ? `\n… (${lines.length} lignes en tout)` : '');
			const choice = await vscode.window.showWarningMessage(
				file ? `L'agent veut exécuter ${path.basename(file)} sur ta base Supabase` : 'L\'agent veut modifier ta base Supabase',
				{ modal: true, detail: `Projet ${ref}. Rien ne peut être annulé ensuite.\n\n${shown}` },
				...(file ? ['Exécuter', 'Lire le fichier'] : ['Exécuter']),
			);
			if (choice === 'Lire le fichier' && file) {
				await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
				throw new Error('L\'utilisateur relit le fichier avant de décider : rien n\'a été exécuté. Attends qu\'il te dise de relancer.');
			}
			if (choice !== 'Exécuter') {
				throw new Error('L\'utilisateur a refusé : rien n\'a été exécuté. Ne réessaie pas sans qu\'il le demande.');
			}
		}
		const answer = await this.call('POST', `/projects/${ref}/database/query`, write ? { query } : { query, read_only: true });
		if (!answer.ok || !Array.isArray(answer.json)) {
			throw new Error(`Supabase a refusé la requête : ${answer.error ?? 'réponse inattendue'}${write ? '' : ' (lecture seule : passe write=true pour une requête qui modifie la base)'}`);
		}
		if (write) {
			this.loadOverview(ref).then(() => this.send(), () => undefined);
		}
		const rows = answer.json as Record<string, unknown>[];
		return { ok: true, count: rows.length, rows: rows.slice(0, 200), truncated: rows.length > 200 || undefined };
	}

	/** `supabase_auth_urls`: the addresses sign-in links may send people back to, and adding some. */
	async agentAuthUrls(add: string[]): Promise<unknown> {
		const ref = await this.forAgent();
		const current = await this.call('GET', `/projects/${ref}/config/auth`);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const config = current.json as any;
		if (!current.ok || !config) {
			throw new Error(`Supabase ne donne pas les réglages de connexion : ${current.error ?? 'réponse inattendue'}`);
		}
		const allowed = String(config.uri_allow_list ?? '').split(',').map(u => u.trim()).filter(Boolean);
		const wanted = add.map(u => u.trim()).filter(u => /^[a-z][a-z0-9+.-]*:\/\/[^\s,<>]+$/i.test(u) && !allowed.includes(u));
		if (!wanted.length) {
			return { siteUrl: config.site_url, redirectUrls: allowed, note: add.length ? 'Rien à ajouter : ces adresses y sont déjà, ou ne sont pas des adresses complètes.' : undefined };
		}
		const choice = await vscode.window.showWarningMessage('L\'agent veut ajouter des adresses de redirection à Supabase', { modal: true, detail: `Projet ${ref}. Les liens de connexion et de mot de passe oublié pourront renvoyer vers :\n\n${wanted.join('\n')}` }, 'Ajouter');
		if (choice !== 'Ajouter') {
			throw new Error('L\'utilisateur a refusé : rien n\'a été changé.');
		}
		const next = [...allowed, ...wanted];
		const saved = await this.call('PATCH', `/projects/${ref}/config/auth`, { uri_allow_list: next.join(',') });
		if (!saved.ok) {
			throw new Error(`Supabase a refusé : ${saved.error ?? 'réponse inattendue'}`);
		}
		return { ok: true, siteUrl: config.site_url, redirectUrls: next };
	}

	private schemaText(): string {
		return (this.overview?.tables ?? []).map(t => `- ${t.name} (${t.columns.map(c => `${c.name} ${c.type}`).join(', ')})${t.rls ? '' : ' — sans protection RLS'}`).join('\n') || '(aucune table pour l\'instant)';
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		const ref = this.linked();
		switch (msg.type) {
			case 'refresh':
				await this.refresh();
				break;
			case 'tokenPage':
				vscode.env.openExternal(vscode.Uri.parse('https://supabase.com/dashboard/account/tokens'));
				break;
			case 'connect': {
				const token = String(msg.token ?? '').trim();
				if (!/^sbp_[\w-]{20,}$/.test(token)) {
					this.error = 'Ce n\'est pas un jeton d\'accès Supabase : il commence par « sbp_ ».';
					this.send();
					break;
				}
				this.token = token;
				const check = await this.call('GET', '/projects');
				if (!check.ok) {
					this.token = undefined;
					this.error = check.status === 401 ? 'Supabase refuse ce jeton.' : `Supabase ne répond pas : ${check.error}`;
					this.send();
					break;
				}
				await this.context.secrets.store(TOKEN_KEY, token);
				this.error = undefined;
				await this.refresh();
				break;
			}
			case 'logout': {
				if (await vscode.window.showWarningMessage('Se déconnecter de Supabase ?', { modal: true, detail: 'Le jeton d\'accès est retiré d\'Orbit. Tes projets Supabase et les clés déjà écrites dans .env.local ne sont pas touchés.' }, 'Me déconnecter')) {
					await this.context.secrets.delete(TOKEN_KEY);
					this.token = undefined;
					this.projects = undefined;
					this.overview = undefined;
					this.send();
				}
				break;
			}
			case 'link':
				if (/^[a-z0-9]{10,40}$/.test(String(msg.ref))) {
					await this.link(String(msg.ref));
				}
				break;
			case 'unlink':
				await this.context.workspaceState.update(LINK_KEY, undefined);
				this.overview = undefined;
				this.result = undefined;
				this.send();
				break;
			case 'create': {
				const name = String(msg.name ?? '').trim();
				const organization = String(msg.organization ?? '');
				const region = REGIONS.some(r => r[0] === msg.region) ? String(msg.region) : 'eu-west-3';
				if (!name || !organization) {
					break;
				}
				if (await vscode.window.showInformationMessage(`Créer le projet Supabase « ${name} » ?`, { modal: true, detail: 'Un projet est créé sur ton compte Supabase (il compte dans les projets de ton offre). Le mot de passe de sa base est généré et rangé dans .env.local.' }, 'Créer') !== 'Créer') {
					break;
				}
				const password = randomBytes(18).toString('base64url');
				this.working = 'Création du projet (une à deux minutes)…';
				this.send();
				const created = await this.call('POST', '/projects', { name, organization_id: organization, region, db_pass: password });
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const made = created.json as any;
				if (!created.ok || !made?.id) {
					this.working = undefined;
					this.error = `Supabase a refusé la création : ${created.error ?? 'raison inconnue.'}`;
					this.send();
					break;
				}
				storeProjectSecrets(workspaceRoot(), { SUPABASE_DB_PASSWORD: password });
				// A new project takes a moment to start: its keys are not readable before.
				const newRef = String(made.id);
				for (let attempt = 0; attempt < 40; attempt++) {
					await new Promise(resolve => setTimeout(resolve, 5000));
					const state = await this.call('GET', `/projects/${newRef}`);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					if ((state.json as any)?.status === 'ACTIVE_HEALTHY') {
						break;
					}
				}
				this.working = undefined;
				await this.link(newRef);
				await this.refresh();
				break;
			}
			case 'secret': {
				if (!ref) {
					break;
				}
				if (await vscode.window.showWarningMessage('Écrire la clé secrète dans .env.local ?', { modal: true, detail: 'La clé « service_role » contourne toutes les protections de la base. Elle ne doit servir que côté serveur, jamais dans une page ni dans le dépôt. Orbit l\'écrit dans .env.local, qui reste hors de git.' }, 'Écrire') !== 'Écrire') {
					break;
				}
				const keys = await this.call('GET', `/projects/${ref}/api-keys?reveal=true`);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const secret = (Array.isArray(keys.json) ? keys.json : []).find((k: any) => k.name === 'service_role' || k.type === 'secret')?.api_key;
				if (typeof secret === 'string') {
					storeProjectSecrets(workspaceRoot(), { SUPABASE_SERVICE_ROLE_KEY: secret });
					this.post({ type: 'toast', text: 'SUPABASE_SERVICE_ROLE_KEY écrite dans .env.local' });
				} else {
					this.post({ type: 'toast', text: 'Clé secrète illisible avec ce jeton' });
				}
				break;
			}
			case 'run': {
				const query = String(msg.sql ?? '').trim();
				if (!ref || !query) {
					break;
				}
				// Anything that is not a plain read is confirmed: it changes the user's real data.
				if (!/^\s*(select|with|explain|show)\b/i.test(query) || /\b(insert|update|delete|drop|alter|truncate|create|grant)\b/i.test(query)) {
					if (await vscode.window.showWarningMessage('Exécuter cette requête sur la base Supabase ?', { modal: true, detail: `${query.slice(0, 600)}\n\nElle modifie la base réelle du projet.` }, 'Exécuter') !== 'Exécuter') {
						break;
					}
				}
				this.working = 'Requête en cours…';
				this.send();
				const answer = await this.sql(ref, query);
				this.working = undefined;
				this.result = { sql: query, rows: answer.rows?.slice(0, 200), error: answer.error };
				this.send();
				if (!answer.error && !/^\s*(select|with|explain|show)\b/i.test(query)) {
					await this.loadOverview(ref);
				}
				break;
			}
			case 'protect': {
				const table = String(msg.table ?? '');
				if (ref && /^[A-Za-z_][\w]*$/.test(table) && await vscode.window.showWarningMessage(`Activer la protection RLS sur « ${table} » ?`, { modal: true, detail: 'Sans règle d\'accès, plus personne ne pourra lire ni écrire cette table depuis une page avec la clé publique. C\'est le bon réglage par défaut : demande ensuite à ton agent d\'écrire les règles dont l\'app a besoin.' }, 'Activer') === 'Activer') {
					const answer = await this.sql(ref, `alter table public."${table}" enable row level security`);
					this.post({ type: 'toast', text: answer.error ? `Refusé : ${answer.error}` : `« ${table} » est protégée` });
					await this.loadOverview(ref);
				}
				break;
			}
			case 'agent': {
				if (!ref) {
					break;
				}
				const prefix = publicPrefix(workspaceRoot());
				const ask = String(msg.ask ?? '').trim();
				this.tellAgent([
					`Le projet est relié à Supabase (projet ${ref}).`,
					`Les variables sont dans .env.local : ${prefix}SUPABASE_URL et ${prefix}SUPABASE_ANON_KEY (ne lis pas ce fichier, utilise ces noms dans le code).`,
					'Tables actuelles du schéma public :',
					this.schemaText(),
					'',
					ask || 'Branche Supabase dans le projet : installe la bibliothèque cliente, crée le client à un seul endroit, et montre-moi comment lire une table. Pour lire la base, créer ou modifier des tables, sers-toi de tes outils supabase_state, supabase_sql et supabase_auth_urls : ne me demande pas de le faire à la main.',
					'Toute table lue depuis le navigateur doit avoir la protection RLS activée, avec des règles d\'accès.',
				].join('\n'));
				break;
			}
			case 'env':
				await vscode.commands.executeCommand('orbit.env.show');
				break;
			case 'open':
				if (/^https:\/\//.test(String(msg.url))) {
					vscode.env.openExternal(vscode.Uri.parse(String(msg.url), true));
				}
				break;
			case 'dashboard':
				vscode.env.openExternal(vscode.Uri.parse(ref ? `https://supabase.com/dashboard/project/${ref}${typeof msg.page === 'string' && /^[\w/-]+$/.test(msg.page) ? `/${msg.page}` : ''}` : 'https://supabase.com/dashboard'));
				break;
		}
	}
}
