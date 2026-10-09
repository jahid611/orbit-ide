/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// MCP server (stdio) for StarCapture, Orbit's video editor: lets Claude open, read, edit,
// look at and export a montage. Each Orbit window registers its local address in
// ~/.orbit/starcapture/windows/<pid>.json; the last focused window answers.

'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const REGISTRY = path.join(os.homedir(), '.orbit', 'starcapture', 'windows');
const cwd = process.cwd();

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err && err.code === 'EPERM';
	}
}

function target() {
	let list = [];
	try {
		list = fs.readdirSync(REGISTRY).filter(f => f.endsWith('.json')).map(f => {
			try {
				return JSON.parse(fs.readFileSync(path.join(REGISTRY, f), 'utf8'));
			} catch {
				return undefined;
			}
		}).filter(e => e && e.url && alive(e.pid));
	} catch {
		// no window yet
	}
	// A window with a montage open first, then the most recently focused.
	return list.sort((a, b) => ((b.open || []).length > 0) - ((a.open || []).length > 0) || (b.focusedAt || 0) - (a.focusedAt || 0))[0];
}

function post(entry, tool, args, timeoutMs) {
	const body = JSON.stringify({ token: entry.token, tool, args, cwd });
	return new Promise((resolve, reject) => {
		const url = new URL(entry.url);
		const req = http.request({ hostname: url.hostname, port: url.port, path: '/', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: timeoutMs }, res => {
			let data = '';
			res.setEncoding('utf8');
			res.on('data', c => data += c);
			res.on('end', () => {
				try {
					const json = JSON.parse(data);
					res.statusCode && res.statusCode >= 400 ? reject(Object.assign(new Error(json.error || `Erreur ${res.statusCode}`), { fromOrbit: true })) : resolve(json);
				} catch {
					reject(new Error(`Réponse illisible d'Orbit (${res.statusCode})`));
				}
			});
		});
		req.on('timeout', () => req.destroy(new Error('Orbit ne répond pas')));
		req.on('error', reject);
		req.end(body);
	});
}

async function call(tool, args = {}, timeoutMs = 120000) {
	const deadline = Date.now() + 15000;
	for (; ;) {
		const entry = target();
		if (entry) {
			try {
				return await post(entry, tool, args, timeoutMs);
			} catch (err) {
				if (err.fromOrbit || Date.now() > deadline) {
					throw err;
				}
			}
		} else if (Date.now() > deadline) {
			throw new Error('Aucune fenêtre Orbit avec StarCapture n\'est ouverte.');
		}
		await new Promise(r => setTimeout(r, 700));
	}
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const file = { type: 'string', description: 'Chemin absolu, ou relatif au dossier où tu as été lancé' };

const TOOLS = [
	{
		name: 'sc_guide', description: 'Mode d\'emploi complet de StarCapture pour toi : modèle de données, toutes les opérations, et la méthode d\'un monteur YouTube pro. À lire avant ton premier montage.',
		inputSchema: obj({}), run: () => call('guide'),
	},
	{
		name: 'sc_open', description: 'Ouvre une vidéo (mp4, mov, webm…) ou un projet .starcapture dans StarCapture, l\'éditeur vidéo d\'Orbit, et renvoie l\'état du montage. Ouvrir une vidéo crée son projet <nom>.starcapture à côté. create=true crée un montage vide (vertical=true pour du 1080x1920 : Shorts, TikTok, Reels).',
		inputSchema: obj({ path: file, create: { type: 'boolean' }, vertical: { type: 'boolean' } }, ['path']), run: a => call('open', a),
	},
	{
		name: 'sc_state', description: 'État du montage affiché : format, durée, tête de lecture, sélection de l\'utilisateur, médias, pistes, clips (id, piste, début/fin sur la timeline, in/out dans la source), marqueurs. detail=true ajoute toutes les propriétés de chaque clip.',
		inputSchema: obj({ detail: { type: 'boolean' } }), run: a => call('state', a),
	},
	{
		name: 'sc_import', description: 'Importe des fichiers (vidéos, sons, musiques, images) dans le montage. toTimeline=true les pose à la suite (ou à "at" secondes, sur "track").',
		inputSchema: obj({ paths: { type: 'array', items: file }, toTimeline: { type: 'boolean' }, at: { type: 'number' }, track: { type: 'string' } }, ['paths']), run: a => call('import', a),
	},
	{
		name: 'sc_edit', description: 'Modifie le montage : liste d\'opérations appliquées ensemble comme UNE modification annulable. Opérations : addMedia, split, remove (ripple), removeRanges, update (position, cadrage, couleurs, keyframes, texte, vitesse, volume…), addText (presets youtube, beast, caption, title, subtitle, lowerThird, minimal, typewriter), transition, punchIn, marker, duplicate, track, project. Détails dans sc_guide.',
		inputSchema: obj({ ops: { type: 'array', items: { type: 'object' } }, label: { type: 'string', description: 'Nom de la modification dans l\'historique' } }, ['ops']), run: a => call('edit', a),
	},
	{
		name: 'sc_transcribe', description: 'Transcrit la parole d\'un média (Whisper, en local) et renvoie les phrases et les mots horodatés EN TEMPS DE TIMELINE, pour couper les hésitations, placer des textes ou des sous-titres au bon moment. Gardé en cache dans le projet (force=true pour refaire).',
		inputSchema: obj({ media: { type: 'string', description: 'id ou nom du média (défaut : le premier avec du son)' }, language: { type: 'string', description: 'fr, en… (défaut fr)' }, force: { type: 'boolean' } }), run: a => call('transcribe', a, 60 * 60 * 1000),
	},
	{
		name: 'sc_silences', description: 'Trouve les silences d\'un média, en temps de timeline. apply=true les retire et recolle (coupes « jump cut »). thresholdDb (défaut -38), minDuration (s, défaut 0.5), padding (s gardés autour de la parole, défaut 0.12).',
		inputSchema: obj({ media: { type: 'string' }, apply: { type: 'boolean' }, thresholdDb: { type: 'number' }, minDuration: { type: 'number' }, padding: { type: 'number' } }), run: a => call('silences', a, 10 * 60 * 1000),
	},
	{
		name: 'sc_frame', description: 'Rendu de l\'image du montage à un instant (textes, effets et calques compris) : tu VOIS ce que verra le spectateur. Par défaut à la tête de lecture.',
		inputSchema: obj({ t: { type: 'number' }, width: { type: 'number', description: 'Largeur de l\'image (défaut 960)' } }),
		run: async a => {
			const r = await call('frame', a);
			const m = /^data:(image\/\w+);base64,(.+)$/s.exec(r.image || '');
			return m ? { content: [{ type: 'image', data: m[2], mimeType: m[1] }, { type: 'text', text: `Image du montage à ${r.t} s` }] } : r;
		},
	},
	{
		name: 'sc_seek', description: 'Place la tête de lecture de l\'utilisateur à t secondes (play=true lance la lecture), pour lui montrer un moment.',
		inputSchema: obj({ t: { type: 'number' }, play: { type: 'boolean' } }, ['t']), run: a => call('seek', a),
	},
	{
		name: 'sc_undo', description: 'Annule la dernière modification du montage.', inputSchema: obj({}), run: () => call('undo'),
	},
	{
		name: 'sc_redo', description: 'Rétablit la modification annulée.', inputSchema: obj({}), run: () => call('redo'),
	},
	{
		name: 'sc_export', description: 'Exporte la vidéo finale avec ffmpeg (progression visible dans Orbit). preset : master (taille du projet), 1080p, 4k, 720p, prores, webm. path facultatif (défaut : dossier exports à côté du projet). range=[début, fin] pour n\'exporter qu\'une partie.',
		inputSchema: obj({ preset: { type: 'string' }, path: file, range: { type: 'array', items: { type: 'number' } } }), run: a => call('export', a, 6 * 60 * 60 * 1000),
	},
	{
		name: 'sc_creations', description: 'La bibliothèque de créations de l\'utilisateur : effets, styles de texte et incrustations (filigranes, logos) enregistrés pour être réutilisés dans tous ses montages. À consulter avant de refaire quelque chose qu\'il a peut-être déjà.',
		inputSchema: obj({}), run: () => call('creations'),
	},
	{
		name: 'sc_creation_save', description: 'Enregistre une création dans la bibliothèque de l\'utilisateur (même nom = remplace). kind : effect (réglages de clip), text (style de texte), overlay (image par-dessus : filigrane, logo). Source : from = identifiant d\'un clip déjà réglé dans le montage, ou bien patch (effect), style (text), file (overlay : chemin d\'une image) avec x, y, scale, opacity.',
		inputSchema: obj({ name: { type: 'string' }, kind: { type: 'string', enum: ['effect', 'text', 'overlay'] }, description: { type: 'string' }, from: { type: 'string' }, patch: { type: 'object' }, style: { type: 'object' }, file, x: { type: 'number' }, y: { type: 'number' }, scale: { type: 'number' }, opacity: { type: 'number' } }, ['name']),
		run: a => call('creationSave', a),
	},
	{
		name: 'sc_creation_apply', description: 'Applique une création au montage ouvert, en une modification annulable. Effet : sur ids, sinon sur la sélection de l\'utilisateur. Texte : à start (défaut : tête de lecture) pendant duration, avec content. Incrustation : sur tout le montage par défaut, sur sa propre piste.',
		inputSchema: obj({ name: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, start: { type: 'number' }, duration: { type: 'number' }, content: { type: 'string' } }, ['name']),
		run: a => call('creationApply', a),
	},
	{
		name: 'sc_creation_delete', description: 'Retire une création de la bibliothèque de l\'utilisateur. Les montages qui l\'utilisent déjà ne changent pas.',
		inputSchema: obj({ name: { type: 'string' } }, ['name']), run: a => call('creationDelete', a),
	},
];

const INSTRUCTIONS = 'StarCapture est l\'éditeur vidéo intégré à Orbit. Quand l\'utilisateur parle de montage, de vidéo, de sous-titres, de couper ou d\'exporter, utilise ces outils : sc_open pour ouvrir la vidéo, sc_guide une fois pour la méthode, sc_state, sc_transcribe, sc_edit, sc_frame pour vérifier, sc_export. Tout est annulable.';

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
				return reply({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'starcapture', version: '1.0.0' }, instructions: INSTRUCTIONS } });
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
					const content = result && result.content ? result.content : [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 1) }];
					return reply({ jsonrpc: '2.0', id, result: { content } });
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
