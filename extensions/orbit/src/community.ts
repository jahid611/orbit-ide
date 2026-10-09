/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ClaudeTerminals } from './claudeTerminals';
import { readConfig, workspaceRoot } from './config';
import { detectServers } from './livePreview';
import { renderWebview, webviewOptions } from './webview';

const execFileAsync = promisify(execFile);

/** GitHub topic that marks a repository as an Orbit community template. */
export const TOPIC = 'orbit-ide-template';
const META = '.orbit/template.json';
const COVER = '.orbit/cover.png';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SCAN_BYTES = 1024 * 1024;

const SKIP_DIRS = new Set(['node_modules', '.git', '.orbit', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage', '.venv', 'venv', '__pycache__', 'target', 'Library', 'Temp', 'Logs', 'obj', '.idea', '.vs']);
/** Never shared, whatever the project's ignore rules say. */
const PRIVATE_FILES: [RegExp, string][] = [
	[/(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[^/]*)?$/i, 'variables d\'environnement (remplacées par un .env.example vide)'],
	[/\.(pem|key|p12|pfx|keystore|jks|ppk|crt|cer|der|asc|gpg)$/i, 'clé ou certificat'],
	[/(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)[^/]*$/i, 'clé SSH'],
	[/(^|\/)(credentials|service[-_]?account|client[-_]?secret)[^/]*\.json$/i, 'identifiants'],
	[/(^|\/)(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|\.dockercfg)$/i, 'fichier d\'identifiants'],
	[/(^|\/)[^/]*secret[^/]*$/i, 'fichier nommé « secret »'],
	[/\.(db|sqlite|sqlite3|db3)$/i, 'données de base (seule sa structure est partagée)'],
	[/\.(log)$/i, 'journal'],
	[/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i, 'fichier système'],
];
const SECRET_PATTERNS: [RegExp, string][] = [
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
	[/\bAKIA[0-9A-Z]{16}\b/, 'clé AWS'],
	[/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'jeton GitHub'],
	[/\bsk-(ant-)?[A-Za-z0-9_-]{24,}\b/, 'clé d\'API (OpenAI / Anthropic)'],
	[/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, 'jeton Slack'],
	[/\bAIza[0-9A-Za-z_-]{35}\b/, 'clé Google'],
	[/\b[rs]k_live_[0-9A-Za-z]{16,}\b/, 'clé Stripe'],
	[/\b[a-z][a-z0-9+.-]*:\/\/[^:\s/'"@]+:[^@\s/'"]{3,}@[^\s'"]+/i, 'adresse avec mot de passe'],
	[/\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i, 'mot de passe ou jeton écrit en clair'],
];

interface Excluded { file: string; reason: string }
interface Secret { file: string; line: number; kind: string }

export interface ShareDraft {
	root: string;
	title: string;
	description: string;
	/** data: URL of the cover, for the preview. */
	cover?: string;
	coverFile?: string;
	/** Where the cover comes from: the address or file photographed, or the image picked. */
	coverSource?: string;
	files: string[];
	excluded: Excluded[];
	secrets: Secret[];
	envExamples: string[];
	schemas: string[];
	bytes: number;
}

interface Template {
	repo: string;
	url: string;
	owner: string;
	avatar: string;
	title: string;
	description: string;
	cover?: string;
	stars: number;
	language?: string;
	updated: string;
	mine: boolean;
}

/**
 * Community: share a project as a public template, and start a new project from someone else's.
 * Templates are plain public GitHub repositories tagged `orbit-ide-template`, so there is no
 * server to run: sharing creates a repository on the user's account, browsing searches GitHub.
 */
export class CommunityPanel implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private draft: ShareDraft | undefined;
	private login: string | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly extensionUri: vscode.Uri, private readonly claude: ClaudeTerminals) { }

	dispose(): void {
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	async show(tab: 'discover' | 'share' = 'discover'): Promise<void> {
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('orbit.community', 'Communauté', vscode.ViewColumn.Active, { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true });
			this.panel.iconPath = new vscode.ThemeIcon('organization');
			this.panel.webview.html = renderWebview(this.panel.webview, this.extensionUri, 'community');
			// Listeners of this panel only, freed with it so reopening does not pile them up.
			const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg).catch(err => this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) })));
			this.panel.onDidDispose(() => {
				listener.dispose();
				this.panel = undefined;
			});
		} else {
			this.panel.reveal();
		}
		this.post({ type: 'tab', tab });
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'ready':
				this.login = await githubLogin();
				this.post({ type: 'account', login: this.login, project: vscode.workspace.workspaceFolders?.length ? path.basename(workspaceRoot()) : undefined });
				await this.search('');
				break;
			case 'search':
				await this.search(String(msg.query ?? ''), !!msg.mine);
				break;
			case 'use':
				await this.useTemplate(String(msg.repo), String(msg.title ?? ''));
				break;
			case 'open':
				vscode.env.openExternal(vscode.Uri.parse(String(msg.url)));
				break;
			case 'prepare':
				await this.prepare();
				break;
			case 'pickCover': {
				const file = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: ['png', 'jpg', 'jpeg', 'webp'] }, openLabel: 'Utiliser comme couverture' });
				if (file?.[0] && this.draft) {
					this.setCover(file[0].fsPath);
				}
				break;
			}
			case 'captureCover':
				await this.captureCover();
				break;
			case 'publish':
				await this.publish(String(msg.title ?? ''), String(msg.description ?? ''));
				break;
		}
	}

	private post(message: object): void {
		this.panel?.webview.postMessage(message);
	}

	// --- discover

	private async search(query: string, mine = false): Promise<void> {
		this.post({ type: 'loading' });
		if (mine && !this.login) {
			this.post({ type: 'templates', templates: [], mine });
			return;
		}
		const q =[`topic:${TOPIC}`, query.trim(), mine && this.login ? `user:${this.login}` : ''].filter(Boolean).join(' ');
		const result = await githubApi<{ items: GithubRepo[] }>(`/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=40`);
		const templates = await Promise.all(result.items.map(async repo => {
			const raw = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}`;
			const meta = await getJson<{ title?: string; description?: string }>(`${raw}/${META}`).catch(() => undefined);
			return {
				repo: repo.full_name,
				url: repo.html_url,
				owner: repo.owner.login,
				avatar: repo.owner.avatar_url,
				title: meta?.title || repo.name,
				description: meta?.description || repo.description || '',
				cover: `${raw}/${COVER}`,
				stars: repo.stargazers_count,
				language: repo.language ?? undefined,
				updated: repo.pushed_at,
				mine: repo.owner.login === this.login,
			} satisfies Template;
		}));
		this.post({ type: 'templates', templates, mine });
	}

	private async useTemplate(repo: string, title: string): Promise<void> {
		const base = readConfig().projectsFolder;
		const name = await vscode.window.showInputBox({
			title: `Nouveau projet à partir de « ${title || repo} »`,
			prompt: `Une copie sera créée dans ${base}, puis Claude s'y lancera`,
			value: repo.split('/')[1],
			validateInput: v => !v.trim() ? 'Donne un nom au projet' : fs.existsSync(path.join(base, slug(v))) ? 'Ce dossier existe déjà' : undefined,
		});
		if (!name) {
			return;
		}
		const dir = path.join(base, slug(name));
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Copie de ${repo}…` }, async () => {
			await execFileAsync('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, dir]);
			// A fresh project of your own: no history, no link to the original.
			await fs.promises.rm(path.join(dir, '.git'), { recursive: true, force: true });
			await fs.promises.rm(path.join(dir, '.orbit'), { recursive: true, force: true });
			await execFileAsync('git', ['init', '-q'], { cwd: dir }).catch(() => undefined);
		});
		await this.claude.openProject(dir);
	}

	// --- share

	private async prepare(): Promise<void> {
		if (!vscode.workspace.workspaceFolders?.length) {
			throw new Error('Ouvre d\'abord le projet à partager.');
		}
		if (!this.login) {
			throw new Error('Connecte GitHub d\'abord : dans un terminal, lance « gh auth login ». Les templates sont des dépôts GitHub publics.');
		}
		this.post({ type: 'preparing' });
		const root = workspaceRoot();
		this.draft = await buildDraft(root);
		const existing = path.join(root, COVER);
		if (fs.existsSync(existing)) {
			this.setCover(existing, COVER);
		} else {
			await this.captureCover(true);
		}
		this.sendDraft();
	}

	private sendDraft(): void {
		const d = this.draft;
		if (!d) {
			return;
		}
		this.post({
			type: 'draft',
			title: d.title,
			description: d.description,
			cover: d.cover,
			fileCount: d.files.length,
			files: d.files.slice(0, 400),
			bytes: d.bytes,
			excluded: d.excluded.slice(0, 400),
			secrets: d.secrets.slice(0, 200),
			envExamples: d.envExamples,
			schemas: d.schemas,
			coverSource: d.coverSource,
			login: this.login,
			repoName: slug(d.title),
		});
	}

	/** `source` says where the image comes from, shown under it in the draft. */
	private setCover(file: string, source?: string): void {
		if (!this.draft) {
			return;
		}
		this.draft.coverFile = file;
		this.draft.coverSource = source ?? path.basename(file);
		const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg') || 'png';
		this.draft.cover = `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
		this.post({ type: 'cover', cover: this.draft.cover, source: this.draft.coverSource });
	}

	/** A screenshot of the project's home page: its running dev server, or its index.html. */
	private async captureCover(quiet = false): Promise<void> {
		const d = this.draft;
		if (!d) {
			return;
		}
		this.post({ type: 'capturing' });
		// A local server may belong to another project: only one proven to serve this one is photographed.
		let server: string | undefined;
		for (const { origin } of await detectServers()) {
			if (await servesProject(origin, d.root)) {
				server = origin;
				break;
			}
		}
		const page = ['index.html', 'public/index.html', 'dist/index.html', 'src/index.html', 'docs/index.html'].map(p => path.join(d.root, p)).find(p => fs.existsSync(p));
		const target = server ?? (page ? vscode.Uri.file(page).toString() : undefined);
		const out = path.join(os.tmpdir(), `orbit-cover-${Date.now()}.png`);
		if (target && await screenshot(target, out)) {
			this.setCover(out, server ?? path.relative(d.root, page!).replace(/\\/g, '/'));
			return;
		}
		// Nothing to photograph: a clean title card in Orbit's colours.
		const card = path.join(os.tmpdir(), `orbit-cover-${Date.now()}.html`);
		fs.writeFileSync(card, titleCard(d.title, d.description));
		if (await screenshot(vscode.Uri.file(card).toString(), out)) {
			this.setCover(out, 'carte titre');
		} else if (!quiet) {
			this.post({ type: 'error', message: 'Impossible de faire une capture (Edge ou Chrome introuvable). Choisis une image.' });
		}
	}

	private async publish(title: string, description: string): Promise<void> {
		const d = this.draft;
		if (!d || !this.login) {
			return;
		}
		d.title = title.trim() || d.title;
		d.description = description.trim();
		let name = slug(d.title);
		for (let i = 2; await repoExists(`${this.login}/${name}`); i++) {
			name = `${slug(d.title)}-${i}`;
		}
		const confirm = await vscode.window.showWarningMessage(
			`Publier « ${d.title} » en dépôt PUBLIC sur github.com/${this.login}/${name} ?`,
			{ modal: true, detail: `${d.files.length} fichiers seront visibles et copiables par tout le monde.\n${d.excluded.length} fichiers privés restent chez toi (${d.excluded.slice(0, 5).map(e => e.file).join(', ')}${d.excluded.length > 5 ? '…' : ''}).${d.secrets.length ? `\n${d.secrets.length} fichiers contenant un secret possible sont exclus.` : ''}` },
			'Publier publiquement');
		if (confirm !== 'Publier publiquement') {
			return;
		}
		const url = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Publication dans la communauté…' }, () => publishDraft(d, name, this.login!));
		this.post({ type: 'published', url });
		const choice = await vscode.window.showInformationMessage(`« ${d.title} » est dans la communauté Orbit.`, 'Voir sur GitHub');
		if (choice) {
			vscode.env.openExternal(vscode.Uri.parse(url));
		}
	}
}

// --- building what gets shared

async function buildDraft(root: string): Promise<ShareDraft> {
	const candidates = await listFiles(root);
	const files: string[] = [];
	const excluded: Excluded[] = [];
	const secrets: Secret[] = [];
	const envExamples: string[] = [];
	let bytes = 0;
	for (const file of candidates) {
		const full = path.join(root, file);
		const privacy = PRIVATE_FILES.find(([re]) => re.test(file));
		if (privacy) {
			excluded.push({ file, reason: privacy[1] });
			if (/(^|\/)\.env/i.test(file)) {
				envExamples.push(file);
			}
			continue;
		}
		let size = 0;
		try {
			size = fs.statSync(full).size;
		} catch {
			continue;
		}
		if (size > MAX_FILE_BYTES) {
			excluded.push({ file, reason: `trop lourd (${Math.round(size / 1024 / 1024)} Mo)` });
			continue;
		}
		const found = size <= SCAN_BYTES ? scanSecrets(full) : undefined;
		if (found) {
			secrets.push({ file, line: found.line, kind: found.kind });
			excluded.push({ file, reason: `${found.kind} (ligne ${found.line})` });
			continue;
		}
		files.push(file);
		bytes += size;
	}
	const schemas = candidates.filter(f => /\.(db|sqlite|sqlite3|db3)$/i.test(f) && isSqlite(path.join(root, f)));
	return { root, title: path.basename(root), description: readmeSummary(root), files, excluded, secrets, envExamples, schemas, bytes };
}

/** Files of the project: what git tracks or would track, else a walk that skips build output. */
async function listFiles(root: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
		const files = stdout.split('\0').filter(Boolean).map(f => f.replace(/\\/g, '/'));
		if (files.length) {
			return files.filter(f => !f.split('/').some(part => part === '.orbit' || part === 'node_modules'));
		}
	} catch {
		// not a git repository
	}
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) {
					walk(path.join(dir, entry.name));
				}
			} else if (entry.isFile() && out.length < 20000) {
				out.push(path.relative(root, path.join(dir, entry.name)).replace(/\\/g, '/'));
			}
		}
	};
	walk(root);
	return out;
}

function scanSecrets(file: string): { line: number; kind: string } | undefined {
	let text: string;
	try {
		const buffer = fs.readFileSync(file);
		if (buffer.includes(0)) {
			return undefined; // binary
		}
		text = buffer.toString('utf8');
	} catch {
		return undefined;
	}
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		for (const [re, kind] of SECRET_PATTERNS) {
			if (re.test(lines[i]) && !/example|exemple|your[_-]|changeme|xxxx|placeholder|<.*>|\$\{|process\.env|os\.environ/i.test(lines[i])) {
				return { line: i + 1, kind };
			}
		}
	}
	return undefined;
}

/** The first meaningful paragraph of the README, without Markdown. */
function readmeSummary(root: string): string {
	const file = ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'README'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
	if (!file) {
		return '';
	}
	const text = fs.readFileSync(file, 'utf8')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/```[\s\S]*?```/g, '')
		.split(/\r?\n\s*\r?\n/)
		.map(p => p.replace(/^#+\s.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`>#|]/g, '').replace(/\s+/g, ' ').trim())
		.filter(p => p.length > 30 && !/^(-|\d+\.)\s/.test(p));
	return (text.slice(0, 2).join('\n\n')).slice(0, 600);
}

function isSqlite(file: string): boolean {
	try {
		const fd = fs.openSync(file, 'r');
		const buffer = Buffer.alloc(16);
		fs.readSync(fd, buffer, 0, 16, 0);
		fs.closeSync(fd);
		return buffer.toString('latin1') === 'SQLite format 3\0';
	} catch {
		return false;
	}
}

async function publishDraft(d: ShareDraft, name: string, login: string): Promise<string> {
	const stage = path.join(os.tmpdir(), `orbit-share-${name}-${Date.now()}`);
	await fs.promises.mkdir(stage, { recursive: true });
	try {
		for (const file of d.files) {
			const target = path.join(stage, file);
			await fs.promises.mkdir(path.dirname(target), { recursive: true });
			await fs.promises.copyFile(path.join(d.root, file), target);
		}
		// Environment variables keep their names, never their values.
		for (const env of d.envExamples) {
			const example = env.replace(/\.env(\.[^/]*)?$/i, '.env.example');
			if (d.files.includes(example) || fs.existsSync(path.join(stage, example))) {
				continue;
			}
			const target = path.join(stage, example);
			await fs.promises.mkdir(path.dirname(target), { recursive: true });
			await fs.promises.writeFile(target, envNames(fs.readFileSync(path.join(d.root, env), 'utf8')));
			// Last check before it goes public: anything that still looks like a secret stays home.
			if (scanSecrets(target)) {
				await fs.promises.rm(target, { force: true });
			}
		}
		// Databases: their structure, never their rows.
		for (const db of d.schemas) {
			await fs.promises.mkdir(path.join(stage, 'database'), { recursive: true });
			await fs.promises.writeFile(path.join(stage, 'database', `${path.basename(db).replace(/\.[^.]+$/, '')}.schema.sql`), sqliteSchema(path.join(d.root, db)));
		}
		await fs.promises.mkdir(path.join(stage, '.orbit'), { recursive: true });
		await fs.promises.writeFile(path.join(stage, META), JSON.stringify({ title: d.title, description: d.description, createdWith: 'Orbit', createdAt: new Date().toISOString() }, null, 2));
		if (d.coverFile) {
			await fs.promises.copyFile(d.coverFile, path.join(stage, COVER));
		}
		if (!d.files.some(f => /^readme(\.md)?$/i.test(f))) {
			await fs.promises.writeFile(path.join(stage, 'README.md'), `# ${d.title}\n\n${d.description}\n\n_Partagé avec [Orbit](https://github.com/topics/${TOPIC})._\n`);
		}
		const { stdout: id } = await execFileAsync('gh', ['api', 'user', '--jq', '.id']);
		// Commits signed with GitHub's private address: the user's e-mail is never published.
		const identity = ['-c', `user.name=${login}`, '-c', `user.email=${id.trim()}+${login}@users.noreply.github.com`];
		await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: stage });
		await execFileAsync('git', ['add', '-A'], { cwd: stage });
		await execFileAsync('git', [...identity, 'commit', '-q', '-m', `${d.title} (template Orbit)`], { cwd: stage });
		await execFileAsync('gh', ['repo', 'create', name, '--public', '--source', stage, '--push', '--description', (d.description.split('\n')[0] || d.title).slice(0, 300)], { cwd: stage, maxBuffer: 16 * 1024 * 1024 });
		await execFileAsync('gh', ['repo', 'edit', `${login}/${name}`, '--add-topic', TOPIC]);
		return `https://github.com/${login}/${name}`;
	} finally {
		fs.promises.rm(stage, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * Only the variable names of a .env (`NAME=`), one per line: no value, no comment, and none of
 * the continuation lines of a multi-line quoted value (a private key…).
 */
function envNames(text: string): string {
	const names: string[] = [];
	const lines = text.split(/\r?\n/);
	const closes = (s: string, quote: string) => new RegExp(`(^|[^\\\\])${quote}`).test(s);
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!match) {
			continue; // comment, blank line, or stray text
		}
		names.push(`${match[1]}=`);
		const value = match[2];
		const quote = value[0];
		if ((quote === '"' || quote === '\'' || quote === '`') && !closes(value.slice(1), quote)) {
			// A multi-line value: skip until its closing quote.
			while (i + 1 < lines.length && !closes(lines[++i], quote)) {
				// continuation line
			}
		}
	}
	return names.length ? `${names.join('\n')}\n` : '';
}

/** Whether a local server serves this project: one of its public files comes back byte for byte. */
async function servesProject(origin: string, root: string): Promise<boolean> {
	const probes: string[] = [];
	for (const dir of ['public', 'static']) {
		try {
			for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
				if (entry.isFile() && probes.length < 6) {
					probes.push(`${dir}/${entry.name}`);
				}
			}
		} catch {
			// no such folder
		}
	}
	for (const probe of probes) {
		const local = path.join(root, probe);
		if (fs.statSync(local).size > SCAN_BYTES) {
			continue;
		}
		const served = await fetchBuffer(`${origin}/${encodeURIComponent(probe.split('/').pop()!)}`).catch(() => undefined);
		if (served?.equals(fs.readFileSync(local))) {
			return true;
		}
	}
	return false;
}

function fetchBuffer(url: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		http.get(url, { timeout: 2000 }, res => {
			const chunks: Buffer[] = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${res.statusCode}`)));
		}).on('error', reject).on('timeout', function (this: http.ClientRequest) { this.destroy(new Error('timeout')); });
	});
}

function sqliteSchema(file: string): string {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const db = new (require('node:sqlite').DatabaseSync)(file, { readOnly: true });
	try {
		const rows = db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC, name`).all() as { sql: string }[];
		return `-- Structure de ${path.basename(file)} (sans les données), exportée par Orbit\n\n${rows.map(r => `${r.sql};`).join('\n\n')}\n`;
	} finally {
		db.close();
	}
}

// --- helpers

interface GithubRepo {
	full_name: string;
	name: string;
	html_url: string;
	description: string | null;
	default_branch: string;
	stargazers_count: number;
	language: string | null;
	pushed_at: string;
	owner: { login: string; avatar_url: string };
}

let cachedToken: string | undefined;

async function githubToken(): Promise<string | undefined> {
	if (cachedToken !== undefined) {
		return cachedToken || undefined;
	}
	try {
		cachedToken = (await execFileAsync('gh', ['auth', 'token'])).stdout.trim();
	} catch {
		cachedToken = '';
	}
	return cachedToken || undefined;
}

async function githubLogin(): Promise<string | undefined> {
	try {
		return (await execFileAsync('gh', ['api', 'user', '--jq', '.login'])).stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function githubApi<T>(route: string): Promise<T> {
	const token = await githubToken();
	return getJson<T>(`https://api.github.com${route}`, token ? { authorization: `Bearer ${token}` } : {});
}

async function repoExists(fullName: string): Promise<boolean> {
	try {
		await githubApi(`/repos/${fullName}`);
		return true;
	} catch {
		return false;
	}
}

function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { 'user-agent': 'Orbit-IDE', accept: 'application/vnd.github+json', ...headers }, timeout: 15000 }, res => {
			let body = '';
			res.setEncoding('utf8');
			res.on('data', c => body += c);
			res.on('end', () => {
				if (res.statusCode && res.statusCode >= 400) {
					reject(new Error(res.statusCode === 403 ? 'GitHub limite les recherches : réessaie dans une minute, ou connecte-toi avec « gh auth login ».' : `GitHub a répondu ${res.statusCode}`));
					return;
				}
				try {
					resolve(JSON.parse(body) as T);
				} catch {
					reject(new Error('Réponse illisible de GitHub'));
				}
			});
		}).on('error', reject).on('timeout', function (this: { destroy(err: Error): void }) { this.destroy(new Error('GitHub ne répond pas')); });
	});
}

/** A picture of a page, taken by the browser already on the machine (Edge or Chrome, without a window). */
export async function screenshot(url: string, out: string): Promise<boolean> {
	const browsers = process.platform === 'win32'
		? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
		: process.platform === 'darwin'
			? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
			: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
	const browser = browsers.find(b => fs.existsSync(b));
	if (!browser) {
		return false;
	}
	// Each capture has its own browser profile: two at once sharing one, the second hands over to the first and takes nothing.
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-capture-'));
	try {
		fs.rmSync(out, { force: true });
		await execFileAsync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${profile}`, '--window-size=1280,720', '--virtual-time-budget=4000', `--screenshot=${out}`, url], { timeout: 30000 });
		return fs.existsSync(out) && fs.statSync(out).size > 2000;
	} catch {
		return false;
	} finally {
		fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
	}
}

function titleCard(title: string, description: string): string {
	const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
	return `<!doctype html><html><body style="margin:0;width:1280px;height:720px;display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif;color:#e4e6fb;background:radial-gradient(ellipse at 75% 30%,#3b2a8f 0%,#14102e 45%,#07060f 100%)">
<div style="font-size:22px;letter-spacing:.3em;text-transform:uppercase;color:#5eead4">Template Orbit</div>
<div style="font-size:78px;font-weight:700;margin:18px 0 22px;line-height:1.05">${esc(title)}</div>
<div style="font-size:28px;line-height:1.45;color:#b9bcd8;max-width:980px">${esc(description.slice(0, 180))}</div></body></html>`;
}

function slug(name: string): string {
	return name.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'projet';
}
