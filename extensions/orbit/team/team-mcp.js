/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// MCP server (stdio) for Orbit's team lead: lets one Claude create, brief, follow and steer the
// other Claude agents of the window. Started by Claude Code. Each Orbit window registers its
// team server in ~/.orbit/team/<pid>.json; the window is looked up on every call (the one that
// owns this terminal), so the tools survive a restart of Orbit's extensions. No dependencies.

'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const REGISTRY = path.join(os.homedir(), '.orbit', 'team');
const terminalId = process.env.ORBIT_TERMINAL_ID || '';

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err && err.code === 'EPERM';
	}
}

/** The window this lead runs in: the one that owns its terminal, else the last focused one. */
function target() {
	let files = [];
	try {
		files = fs.readdirSync(REGISTRY).filter(f => f.endsWith('.json'));
	} catch {
		return undefined;
	}
	const list = [];
	for (const file of files) {
		try {
			const entry = JSON.parse(fs.readFileSync(path.join(REGISTRY, file), 'utf8'));
			if (entry && entry.url && alive(entry.pid)) {
				list.push(entry);
			}
		} catch {
			// being rewritten
		}
	}
	list.sort((a, b) => (b.focusedAt || 0) - (a.focusedAt || 0));
	return (terminalId && list.find(entry => (entry.terminals || []).includes(terminalId))) || list[0];
}

function request(entry, route, params, timeoutMs) {
	const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])), token: entry.token || '' });
	return new Promise((resolve, reject) => {
		const req = http.get(`${entry.url}${route}?${query}`, { timeout: timeoutMs }, res => {
			let body = '';
			res.setEncoding('utf8');
			res.on('data', c => body += c);
			res.on('end', () => {
				try {
					const json = JSON.parse(body);
					res.statusCode && res.statusCode >= 400 ? reject(Object.assign(new Error(json.error || `Erreur ${res.statusCode}`), { fromOrbit: true })) : resolve(json);
				} catch {
					reject(new Error(`Réponse illisible d'Orbit (${res.statusCode})`));
				}
			});
		});
		req.on('timeout', () => req.destroy(new Error('Orbit ne répond pas')));
		req.on('error', reject);
	});
}

async function call(route, params = {}, timeoutMs = 30000) {
	// Orbit may be restarting its extensions: wait for its window to register again.
	const deadline = Date.now() + 15000;
	for (; ;) {
		const entry = target();
		if (entry) {
			try {
				return await request(entry, route, params, timeoutMs);
			} catch (err) {
				if (err.fromOrbit || Date.now() > deadline) {
					throw err;
				}
			}
		} else if (Date.now() > deadline) {
			throw new Error('La fenêtre Orbit de cette équipe est fermée.');
		}
		await new Promise(r => setTimeout(r, 700));
	}
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const agent = { type: 'string', description: 'Nom de l\'agent (tel qu\'affiché sur son onglet)' };
const ICONS = ['design', 'ui', 'frontend', 'backend', 'api', 'database', 'data', 'tests', 'review', 'debug', 'docs', 'research', 'deploy', 'infra', 'security', 'mobile', 'game', 'audio', 'assets', 'refactor', 'perf', 'config', 'content', 'i18n', 'git', 'ai'];

const TOOLS = [
	{
		name: 'team_list', description: 'Liste les agents de l\'équipe : nom, rôle, état (travaille, attend une autorisation, a terminé, prêt), outil en cours, dernière consigne, fichiers modifiés.',
		inputSchema: obj({}), run: () => call('/agents'),
	},
	{
		name: 'team_create_agent',
		description: 'Crée un agent Claude dans un nouveau terminal et lui donne sa mission. Il démarre aussitôt. Donne-lui un nom court, un rôle d\'une ligne, une icône adaptée et une consigne complète et autonome (il ne voit que celle-ci). worktree=true l\'isole sur sa propre branche git (à utiliser si plusieurs agents touchent la même zone).',
		inputSchema: obj({
			name: { type: 'string', description: '2 à 3 mots, dans la langue de l\'utilisateur, ex. « Design accueil »' },
			role: { type: 'string', description: 'Une ligne : son travail, affiché au survol de son onglet' },
			icon: { type: 'string', enum: ICONS },
			prompt: { type: 'string', description: 'Consigne complète : fichiers à créer ou modifier, résultat attendu, comment vérifier' },
			worktree: { type: 'boolean' },
			model: { type: 'string', description: 'Optionnel : opus, sonnet, haiku…' },
		}, ['name', 'role', 'icon', 'prompt']),
		run: a => call('/create', { name: a.name, role: a.role, icon: a.icon, prompt: a.prompt, worktree: a.worktree ? 'true' : undefined, model: a.model }),
	},
	{
		name: 'team_message', description: 'Envoie un message à un agent, comme si l\'utilisateur le tapait dans son terminal (corriger, continuer, répondre à sa question).',
		inputSchema: obj({ agent, message: { type: 'string' } }, ['agent', 'message']), run: a => call('/send', { agent: a.agent, message: a.message }),
	},
	{
		name: 'team_read', description: 'Lit les dernières réponses d\'un agent pour récupérer son résultat.',
		inputSchema: obj({ agent, count: { type: 'number', description: 'Nombre de réponses (3 par défaut)' } }, ['agent']), run: a => call('/read', { agent: a.agent, count: a.count }),
	},
	{
		name: 'team_wait', description: 'Attend que des agents aient fini de travailler (ou demandent une autorisation). Sans liste : tous les agents. Délai max 600 s.',
		inputSchema: obj({ agents: { type: 'array', items: { type: 'string' } }, timeoutSeconds: { type: 'number' } }),
		run: a => call('/wait', { agents: (a.agents || []).join(','), timeout: a.timeoutSeconds || 300 }, 620000),
	},
	{
		name: 'team_focus', description: 'Affiche le terminal d\'un agent à l\'utilisateur (pour lui montrer un résultat ou une demande d\'autorisation).',
		inputSchema: obj({ agent }, ['agent']), run: a => call('/focus', { agent: a.agent }),
	},
	{
		name: 'team_rename', description: 'Renomme un agent, change son rôle ou son icône.',
		inputSchema: obj({ agent, name: { type: 'string' }, role: { type: 'string' }, icon: { type: 'string', enum: ICONS } }, ['agent']),
		run: a => call('/rename', { agent: a.agent, name: a.name, role: a.role, icon: a.icon }),
	},
	{
		name: 'team_stop', description: 'Interrompt le travail en cours d\'un agent (comme Échap).',
		inputSchema: obj({ agent }, ['agent']), run: a => call('/stop', { agent: a.agent }),
	},
	{
		name: 'team_close', description: 'Ferme le terminal d\'un agent qui a fini et ne sert plus.',
		inputSchema: obj({ agent }, ['agent']), run: a => call('/close', { agent: a.agent }),
	},
	{
		name: 'team_show_map', description: 'Ouvre la vue Orbite : toute l\'équipe sur une carte, les fichiers touchés et les collisions.',
		inputSchema: obj({}), run: () => call('/map'),
	},
	{
		name: 'team_open_file', description: 'Ouvre un fichier dans l\'éditeur de l\'utilisateur, à une ligne donnée, pour lui montrer un résultat.',
		inputSchema: obj({ file: { type: 'string', description: 'Chemin relatif au projet ou absolu' }, line: { type: 'number' } }, ['file']),
		run: a => call('/open', { file: a.file, line: a.line }),
	},
];

function reply(message) {
	process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
	const { id, method, params } = message;
	if (id === undefined) {
		return;
	}
	try {
		switch (method) {
			case 'initialize':
				return reply({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orbit-team', version: '1.0.0' } } });
			case 'ping':
				return reply({ jsonrpc: '2.0', id, result: {} });
			case 'tools/list':
				return reply({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
			case 'tools/call': {
				const tool = TOOLS.find(t => t.name === params?.name);
				if (!tool) {
					throw Object.assign(new Error(`Outil inconnu : ${params?.name}`), { code: -32602 });
				}
				try {
					const result = await tool.run(params.arguments || {});
					return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] } });
				} catch (err) {
					return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(err && err.message || err) }], isError: true } });
				}
			}
			default:
				throw Object.assign(new Error(`Méthode inconnue : ${method}`), { code: -32601 });
		}
	} catch (err) {
		reply({ jsonrpc: '2.0', id, error: { code: err.code || -32603, message: String(err.message || err) } });
	}
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
	buffer += chunk;
	let newline;
	while ((newline = buffer.indexOf('\n')) >= 0) {
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (line) {
			try {
				handle(JSON.parse(line));
			} catch {
				// not JSON
			}
		}
	}
});
