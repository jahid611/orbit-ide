/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistantId } from './assistant';
import { runCodex } from './headless';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ClaudeTerminals } from './claudeTerminals';
import { claudeEnv, readConfig, resolveClaudeExecutable, workspaceRoot } from './config';
import { renderWebview, webviewOptions } from './webview';

const PAGE_SIZE = 100;
const SAVED_KEY = 'orbit.database.connections';
const SQLITE_GLOB = '**/*.{db,sqlite,sqlite3,db3}';
const EXCLUDE = '**/{node_modules,.git,.orbit,dist,build,.next,.venv}/**';
const ENV_KEYS = /^(DATABASE_URL|DIRECT_URL|POSTGRES_URL(_NON_POOLING)?|POSTGRES_PRISMA_URL|SUPABASE_DB_URL|PG_URL|DB_URL)$/;

export interface Column {
	name: string;
	type: string;
	nullable: boolean;
	primary: boolean;
	/** `table.column` this column points to, when it is a foreign key. */
	references?: string;
}

export interface Table {
	name: string;
	schema?: string;
	rows: number;
	columns: Column[];
}

interface QueryResult {
	columns: string[];
	rows: unknown[][];
	/** Rows changed by a write. */
	changed?: number;
	ms: number;
}

interface ConnectionInfo {
	id: string;
	kind: 'sqlite' | 'postgres';
	label: string;
	detail: string;
	/** File for SQLite; the secret's key for PostgreSQL (the URL itself stays in secret storage). */
	location: string;
	/** Where it was found, e.g. `.env (DATABASE_URL)`. */
	origin: string;
}

/** One way of talking to a database. */
interface Engine {
	tables(): Promise<Table[]>;
	query(sql: string, params?: unknown[]): Promise<QueryResult>;
	/** Run a read the database itself forbids to write, when it can. */
	read(sql: string): Promise<QueryResult>;
	/** Run several writes all-or-nothing. */
	transaction(statements: { sql: string; params: unknown[] }[]): Promise<number>;
	quote(identifier: string): string;
	placeholder(index: number): string;
	close(): Promise<void>;
}

class SqliteEngine implements Engine {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly db: any;

	constructor(file: string) {
		// node:sqlite ships with the runtime Orbit runs on: no native module to build.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		this.db = new (require('node:sqlite').DatabaseSync)(file);
	}

	async tables(): Promise<Table[]> {
		const names = this.db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[];
		return names.map(({ name }) => {
			const foreign = this.db.prepare(`PRAGMA foreign_key_list(${this.quote(name)})`).all() as { from: string; table: string; to: string }[];
			const columns = (this.db.prepare(`PRAGMA table_info(${this.quote(name)})`).all() as { name: string; type: string; notnull: number; pk: number }[]).map(c => {
				const fk = foreign.find(f => f.from === c.name);
				return { name: c.name, type: c.type || 'ANY', nullable: !c.notnull, primary: c.pk > 0, references: fk ? `${fk.table}.${fk.to ?? 'id'}` : undefined };
			});
			let rows = 0;
			try {
				rows = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.quote(name)}`).get() as { n: number }).n);
			} catch {
				// broken view
			}
			return { name, rows, columns };
		});
	}

	async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
		const started = Date.now();
		const statement = this.db.prepare(sql);
		if (/^\s*(select|with|pragma|explain|values)\b/i.test(sql)) {
			const rows = statement.all(...params) as Record<string, unknown>[];
			const columns: string[] = rows.length ? Object.keys(rows[0]) : (statement.columns?.() ?? []).map((c: { name: string }) => c.name);
			return { columns, rows: rows.map(r => columns.map(c => r[c])), ms: Date.now() - started };
		}
		const info = statement.run(...params) as { changes: number | bigint };
		return { columns: [], rows: [], changed: Number(info.changes), ms: Date.now() - started };
	}

	read(sql: string): Promise<QueryResult> {
		// One statement per prepare, and a SELECT cannot write in SQLite.
		return this.query(sql);
	}

	async transaction(statements: { sql: string; params: unknown[] }[]): Promise<number> {
		let changed = 0;
		this.db.exec('BEGIN');
		try {
			for (const { sql, params } of statements) {
				changed += Number((this.db.prepare(sql).run(...params) as { changes: number }).changes);
			}
			this.db.exec('COMMIT');
		} catch (err) {
			this.db.exec('ROLLBACK');
			throw err;
		}
		return changed;
	}

	quote(identifier: string): string {
		return `"${identifier.replace(/"/g, '""')}"`;
	}

	placeholder(): string {
		return '?';
	}

	async close(): Promise<void> {
		this.db.close();
	}
}

class PostgresEngine implements Engine {
	private readonly pool: import('pg').Pool;

	constructor(url: string) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		this.pool = new (require('pg').Pool)({
			connectionString: url,
			max: 3,
			connectionTimeoutMillis: 8000,
			// Hosted databases (Supabase, Neon, Render…) require TLS; local ones usually refuse it.
			ssl: /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false },
		});
	}

	async tables(): Promise<Table[]> {
		const { rows: columns } = await this.pool.query<{ schema: string; table: string; column: string; type: string; nullable: string }>(`
			SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column, c.data_type AS type, c.is_nullable AS nullable
			FROM information_schema.columns c
			JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
			WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'supabase_functions', 'extensions', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'vault', 'net', 'supabase_migrations', 'cron')
			ORDER BY c.table_schema, c.table_name, c.ordinal_position`);
		const { rows: keys } = await this.pool.query<{ schema: string; table: string; column: string; kind: string; target: string | null; target_column: string | null }>(`
			SELECT kcu.table_schema AS schema, kcu.table_name AS table, kcu.column_name AS column, tc.constraint_type AS kind,
				ccu.table_name AS target, ccu.column_name AS target_column
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
			LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
			WHERE tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`);
		const { rows: counts } = await this.pool.query<{ schema: string; table: string; rows: string }>(`
			SELECT n.nspname AS schema, c.relname AS table, GREATEST(c.reltuples, 0)::bigint AS rows
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p')`);
		const tables = new Map<string, Table>();
		for (const c of columns) {
			const id = `${c.schema}.${c.table}`;
			let table = tables.get(id);
			if (!table) {
				const count = counts.find(r => r.schema === c.schema && r.table === c.table);
				tables.set(id, table = { name: c.table, schema: c.schema, rows: Number(count?.rows ?? 0), columns: [] });
			}
			const own = keys.filter(k => k.schema === c.schema && k.table === c.table && k.column === c.column);
			const fk = own.find(k => k.kind === 'FOREIGN KEY' && k.target);
			table.columns.push({ name: c.column, type: c.type, nullable: c.nullable === 'YES', primary: own.some(k => k.kind === 'PRIMARY KEY'), references: fk ? `${fk.target}.${fk.target_column}` : undefined });
		}
		return [...tables.values()];
	}

	query(sql: string, params: unknown[] = []): Promise<QueryResult> {
		return this.run(this.pool, sql, params);
	}

	async read(sql: string): Promise<QueryResult> {
		const client = await this.pool.connect();
		try {
			// Whatever the text hides (a function that writes…), PostgreSQL refuses to change anything here.
			await client.query('BEGIN READ ONLY');
			return await this.run(client, sql, []);
		} finally {
			await client.query('ROLLBACK').catch(() => undefined);
			client.release();
		}
	}

	private async run(target: import('pg').Pool | import('pg').PoolClient, sql: string, params: unknown[]): Promise<QueryResult> {
		const started = Date.now();
		const result = await target.query({ text: sql, values: params, rowMode: 'array' });
		const isRead = result.command === 'SELECT' || (result.fields?.length ?? 0) > 0;
		return { columns: result.fields?.map(f => f.name) ?? [], rows: result.rows as unknown[][], changed: isRead ? undefined : result.rowCount ?? 0, ms: Date.now() - started };
	}

	async transaction(statements: { sql: string; params: unknown[] }[]): Promise<number> {
		const client = await this.pool.connect();
		let changed = 0;
		try {
			await client.query('BEGIN');
			for (const { sql, params } of statements) {
				changed += (await client.query(sql, params)).rowCount ?? 0;
			}
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK').catch(() => undefined);
			throw err;
		} finally {
			client.release();
		}
		return changed;
	}

	quote(identifier: string): string {
		return identifier.split('.').map(part => `"${part.replace(/"/g, '""')}"`).join('.');
	}

	placeholder(index: number): string {
		return `$${index}`;
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}

const ASSISTANT = `You are a database expert embedded in an IDE. You receive a database schema and a request in natural language.
Answer with ONLY a JSON object, no prose and no code fence:
{"sql": "one SQL statement, or several separated by semicolons", "explanation": "one or two sentences, in the user's language", "writes": true or false}
Rules:
- Use the exact dialect of the database (SQLite or PostgreSQL) and the exact table and column names of the schema; quote identifiers when needed.
- For read requests, add a sensible LIMIT (100 at most) unless the user asks for everything.
- "writes" is true for anything that changes data or structure (INSERT, UPDATE, DELETE, ALTER, CREATE, DROP…).
- Never DROP or TRUNCATE unless the user asks for it explicitly.
- To generate test data, produce realistic values that respect foreign keys and constraints.`;

/**
 * Database explorer: browse tables, edit rows, see the schema as a diagram, and ask Claude for
 * queries in plain language. Writes always go through a preview and an explicit confirmation.
 */
export class DatabasePanel implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private engine: Engine | undefined;
	private current: ConnectionInfo | undefined;
	private schema: Table[] = [];
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly context: vscode.ExtensionContext, private readonly claude: ClaudeTerminals) { }

	dispose(): void {
		this.engine?.close().catch(() => undefined);
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	async show(): Promise<void> {
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		this.panel = vscode.window.createWebviewPanel('orbit.database', 'Base de données', vscode.ViewColumn.Active, { ...webviewOptions(this.context.extensionUri), retainContextWhenHidden: true });
		this.panel.iconPath = new vscode.ThemeIcon('database');
		this.panel.webview.html = renderWebview(this.panel.webview, this.context.extensionUri, 'database');
		// Listeners of this panel only, freed with it so reopening does not pile them up.
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg).catch(err => this.post({ type: 'error', message: errorText(err) })));
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
			this.engine?.close().catch(() => undefined);
			this.engine = undefined;
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'ready': {
				const connections = await this.connections();
				this.post({ type: 'connections', connections, current: this.current?.id });
				if (!this.current && connections.length) {
					await this.connect(connections[0].id);
				}
				break;
			}
			case 'connect':
				await this.connect(String(msg.id));
				break;
			case 'add':
				await this.addConnection();
				break;
			case 'refresh':
				await this.loadSchema();
				break;
			case 'browse':
				await this.browse(msg.table, msg.page ?? 0, msg.sort, msg.where);
				break;
			case 'run':
				await this.run(String(msg.sql), !!msg.confirmed);
				break;
			case 'save':
				await this.save(msg.table, msg.changes);
				break;
			case 'ask':
				await this.ask(String(msg.prompt));
				break;
			case 'delegate':
				this.delegate(String(msg.prompt));
				break;
		}
	}

	// --- connections

	private async connections(): Promise<ConnectionInfo[]> {
		const found: ConnectionInfo[] = [];
		for (const uri of await vscode.workspace.findFiles(SQLITE_GLOB, EXCLUDE, 30)) {
			if (await isSqlite(uri.fsPath)) {
				found.push({ id: `sqlite:${uri.fsPath}`, kind: 'sqlite', label: path.basename(uri.fsPath), detail: vscode.workspace.asRelativePath(uri, false), location: uri.fsPath, origin: 'fichier du projet' });
			}
		}
		for (const uri of await vscode.workspace.findFiles('**/.env*', EXCLUDE, 20)) {
			let text = '';
			try {
				text = await fs.promises.readFile(uri.fsPath, 'utf8');
			} catch {
				continue;
			}
			for (const line of text.split(/\r?\n/)) {
				const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?(postgres(?:ql)?:\/\/[^"'\s]+)/);
				if (match && ENV_KEYS.test(match[1])) {
					const key = `env:${vscode.workspace.asRelativePath(uri, false)}:${match[1]}`;
					await this.context.secrets.store(key, match[2]);
					found.push({ id: key, kind: 'postgres', label: hostOf(match[2]), detail: `${path.basename(uri.fsPath)} · ${match[1]}`, location: key, origin: `${path.basename(uri.fsPath)} (${match[1]})` });
				}
			}
		}
		for (const saved of this.context.workspaceState.get<ConnectionInfo[]>(SAVED_KEY, [])) {
			if (!found.some(f => f.id === saved.id)) {
				found.push(saved);
			}
		}
		return found;
	}

	private async addConnection(): Promise<void> {
		const pick = await vscode.window.showQuickPick([
			{ label: '$(file) Fichier SQLite…', id: 'sqlite' },
			{ label: '$(globe) PostgreSQL / Supabase…', detail: 'Adresse de connexion postgres://…', id: 'postgres' },
		], { title: 'Nouvelle connexion' });
		if (pick?.id === 'sqlite') {
			const file = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'SQLite': ['db', 'sqlite', 'sqlite3', 'db3'], 'Tous les fichiers': ['*'] }, openLabel: 'Ouvrir la base' });
			if (file?.[0]) {
				await this.remember({ id: `sqlite:${file[0].fsPath}`, kind: 'sqlite', label: path.basename(file[0].fsPath), detail: file[0].fsPath, location: file[0].fsPath, origin: 'ajoutée à la main' });
			}
		} else if (pick?.id === 'postgres') {
			const url = await vscode.window.showInputBox({ title: 'PostgreSQL', prompt: 'Adresse de connexion (gardée dans le coffre sécurisé de l\'IDE, jamais dans un fichier)', placeHolder: 'postgresql://utilisateur:motdepasse@hôte:5432/base', password: true, ignoreFocusOut: true, validateInput: v => /^postgres(ql)?:\/\//.test(v.trim()) ? undefined : 'Une adresse postgres://…' });
			if (url) {
				const key = `manual:${Date.now()}`;
				await this.context.secrets.store(key, url.trim());
				await this.remember({ id: key, kind: 'postgres', label: hostOf(url), detail: 'ajoutée à la main', location: key, origin: 'ajoutée à la main' });
			}
		}
	}

	private async remember(info: ConnectionInfo): Promise<void> {
		const saved = this.context.workspaceState.get<ConnectionInfo[]>(SAVED_KEY, []).filter(s => s.id !== info.id);
		await this.context.workspaceState.update(SAVED_KEY, [...saved, info]);
		this.post({ type: 'connections', connections: await this.connections(), current: this.current?.id });
		await this.connect(info.id);
	}

	private async connect(id: string): Promise<void> {
		const info = (await this.connections()).find(c => c.id === id);
		if (!info) {
			return;
		}
		await this.engine?.close().catch(() => undefined);
		this.engine = undefined;
		this.current = info;
		this.post({ type: 'connecting', current: info });
		try {
			if (info.kind === 'sqlite') {
				this.engine = new SqliteEngine(info.location);
			} else {
				const url = await this.context.secrets.get(info.location);
				if (!url) {
					throw new Error('Adresse de connexion introuvable : ajoute la connexion à nouveau.');
				}
				this.engine = new PostgresEngine(url);
			}
			await this.loadSchema();
		} catch (err) {
			// The page would otherwise keep saying it is connecting.
			this.schema = [];
			this.post({ type: 'connectFailed', current: info, message: errorText(err) });
		}
	}

	private async loadSchema(): Promise<void> {
		if (!this.engine) {
			return;
		}
		this.schema = await this.engine.tables();
		this.post({ type: 'schema', current: this.current, tables: this.schema });
	}

	// --- data

	private tableOf(name: string): Table | undefined {
		return this.schema.find(t => (t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name) === name || t.name === name);
	}

	private ref(table: Table): string {
		return this.engine!.quote(table.schema && table.schema !== 'public' ? `${table.schema}.${table.name}` : table.name);
	}

	private async browse(name: string, page: number, sort?: { column: string; desc: boolean }, where?: string): Promise<void> {
		const table = this.tableOf(name);
		if (!table || !this.engine) {
			return;
		}
		const order = sort && table.columns.some(c => c.name === sort.column) ? ` ORDER BY ${this.engine.quote(sort.column)} ${sort.desc ? 'DESC' : 'ASC'}` : '';
		if (where && maskSql(where).includes(';')) {
			throw new Error('Le filtre est une seule condition : pas de « ; » en dehors des textes entre guillemets.');
		}
		// The line break ends a trailing `--` comment before ORDER BY and LIMIT.
		const filter = where?.trim() ? ` WHERE (${where.trim()}\n)` : '';
		const sql = `SELECT * FROM ${this.ref(table)}${filter}${order} LIMIT ${PAGE_SIZE + 1} OFFSET ${page * PAGE_SIZE}`;
		const result = await this.engine.read(sql);
		this.post({ type: 'rows', table: name, page, columns: result.columns, rows: result.rows.slice(0, PAGE_SIZE).map(r => r.map(cell)), more: result.rows.length > PAGE_SIZE, ms: result.ms, sql });
	}

	/** Staged edits from the grid, applied together or not at all. */
	private async save(name: string, changes: { kind: 'update' | 'insert' | 'delete'; key?: Record<string, unknown>; values?: Record<string, unknown> }[]): Promise<void> {
		const table = this.tableOf(name);
		const engine = this.engine;
		if (!table || !engine || !changes?.length) {
			return;
		}
		const statements = changes.map(change => {
			const params: unknown[] = [];
			const p = (value: unknown) => { params.push(value); return engine.placeholder(params.length); };
			// Parameters are numbered in the order they appear in the SQL (SQLite's `?` are positional): SET before WHERE.
			const set = change.kind === 'update' ? Object.entries(change.values ?? {}).map(([k, v]) => `${engine.quote(k)} = ${p(v)}`).join(', ') : '';
			const where = Object.entries(change.key ?? {}).map(([k, v]) => v === null ? `${engine.quote(k)} IS NULL` : `${engine.quote(k)} = ${p(v)}`).join(' AND ');
			if (change.kind === 'update') {
				return { sql: `UPDATE ${this.ref(table)} SET ${set} WHERE ${where}`, params };
			}
			if (change.kind === 'delete') {
				return { sql: `DELETE FROM ${this.ref(table)} WHERE ${where}`, params };
			}
			const entries = Object.entries(change.values ?? {}).filter(([, v]) => v !== undefined && v !== '');
			return entries.length
				? { sql: `INSERT INTO ${this.ref(table)} (${entries.map(([k]) => engine.quote(k)).join(', ')}) VALUES (${entries.map(([, v]) => p(v)).join(', ')})`, params }
				: { sql: `INSERT INTO ${this.ref(table)} DEFAULT VALUES`, params };
		});
		let changed: number;
		try {
			changed = await engine.transaction(statements);
		} catch (err) {
			const reason = /foreign key|violates foreign/i.test(errorText(err)) ? 'une ligne est encore utilisée par une autre table (clé étrangère)'
				: /unique|duplicate key/i.test(errorText(err)) ? 'une valeur doit être unique et existe déjà'
					: /not null/i.test(errorText(err)) ? 'une colonne obligatoire est restée vide'
						: errorText(err);
			throw new Error(`Rien n'a été modifié : ${reason}.`);
		}
		this.post({ type: 'saved', changed });
		await this.loadSchema();
	}

	private async run(sql: string, confirmed: boolean): Promise<void> {
		if (!this.engine || !sql.trim()) {
			return;
		}
		const statements = splitStatements(sql);
		const writes = statements.some(isWrite);
		if (writes && !confirmed) {
			this.post({ type: 'confirm', sql, statements: statements.length });
			return;
		}
		let last: QueryResult | undefined;
		let changed = 0;
		for (const statement of statements) {
			last = await this.engine.query(statement);
			changed += last.changed ?? 0;
		}
		this.post({ type: 'result', columns: last?.columns ?? [], rows: (last?.rows ?? []).slice(0, 1000).map(r => r.map(cell)), changed: writes ? changed : undefined, ms: last?.ms ?? 0, truncated: (last?.rows.length ?? 0) > 1000 });
		if (writes) {
			await this.loadSchema();
		}
	}

	// --- Claude

	private describeSchema(): string {
		return this.schema.map(t => `${t.schema && t.schema !== 'public' ? `${t.schema}.` : ''}${t.name} (${t.rows} lignes): ${t.columns.map(c => `${c.name} ${c.type}${c.primary ? ' PK' : ''}${c.references ? ` -> ${c.references}` : ''}${c.nullable ? '' : ' NOT NULL'}`).join(', ')}`).join('\n');
	}

	private async ask(prompt: string): Promise<void> {
		if (!prompt.trim() || !this.current) {
			return;
		}
		this.post({ type: 'thinking' });
		const dialect = this.current.kind === 'sqlite' ? 'SQLite' : 'PostgreSQL';
		const raw = await runClaude(`Database: ${dialect}\nSchema:\n${this.describeSchema()}\n\nRequest: ${prompt}`, ASSISTANT);
		const start = raw.indexOf('{');
		const end = raw.lastIndexOf('}');
		const answer = JSON.parse(raw.slice(start, end + 1)) as { sql: string; explanation?: string; writes?: boolean };
		this.post({ type: 'suggestion', sql: answer.sql, explanation: answer.explanation ?? '', writes: !!answer.writes });
	}

	/** Hand a bigger job (migrations, seeding scripts, refactors) to a Claude terminal. */
	private delegate(prompt: string): void {
		if (!this.current) {
			return;
		}
		const where = this.current.kind === 'sqlite'
			? `la base SQLite ${vscode.workspace.asRelativePath(this.current.location, false)}`
			: `la base PostgreSQL dont l'adresse est dans ${this.current.origin} (lis-la depuis ce fichier, ne l'affiche pas)`;
		const tables = this.schema.slice(0, 40).map(t => `${t.name}(${t.columns.map(c => `${c.name}${c.primary ? '*' : ''}${c.references ? `→${c.references}` : ''}`).join(', ')})`).join('; ');
		const message = `Travaille sur ${where}.\nSchéma actuel : ${tables}\n\n${prompt.trim()}\n\nMontre-moi les requêtes qui modifient des données ou la structure avant de les exécuter.`;
		const terminal = this.claude.current();
		if (!terminal) {
			// A Claude still starting would drop typed text: the message is its first prompt.
			this.claude.create({ flags: [message] });
			return;
		}
		this.claude.sendMessage(terminal, message);
		terminal.show();
	}

	private post(message: object): void {
		this.panel?.webview.postMessage(message);
	}
}

function cell(value: unknown): unknown {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'bigint') {
		return value.toString();
	}
	if (value instanceof Uint8Array) {
		return `‹${value.length} octets›`;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return value;
}

function hostOf(url: string): string {
	try {
		const u = new URL(url);
		return `${u.hostname}${u.pathname && u.pathname !== '/' ? u.pathname : ''}`;
	} catch {
		return 'PostgreSQL';
	}
}

async function isSqlite(file: string): Promise<boolean> {
	try {
		const handle = await fs.promises.open(file, 'r');
		const buffer = Buffer.alloc(16);
		await handle.read(buffer, 0, 16, 0);
		await handle.close();
		return buffer.toString('latin1') === 'SQLite format 3\0';
	} catch {
		return false;
	}
}

/**
 * The SQL with every string, quoted identifier and comment blanked out (same length, line
 * breaks kept), so what remains is only code: `'…'`, `"…"`, `-- …`, `/* … *\/` and PostgreSQL's
 * dollar-quoted `$$…$$` / `$tag$…$tag$`.
 */
function maskSql(sql: string): string {
	const blank = (text: string) => text.replace(/[^\n]/g, ' ');
	let out = '';
	let i = 0;
	while (i < sql.length) {
		const ch = sql[i];
		let end = -1;
		if (ch === '-' && sql[i + 1] === '-') {
			end = sql.indexOf('\n', i);
			end = end < 0 ? sql.length : end;
		} else if (ch === '/' && sql[i + 1] === '*') {
			end = sql.indexOf('*/', i + 2);
			end = end < 0 ? sql.length : end + 2;
		} else if (ch === '\'' || ch === '"') {
			// A doubled quote inside is an escaped one: the scan just goes on.
			end = sql.indexOf(ch, i + 1);
			while (end >= 0 && sql[end + 1] === ch) {
				end = sql.indexOf(ch, end + 2);
			}
			end = end < 0 ? sql.length : end + 1;
		} else if (ch === '$' && !/\w/.test(sql[i - 1] ?? '')) {
			const tag = sql.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0];
			if (tag) {
				end = sql.indexOf(tag, i + tag.length);
				end = end < 0 ? sql.length : end + tag.length;
			}
		}
		if (end < 0) {
			out += ch;
			i++;
		} else {
			out += blank(sql.slice(i, end));
			i = end;
		}
	}
	return out;
}

/** Split on semicolons that are not inside quotes or comments. */
function splitStatements(sql: string): string[] {
	const masked = maskSql(sql);
	const out: string[] = [];
	let start = 0;
	for (let i = 0; i <= sql.length; i++) {
		if (i === sql.length || masked[i] === ';') {
			// A piece made only of comments is not a statement.
			if (masked.slice(start, i).trim()) {
				out.push(sql.slice(start, i).trim());
			}
			start = i + 1;
		}
	}
	return out;
}

/** Anything that is not a plain read, wherever its writing keyword hides (`WITH … DELETE`…). */
function isWrite(statement: string): boolean {
	const code = maskSql(statement);
	// `replace(…)` is the string function; REPLACE INTO is a write.
	return /\b(insert|update|delete|merge|alter|create|drop|truncate|replace(?!\s*\())\b/i.test(code)
		|| !/^\s*(select|with|pragma|explain|show|values)\b/i.test(code);
}

function errorText(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 400);
}

function runClaude(prompt: string, system: string): Promise<string> {
	if (assistantId() === 'chatgpt') {
		return runCodex(prompt, system, workspaceRoot());
	}
	return new Promise((resolve, reject) => {
		const proc = spawn(resolveClaudeExecutable(), [
			'-p', '--output-format', 'json',
			'--model', readConfig().inlineModel,
			'--tools', '',
			'--no-session-persistence',
			'--system-prompt', system,
		], { cwd: workspaceRoot(), env: claudeEnv(), windowsHide: true });
		let out = '';
		proc.stdout.on('data', d => out += d);
		proc.on('error', reject);
		proc.on('close', code => {
			try {
				const parsed = JSON.parse(out);
				if (parsed.is_error) {
					throw new Error(String(parsed.result || 'Erreur Claude'));
				}
				resolve(String(parsed.result ?? ''));
			} catch (err) {
				reject(err instanceof SyntaxError ? new Error(`Claude a échoué (code ${code})`) : err);
			}
		});
		proc.stdin.end(prompt);
	});
}
