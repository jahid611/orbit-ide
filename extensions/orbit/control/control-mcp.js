/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// MCP server (stdio) given to every Claude that Orbit starts: lets Claude drive the IDE itself
// (explorer, projects, editors, views, any command). Each Orbit window registers its local
// address in ~/.orbit/control/<pid>.json; the window is looked up on every call, so the tools
// keep working when Orbit restarts its extension host (e.g. after the open folders change).

'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const REGISTRY = path.join(os.homedir(), '.orbit', 'control');
const terminalId = process.env.ORBIT_TERMINAL_ID || '';
const cwd = process.cwd();

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err && err.code === 'EPERM';
	}
}

function windows() {
	let files = [];
	try {
		files = fs.readdirSync(REGISTRY).filter(f => f.endsWith('.json'));
	} catch {
		return [];
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
	return list.sort((a, b) => (b.focusedAt || 0) - (a.focusedAt || 0));
}

function request(entry, route, params, timeoutMs) {
	const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])), token: entry.token, cwd, terminal: terminalId });
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

/** The window this Claude runs in: the one that owns its terminal, else the last focused one. */
async function target() {
	const list = windows();
	if (terminalId) {
		for (const entry of list) {
			if ((entry.terminals || []).includes(terminalId)) {
				return entry;
			}
		}
	}
	return list[0];
}

async function call(route, params = {}, timeoutMs = 30000) {
	// Orbit may be restarting its extensions (the open folders just changed): wait for it.
	const deadline = Date.now() + 15000;
	for (; ;) {
		const entry = await target();
		if (entry) {
			try {
				return await request(entry, route, params, timeoutMs);
			} catch (err) {
				if (err.fromOrbit || Date.now() > deadline) {
					throw err;
				}
			}
		} else if (Date.now() > deadline) {
			throw new Error('Aucune fenêtre Orbit ouverte.');
		}
		await new Promise(r => setTimeout(r, 700));
	}
}

const GUIDE = path.join(__dirname, 'guide');

/** Every page of Orbit's manual: `category/slug`, its title and its one-line description. */
function guidePages() {
	const pages = [];
	let categories = [];
	try {
		categories = fs.readdirSync(GUIDE).filter(c => fs.statSync(path.join(GUIDE, c)).isDirectory());
	} catch {
		return pages;
	}
	for (const category of categories) {
		for (const name of fs.readdirSync(path.join(GUIDE, category)).filter(f => f.endsWith('.md'))) {
			const text = fs.readFileSync(path.join(GUIDE, category, name), 'utf8');
			const head = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
			const field = key => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head ? head[1] : '')?.[1].trim() || '';
			pages.push({ id: `${category}/${name.slice(0, -3)}`, title: field('title'), description: field('description'), body: head ? text.slice(head[0].length) : text });
		}
	}
	return pages;
}

function guide({ page, search }) {
	const pages = guidePages();
	if (!pages.length) {
		throw new Error('Le manuel d\'Orbit est introuvable.');
	}
	if (page) {
		const wanted = String(page).toLowerCase().replace(/^\/?docs\//, '').replace(/\.md$/, '');
		const found = pages.find(p => p.id === wanted) || pages.find(p => p.id.endsWith(`/${wanted}`));
		if (!found) {
			throw new Error(`Page inconnue « ${page} ». Appelle guide sans argument pour la liste.`);
		}
		return `# ${found.title}\n\n${found.body}`;
	}
	if (search) {
		const words = String(search).toLowerCase().split(/\s+/).filter(Boolean);
		const hits = pages.map(p => {
			const text = `${p.title}\n${p.description}\n${p.body}`.toLowerCase();
			const score = words.reduce((n, w) => n + (text.split(w).length - 1) + (p.title.toLowerCase().includes(w) ? 20 : 0), 0);
			const body = p.body.toLowerCase();
			const word = words.find(w => body.includes(w));
			const from = word ? Math.max(0, body.indexOf(word) - 120) : -1;
			return { p, score: words.every(w => text.includes(w)) ? score : 0, extract: from >= 0 ? p.body.slice(from, from + 320).replace(/\s+/g, ' ') : p.description };
		}).filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
		return hits.length ? hits.map(h => `${h.p.id} — ${h.p.title}\n  … ${h.extract} …`).join('\n\n') : 'Rien dans le manuel pour ces mots. Appelle guide sans argument pour la liste des pages.';
	}
	return `Manuel d'Orbit : ${pages.length} pages. Appelle guide avec page="categorie/page" pour en lire une, ou search="mots" pour chercher.\n\n${pages.map(p => `${p.id} — ${p.title} : ${p.description}`).join('\n')}`;
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const file = { type: 'string', description: 'Chemin absolu, ou relatif au dossier où tu as été lancé' };
const VIEWS = ['explorer', 'search', 'git', 'terminal', 'problems', 'extensions', 'settings', 'map', 'team', 'timeline', 'database', 'preview', 'unity', 'community', 'higgsfield', 'usage', 'studio', 'chat', 'tutorial', 'vercel', 'queue', 'env', 'board', 'visual', 'store', 'figma', 'supabase', 'stripe'];

const TOOLS = [
	{
		name: 'guide',
		description: 'Le manuel complet d\'Orbit : chaque page, chaque outil (StarCapture, NovaGame, Vercel, Supabase, Stripe, Figma, file de nuit, tableau de tâches…), les raccourcis, les réglages, les commandes. À consulter avant de répondre à toute question sur Orbit (« comment je fais… », « où est… », « est-ce qu\'Orbit sait… ») et avant de te servir d\'une page d\'Orbit que tu ne connais pas. Sans argument : la liste des pages. page : une page entière. search : les pages qui parlent de ces mots.',
		inputSchema: obj({ page: { type: 'string', description: 'Par exemple outils/supabase' }, search: { type: 'string' } }),
		run: a => guide(a),
	},
	{
		name: 'state',
		description: 'Ce que l\'utilisateur voit dans Orbit : dossiers affichés dans l\'explorateur, fichier actif et sélection, éditeurs ouverts, terminaux Claude (nom, dossier, état).',
		inputSchema: obj({}), run: () => call('/state'),
	},
	{
		name: 'show_folder',
		description: 'Affiche un dossier dans l\'explorateur d\'Orbit, sans recharger la fenêtre ni couper les terminaux. À appeler dès que tu travailles dans un dossier qui n\'est pas affiché. mode « replace » (défaut) : l\'explorateur ne montre plus que ce dossier ; « add » : l\'ajoute à côté des dossiers déjà affichés ; « remove » : le retire. create=true crée le dossier s\'il n\'existe pas.',
		inputSchema: obj({ path: file, mode: { type: 'string', enum: ['replace', 'add', 'remove'] }, create: { type: 'boolean' } }, ['path']),
		run: a => call('/show_folder', { path: a.path, mode: a.mode || 'replace', create: a.create ? 'true' : undefined }),
	},
	{
		name: 'open_project',
		description: 'Bascule Orbit sur un autre projet, comme « Changer de projet » : la fenêtre s\'ouvre sur ce dossier (create=true le crée, git init compris) et un nouveau Claude y démarre, avec prompt comme premier message s\'il est fourni (donne-lui tout le contexte nécessaire : il ne voit rien de cette conversation). Sans newWindow, Orbit demande à l\'utilisateur s\'il veut l\'ouvrir en plus (autre fenêtre) ou à la place du projet actuel : ne le précise que s\'il te l\'a dit. newWindow=false force la même fenêtre : les terminaux actuels, toi compris, se ferment environ 2 s après : termine d\'abord ce que tu as à faire (commit, push…) et réponds à l\'utilisateur avant d\'appeler cet outil. newWindow=true ouvre une autre fenêtre et garde celle-ci.',
		inputSchema: obj({ path: file, create: { type: 'boolean' }, prompt: { type: 'string' }, newWindow: { type: 'boolean' } }, ['path']),
		run: a => call('/open_project', { path: a.path, create: a.create ? 'true' : undefined, prompt: a.prompt, newWindow: typeof a.newWindow === 'boolean' ? String(a.newWindow) : undefined }, 10 * 60 * 1000),
	},
	{
		name: 'open_file',
		description: 'Ouvre un fichier dans l\'éditeur d\'Orbit (à une ligne donnée) et le montre dans l\'explorateur. Son dossier est affiché s\'il ne l\'était pas.',
		inputSchema: obj({ path: file, line: { type: 'number' }, endLine: { type: 'number', description: 'Pour sélectionner un bloc' }, side: { type: 'boolean', description: 'Ouvrir à côté de l\'éditeur actuel' } }, ['path']),
		run: a => call('/open_file', { path: a.path, line: a.line, endLine: a.endLine, side: a.side ? 'true' : undefined }),
	},
	{
		name: 'show_view',
		description: 'Affiche une vue d\'Orbit : explorer, search, git, terminal, problems, extensions, settings, map (carte des agents), team, timeline (machine à remonter le temps), database, preview (vue vivante de l\'interface), unity, community, higgsfield (studio de génération : images, vidéos, 3D et sons), usage (utilisation de l\'abonnement), studio (personnalisation), chat, tutorial, vercel (mise en ligne), queue (file de nuit), env (variables d\'environnement), board (tableau de tâches), visual (relecture visuelle avant / après), store (magasin de connecteurs et de recettes), figma (maquette vers code), supabase, stripe.',
		inputSchema: obj({ view: { type: 'string', enum: VIEWS } }, ['view']), run: a => call('/show_view', { view: a.view }),
	},
	{
		name: 'open_url',
		description: 'Ouvre une adresse : un serveur local (http://localhost…) dans la vue vivante d\'Orbit, une page web dans le navigateur intégré, ou dans le navigateur du système avec external=true.',
		inputSchema: obj({ url: { type: 'string' }, external: { type: 'boolean' } }, ['url']),
		run: a => call('/open_url', { url: a.url, external: a.external ? 'true' : undefined }),
	},
	{
		name: 'new_claude',
		description: 'Ouvre un autre terminal Claude dans Orbit (dans un dossier donné, avec un nom et un premier message). Pour piloter une équipe d\'agents, préfère le Chef d\'équipe.',
		inputSchema: obj({ path: file, name: { type: 'string' }, prompt: { type: 'string' }, focus: { type: 'boolean' } }),
		run: a => call('/new_claude', { path: a.path, name: a.name, prompt: a.prompt, focus: a.focus ? 'true' : undefined }),
	},
	{
		name: 'notify',
		description: 'Affiche une notification dans Orbit (info, warning ou error).',
		inputSchema: obj({ message: { type: 'string' }, level: { type: 'string', enum: ['info', 'warning', 'error'] } }, ['message']),
		run: a => call('/notify', { message: a.message, level: a.level }),
	},
	{
		name: 'run_command',
		description: 'Exécute n\'importe quelle commande d\'Orbit/VS Code par son identifiant (ex. workbench.action.toggleSidebarVisibility, workbench.action.splitEditor, editor.action.formatDocument, git.sync). args : tableau d\'arguments JSON ; un objet {"$uri": "chemin"} devient un Uri. Utilise find_commands pour trouver un identifiant.',
		inputSchema: obj({ command: { type: 'string' }, args: { type: 'array' } }, ['command']),
		run: a => call('/run_command', { command: a.command, args: a.args || [] }, 120000),
	},
	{
		name: 'board_list',
		description: 'Le tableau de tâches du projet : chaque carte avec son identifiant, son titre, son détail, sa colonne (todo = à faire, doing = en cours, review = à vérifier, done = fait) et le compte rendu de l\'agent qui l\'a traitée.',
		inputSchema: obj({}), run: () => call('/board_list'),
	},
	{
		name: 'board_add',
		description: 'Ajoute une carte dans « À faire » du tableau de tâches. À utiliser quand tu découvres un travail à faire plus tard, ou quand l\'utilisateur te demande de découper un chantier en tâches.',
		inputSchema: obj({ title: { type: 'string' }, detail: { type: 'string', description: 'Ce qu\'un autre agent, sans contexte, doit savoir pour la faire' } }, ['title']),
		run: a => call('/board_add', { title: a.title, detail: a.detail }),
	},
	{
		name: 'board_take',
		description: 'Prends une carte de « À faire » : elle passe dans « En cours » à ton nom et tu en reçois le titre et le détail. Sans id, la première carte de la colonne. Fais cette tâche et elle seule, puis appelle board_move.',
		inputSchema: obj({ id: { type: 'string' } }), run: a => call('/board_take', { id: a.id }),
	},
	{
		name: 'board_move',
		description: 'Déplace une carte. Quand tu as fini une tâche, passe-la dans « review » avec summary : ce que tu as fait, les fichiers touchés, ce qui reste à vérifier. Tu ne peux pas la passer dans « done » : c\'est l\'utilisateur qui valide.',
		inputSchema: obj({ id: { type: 'string' }, column: { type: 'string', enum: ['todo', 'doing', 'review'] }, summary: { type: 'string' } }, ['id', 'column']),
		run: a => call('/board_move', { id: a.id, column: a.column, summary: a.summary }),
	},
	{
		name: 'env_names',
		description: 'Les noms des variables d\'environnement du projet, par fichier (.env, .env.local…). Jamais les valeurs : elles restent chez l\'utilisateur.',
		inputSchema: obj({}), run: () => call('/env_names'),
	},
	{
		name: 'env_ask',
		description: 'Demande à l\'utilisateur de remplir une variable d\'environnement que tu ne peux pas voir (clé d\'API, mot de passe, adresse de service). La page des variables d\'Orbit s\'ouvre avec ta demande. Continue ensuite sans attendre la valeur : utilise le nom dans le code.',
		inputSchema: obj({ key: { type: 'string', description: 'Nom de la variable, par exemple STRIPE_SECRET_KEY' }, why: { type: 'string', description: 'À quoi elle sert et où la trouver' } }, ['key']),
		run: a => call('/env_ask', { key: a.key, why: a.why }),
	},
	{
		name: 'supabase_state',
		description: 'Le projet Supabase relié à ce projet dans Orbit : son identifiant, l\'adresse de son tableau de bord, ses tables (colonnes, nombre de lignes, protection RLS), le nombre de comptes et d\'espaces de stockage. Orbit garde l\'accès : tu n\'as besoin d\'aucune clé.',
		inputSchema: obj({}), run: () => call('/supabase_state', {}, 60000),
	},
	{
		name: 'supabase_sql',
		description: 'Exécute du SQL sur la base Supabase du projet, avec l\'accès d\'Orbit. Donne query, ou file (un fichier .sql du projet, à préférer pour une migration longue). Sans write, la requête tourne en lecture seule et répond tout de suite : sers-t\'en pour vérifier, compter, contrôler. Avec write=true (create, alter, insert, update, delete, policies…), Orbit montre le SQL à l\'utilisateur, qui accepte ou refuse : préviens-le d\'une phrase avant, et n\'envoie qu\'un appel par lot cohérent. N\'écris jamais à la place « exécute ce SQL à la main » : fais-le avec cet outil.',
		inputSchema: obj({ query: { type: 'string' }, file, write: { type: 'boolean', description: 'true si la requête modifie la base' } }),
		run: a => call('/supabase_sql', { query: a.query, file: a.file, write: a.write ? 'true' : undefined }, a.write ? 10 * 60 * 1000 : 60000),
	},
	{
		name: 'supabase_auth_urls',
		description: 'Les adresses vers lesquelles Supabase accepte de renvoyer après une connexion ou un lien de mot de passe oublié (Authentication, URL Configuration). Sans add : la liste actuelle et l\'adresse du site. Avec add : ajoute ces adresses complètes, après accord de l\'utilisateur dans Orbit.',
		inputSchema: obj({ add: { type: 'array', items: { type: 'string' } } }),
		run: a => call('/supabase_auth_urls', { add: a.add || [] }, 10 * 60 * 1000),
	},
	{
		name: 'verify',
		description: 'Lance les contrôles du projet (types, lint, tests : ceux de .orbit/checks.json, sinon ceux trouvés dans le projet) et te rend le résultat de chacun, avec la sortie de ceux qui échouent. À appeler après un changement de code, avant de dire que c\'est fini, plutôt que de deviner les commandes.',
		inputSchema: obj({}), run: () => call('/verify', {}, 30 * 60 * 1000),
	},
	{
		name: 'checkpoint',
		description: 'Crée un point de sauvegarde du projet dans la machine à remonter le temps d\'Orbit, avec un nom. À poser avant un changement risqué ou large (refonte, suppression, migration) : l\'utilisateur pourra y revenir d\'un clic.',
		inputSchema: obj({ name: { type: 'string' } }), run: a => call('/checkpoint', { name: a.name }, 120000),
	},
	{
		name: 'queue_list',
		description: 'La file de nuit du projet : les tâches en attente, celles qui ont tourné, leur résultat et les fichiers qu\'elles ont changés.',
		inputSchema: obj({}), run: () => call('/queue_list'),
	},
	{
		name: 'queue_add',
		description: 'Ajoute une tâche à la file de nuit : un autre agent, sans aucun contexte de cette conversation, la fera plus tard. Écris une consigne complète. Un paragraphe = une tâche. La file ne démarre pas : c\'est l\'utilisateur qui la lance.',
		inputSchema: obj({ prompt: { type: 'string' } }, ['prompt']), run: a => call('/queue_add', { prompt: a.prompt }),
	},
	{
		name: 'vercel_state',
		description: 'Où en est la mise en ligne du projet sur Vercel : compte connecté, projet relié, branche et fichiers non enregistrés, domaines, et les derniers déploiements avec leur état (READY, ERROR, BUILDING…).',
		inputSchema: obj({}), run: () => call('/vercel_state', {}, 120000),
	},
	{
		name: 'vercel_publish',
		description: 'Met le projet en ligne sur Vercel par Orbit, comme le bouton de la page Vercel : enregistre et envoie les changements, relie le projet s\'il ne l\'est pas, déploie et suit la construction. production=true remplace le site public, après accord de l\'utilisateur dans Orbit ; sans, c\'est un aperçu en ligne. Rend l\'adresse, ou la fin du journal en cas d\'échec. N\'utilise pas la commande vercel à la main.',
		inputSchema: obj({ production: { type: 'boolean' } }), run: a => call('/vercel_publish', { production: a.production ? 'true' : undefined }, 40 * 60 * 1000),
	},
	{
		name: 'vercel_logs',
		description: 'Le journal de construction d\'un déploiement Vercel (id donné par vercel_state), le plus récent par défaut. Pour comprendre un déploiement en échec.',
		inputSchema: obj({ id: { type: 'string' } }), run: a => call('/vercel_logs', { id: a.id }, 60000),
	},
	{
		name: 'stripe_state',
		description: 'Le compte Stripe relié à Orbit : mode test ou réel, solde, produits avec leur prix, leur identifiant et leur lien de paiement, derniers paiements. Orbit garde la clé : tu ne la vois pas.',
		inputSchema: obj({}), run: () => call('/stripe_state', {}, 60000),
	},
	{
		name: 'stripe_create_product',
		description: 'Crée un produit Stripe, son prix et son lien de paiement, après accord de l\'utilisateur dans Orbit. price en unités (9.9 pour 9,90). interval month ou year pour un abonnement, rien pour un paiement unique. Rend les identifiants du produit et du prix, et le lien de paiement.',
		inputSchema: obj({ name: { type: 'string' }, price: { type: 'number' }, currency: { type: 'string', enum: ['eur', 'usd', 'gbp', 'chf', 'cad'] }, interval: { type: 'string', enum: ['month', 'year'] }, description: { type: 'string' } }, ['name', 'price']), run: a => call('/stripe_create_product', { name: a.name, price: a.price, currency: a.currency, interval: a.interval, description: a.description }, 10 * 60 * 1000),
	},
	{
		name: 'find_commands',
		description: 'Cherche des commandes d\'Orbit/VS Code dont l\'identifiant contient tous les mots donnés (ex. « terminal split », « zen »).',
		inputSchema: obj({ query: { type: 'string' } }, ['query']), run: a => call('/find_commands', { query: a.query }),
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
				return reply({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orbit', version: '1.0.0' } } });
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
					return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 1) }] } });
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
