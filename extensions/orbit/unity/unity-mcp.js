/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// MCP server (stdio) that gives Claude Code hands and eyes in the Unity Editor, through the
// Orbit Bridge package. Started by Claude Code itself; Orbit points it at the project with
// ORBIT_UNITY_PROJECT. No dependencies: plain JSON-RPC over newline-delimited stdin/stdout.

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const project = process.env.ORBIT_UNITY_PROJECT || process.cwd();
const bridgeFile = path.join(project, 'Library', 'OrbitBridge.json');

function bridge() {
	try {
		return JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
	} catch {
		throw new Error('Unity n\'est pas connecté : ouvre le projet dans Unity (le paquet Orbit Bridge doit être installé).');
	}
}

/** Call the bridge; resolves with parsed JSON, or a Buffer for images. */
function call(route, params = {}) {
	const { port, token } = bridge();
	const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])), token });
	return new Promise((resolve, reject) => {
		const req = http.get({ hostname: '127.0.0.1', port, path: `${route}?${query}`, timeout: 30000 }, res => {
			const chunks = [];
			res.on('data', c => chunks.push(c));
			res.on('end', () => {
				const body = Buffer.concat(chunks);
				if (String(res.headers['content-type']).startsWith('image/')) {
					resolve(body);
					return;
				}
				try {
					const json = JSON.parse(body.toString('utf8'));
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(json.error || `Erreur ${res.statusCode}`));
					} else {
						resolve(json);
					}
				} catch {
					reject(new Error(`Réponse illisible de Unity (${res.statusCode})`));
				}
			});
		});
		req.on('timeout', () => req.destroy(new Error('Unity ne répond pas (compilation ou import en cours ?)')));
		req.on('error', err => reject(/ECONNREFUSED/.test(String(err)) ? new Error('Unity n\'est pas ouvert, ou recompile : réessaie dans quelques secondes.') : err));
	});
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const id = { type: 'number', description: 'Identifiant de l\'objet (instance id), donné par unity_hierarchy ou unity_find' };

/** @type {{ name: string, description: string, inputSchema: object, run: (args: any) => Promise<any> }[]} */
const TOOLS = [
	{
		name: 'unity_state', description: 'État de l\'éditeur Unity : scène ouverte, lecture en cours, compilation, objet sélectionné.',
		inputSchema: obj({}), run: () => call('/state'),
	},
	{
		name: 'unity_hierarchy', description: 'Arbre complet des objets des scènes ouvertes (id, nom, actif, type, enfants).',
		inputSchema: obj({}), run: () => call('/hierarchy'),
	},
	{
		name: 'unity_find', description: 'Cherche des objets par nom (sous-chaîne, insensible à la casse). Renvoie id et chemin.',
		inputSchema: obj({ query: { type: 'string' } }, ['query']), run: a => call('/find', { q: a.query }),
	},
	{
		name: 'unity_inspect', description: 'Composants d\'un objet avec toutes leurs propriétés sérialisées (chemin, type, valeur) et le fichier C# de chaque script.',
		inputSchema: obj({ id }, ['id']), run: a => call('/inspect', { id: a.id }),
	},
	{
		name: 'unity_set_property',
		description: 'Change une propriété sérialisée. component = index renvoyé par unity_inspect (-1 pour le GameObject lui-même : m_Name, m_IsActive). value : nombre, true/false, texte, "x,y,z" pour un vecteur, "r,g,b,a" (0 à 1) pour une couleur, angles "x,y,z" pour une rotation, index pour une énumération.',
		inputSchema: obj({ id, component: { type: 'number' }, path: { type: 'string', description: 'propertyPath, ex. m_LocalPosition, m_Mass, speed' }, value: { type: 'string' } }, ['id', 'component', 'path', 'value']),
		run: a => call('/set', { id: a.id, comp: a.component, path: a.path, value: a.value }),
	},
	{
		name: 'unity_create_object', description: 'Crée un objet dans la scène : primitive Cube, Sphere, Capsule, Cylinder, Plane, Quad, ou Empty. Position locale "x,y,z", parent optionnel.',
		inputSchema: obj({ name: { type: 'string' }, primitive: { type: 'string' }, parent: { type: 'number' }, position: { type: 'string' } }, ['name']),
		run: a => call('/create', { name: a.name, primitive: a.primitive, parent: a.parent, position: a.position }),
	},
	{
		name: 'unity_add_component', description: 'Ajoute un composant par nom de type (Rigidbody, BoxCollider, Light, AudioSource, ou un script du projet comme PlayerController). Le script doit déjà être compilé.',
		inputSchema: obj({ id, type: { type: 'string' } }, ['id', 'type']), run: a => call('/addComponent', { id: a.id, type: a.type }),
	},
	{
		name: 'unity_remove_component', description: 'Retire un composant (index donné par unity_inspect).',
		inputSchema: obj({ id, component: { type: 'number' } }, ['id', 'component']), run: a => call('/removeComponent', { id: a.id, comp: a.component }),
	},
	{
		name: 'unity_delete_object', description: 'Supprime un objet de la scène (annulable avec Ctrl+Z dans Unity).',
		inputSchema: obj({ id }, ['id']), run: a => call('/delete', { id: a.id }),
	},
	{
		name: 'unity_screenshot', description: 'Image de ce que voit la caméra du jeu (view "game") ou la vue Scène de l\'éditeur (view "scene"). Utilise-la pour vérifier visuellement ton travail.',
		inputSchema: obj({ view: { type: 'string', enum: ['game', 'scene'] }, width: { type: 'number' }, height: { type: 'number' } }),
		run: async a => ({ image: await call('/frame', { view: a.view || 'game', w: a.width || 960, h: a.height || 540 }) }),
	},
	{
		name: 'unity_play', description: 'Lance le jeu (mode Play). Les scripts sont rechargés : attends quelques secondes avant de lire la console.',
		inputSchema: obj({}), run: () => call('/play'),
	},
	{
		name: 'unity_stop', description: 'Arrête le jeu (sort du mode Play). Les changements faits pendant la lecture sont perdus.',
		inputSchema: obj({}), run: () => call('/stop'),
	},
	{
		name: 'unity_console', description: 'Messages de la console Unity (logs, avertissements, erreurs avec fichier et ligne), à partir d\'un index.',
		inputSchema: obj({ since: { type: 'number' }, errorsOnly: { type: 'boolean' } }),
		run: async a => {
			const logs = await call('/logs', { since: a.since || 0 });
			return a.errorsOnly ? { total: logs.total, entries: logs.entries.filter(e => e.type === 'error') } : logs;
		},
	},
	{
		name: 'unity_refresh', description: 'Réimporte les fichiers modifiés et recompile les scripts C# (après avoir écrit ou modifié un .cs).',
		inputSchema: obj({}), run: () => call('/refresh'),
	},
	{
		name: 'unity_save_scene', description: 'Enregistre les scènes ouvertes.',
		inputSchema: obj({}), run: () => call('/save'),
	},
];

function reply(message) {
	process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
	const { id: requestId, method, params } = message;
	if (requestId === undefined) {
		return; // notification
	}
	try {
		switch (method) {
			case 'initialize':
				return reply({ jsonrpc: '2.0', id: requestId, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orbit-unity', version: '1.0.0' }, instructions: 'Outils pour piloter l\'éditeur Unity ouvert par l\'utilisateur. Après avoir modifié un script C#, appelle unity_refresh puis vérifie unity_console. Vérifie visuellement avec unity_screenshot.' } });
			case 'ping':
				return reply({ jsonrpc: '2.0', id: requestId, result: {} });
			case 'tools/list':
				return reply({ jsonrpc: '2.0', id: requestId, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
			case 'tools/call': {
				const tool = TOOLS.find(t => t.name === params?.name);
				if (!tool) {
					throw Object.assign(new Error(`Outil inconnu : ${params?.name}`), { code: -32602 });
				}
				try {
					const result = await tool.run(params.arguments || {});
					const content = result && Buffer.isBuffer(result.image)
						? [{ type: 'image', data: result.image.toString('base64'), mimeType: 'image/jpeg' }]
						: [{ type: 'text', text: JSON.stringify(result, null, 1) }];
					return reply({ jsonrpc: '2.0', id: requestId, result: { content } });
				} catch (err) {
					return reply({ jsonrpc: '2.0', id: requestId, result: { content: [{ type: 'text', text: String(err && err.message || err) }], isError: true } });
				}
			}
			default:
				throw Object.assign(new Error(`Méthode inconnue : ${method}`), { code: -32601 });
		}
	} catch (err) {
		reply({ jsonrpc: '2.0', id: requestId, error: { code: err.code || -32603, message: String(err.message || err) } });
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
				// not JSON: ignore
			}
		}
	}
});
