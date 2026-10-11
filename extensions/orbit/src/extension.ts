/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { AgentActivity } from './agentActivity';
import { AgentTracker } from './agentTracker';
import { ChatViewProvider } from './chatView';
import { ClaudeTerminals } from './claudeTerminals';
import { CommunityPanel } from './community';
import { DatabasePanel } from './database';
import { FollowAgent } from './followAgent';
import { Conductor } from './conductor';
import { SessionsView, SessionStore, timeAgo } from './sessions';
import { keys, models, workspaceRoot } from './config';
import { InlineEditController } from './inlineEdit';
import { LivePreview } from './livePreview';
import { MapPanel } from './mapPanel';
import { OrbitControl } from './orbitControl';
import { registerFixWithClaude } from './fixWithClaude';
import { registerImagePaste } from './pasteImage';
import { Recipes } from './recipes';
import { registerSmartCommit } from './smartCommit';
import { Verifier } from './verify';
import { applyPreset, LAYOUT_PRESETS, StudioPanel } from './studio';
import { Team } from './team';
import { TimeMachine } from './timeMachine';
import { GameStudio, setUnityExtensionPath } from './unity';
import { HiggsfieldStudio } from './higgsfield';
import { ASSISTANTS, assistant, assistantChosen, assistantId, chooseAssistant } from './assistant';
import { Tour } from './tour';
import { EnvVars } from './envVars';
import { Board } from './board';
import { VisualCheck } from './visualCheck';
import { Store } from './store';
import { Figma } from './figma';
import { Supabase } from './supabase';
import { Stripe } from './stripe';
import { deliverToAgent } from './deliver';
import { installHooks } from './agentTracker';
import { registerDocumentViewers } from './documents';
import { registerFontViewer } from './fonts';
import { Updater } from './update';
import { RepoProjects } from './repos';
import { CodexTracker } from './codexTracker';
import { installBranding } from './brand';
import * as fs from 'fs';
import { NightQueue } from './nightQueue';
import { Phone } from './phone';
import { VercelPublisher } from './vercel';
import { UsageMonitor } from './usage';

const WELCOME_KEY = 'orbit.welcomed.v3';
/** The guided tour contributed in package.json (`walkthroughs`). */
const TUTORIAL_ID = 'vscode.orbit#orbit.tour';

/** Claude Code's Shift+Tab cycle of permission modes. */
const MODE_CYCLE = ['default', 'acceptEdits', 'plan', 'auto'];
const MODE_LABELS: Record<string, string> = { default: 'par défaut', acceptEdits: 'modifications acceptées', plan: 'plan', auto: 'auto' };
/** Modes Orbit just set with Shift+Tab, until Claude reports its mode again through a hook. */
const assumedModes = new Map<string, { mode: string; at: number }>();

/**
 * Puts every Claude terminal of the window in one permission mode, on the user's click:
 * Claude Code only changes mode with Shift+Tab, so each terminal gets the presses it needs
 * from the mode its hooks last reported.
 */
async function setModeEverywhere(claude: ClaudeTerminals, tracker: AgentTracker, target: string): Promise<void> {
	if (assistantId() === 'chatgpt') {
		let restarted = 0;
		let already = 0;
		const skipped: string[] = [];
		for (const terminal of claude.list()) {
			const state = tracker.get(claude.keyOf(terminal));
			if (claude.launchModeOf(terminal) === target) {
				already++;
			} else if (state?.status === 'running' || state?.status === 'waiting') {
				skipped.push(`${terminal.name} (${state.status === 'running' ? 'travaille' : 'attend ton accord'})`);
			} else {
				// Shift+Tab means something else in Codex (it switches to plan): restart on the same conversation instead.
				const name = terminal.name;
				terminal.dispose();
				claude.create({ label: name, permissionMode: target, flags: state?.sessionId ? ['--resume', state.sessionId] : [], preserveFocus: true });
				restarted++;
			}
		}
		const parts = [
			restarted ? `${restarted} ${restarted > 1 ? 'terminaux relancés' : 'terminal relancé'} en mode ${MODE_LABELS[target]}, sur la même discussion` : '',
			already ? `${already} déjà en mode ${MODE_LABELS[target]}` : '',
			skipped.length ? `non changé${skipped.length > 1 ? 's' : ''} : ${skipped.join(', ')}` : '',
		].filter(Boolean);
		vscode.window.showInformationMessage(parts.length ? `${parts.join(' · ')}.` : 'Aucun terminal ChatGPT ouvert.');
		return;
	}
	const wanted = MODE_CYCLE.indexOf(target);
	let changed = 0;
	let already = 0;
	const skipped: string[] = [];
	for (const terminal of claude.list()) {
		const key = claude.keyOf(terminal);
		const state = tracker.get(key);
		const assumed = key ? assumedModes.get(key) : undefined;
		// A hook that spoke after our last change knows better than our assumption.
		const mode = assumed && (!state?.permissionMode || assumed.at >= state.updatedAt) ? assumed.mode : state?.permissionMode ?? claude.launchModeOf(terminal);
		const current = mode ? MODE_CYCLE.indexOf(mode) : -1;
		if (!key || current < 0) {
			skipped.push(`${terminal.name} (mode inconnu : envoie-lui un premier message)`);
			continue;
		}
		if (state?.status === 'waiting') {
			skipped.push(`${terminal.name} (attend ton accord)`);
			continue;
		}
		if (current === wanted) {
			already++;
			continue;
		}
		const presses = (wanted - current + MODE_CYCLE.length) % MODE_CYCLE.length;
		for (let i = 0; i < presses; i++) {
			terminal.sendText('\x1b[Z', false);
			await new Promise(resolve => setTimeout(resolve, 140));
		}
		assumedModes.set(key, { mode: target, at: Date.now() });
		changed++;
	}
	const parts = [
		changed ? `${changed} ${changed > 1 ? 'terminaux' : 'terminal'} Claude passé${changed > 1 ? 's' : ''} en mode ${MODE_LABELS[target]}` : '',
		already ? `${already} déjà en mode ${MODE_LABELS[target]}` : '',
		skipped.length ? `non changé${skipped.length > 1 ? 's' : ''} : ${skipped.join(', ')}` : '',
	].filter(Boolean);
	vscode.window.showInformationMessage(parts.length ? `${parts.join(' · ')}.` : 'Aucun terminal Claude ouvert.');
}

export function activate(context: vscode.ExtensionContext): void {
	setUnityExtensionPath(context.extensionPath);
	const claude = new ClaudeTerminals(context.globalState, context.extensionUri);
	const tracker = new AgentTracker(claude);
	// When Orbit is closed and opened again, its agent terminals come back as bare shells: same
	// name, same history on screen, but the agent is gone and anything typed there would be run by
	// the shell. A terminal whose shell process changed since Orbit last saw it is such a ghost.
	const runsSomething = (pid: number) => new Promise<boolean>(resolve => {
		// When the question cannot be answered, the agent is assumed to be there: nothing is marked.
		if (process.platform === 'win32') {
			execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").Count`], { windowsHide: true, timeout: 20000 }, (err, out) => resolve(err ? true : Number(String(out).trim()) > 0));
		} else {
			execFile('pgrep', ['-P', String(pid)], { timeout: 10000 }, (err, out) => resolve(err && (err as NodeJS.ErrnoException).code === 'ENOENT' ? true : String(out).trim().length > 0));
		}
	});
	// Kept: what opens when a project opens waits for this answer (see `setReopening`).
	const ghostsKnown = Promise.all(vscode.window.terminals.map(terminal => Promise.resolve(terminal.processId).then(async pid => {
		const key = claude.isClaude(terminal) ? claude.keyOf(terminal) : undefined;
		if (key && pid && !tracker.get(key)?.ended && !await runsSomething(pid)) {
			tracker.markEnded(key);
		}
	}).catch(() => undefined)));
	claude.setWaitingProvider(t => tracker.get(claude.keyOf(t))?.status === 'waiting');
	// Before any Claude starts: it writes the MCP config every Claude terminal receives.
	const control = new OrbitControl(context.extensionPath, claude, tracker);
	const recipes = new Recipes(claude);
	const verifier = new Verifier(tracker, claude);
	context.subscriptions.push(control, registerImagePaste(), registerSmartCommit(), verifier, ...registerFixWithClaude(claude), recipes, ...recipes.register());
	const store = new SessionStore(context.globalState);
	const sessionsView = new SessionsView(store, tracker);
	const chat = new ChatViewProvider(context.extensionUri, claude, tracker);
	const studio = new StudioPanel(context.extensionUri);
	const inline = new InlineEditController();
	const usage = new UsageMonitor();
	const activity = new AgentActivity(tracker, claude);
	const map = new MapPanel(context.extensionUri, activity, claude);
	const team = new Team(context, claude, tracker, activity);
	const community = new CommunityPanel(context.extensionUri, claude);
	// An empty window becomes a workspace without a reload, so running agents keep going.
	const follow = new FollowAgent(context.extensionUri, tracker, claude, dir => vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: vscode.Uri.file(dir) }));
	tracker.setRoleProvider(key => team.roleOf(key)?.role);
	activity.setRoleProvider(key => team.roleOf(key));
	const timeMachine = new TimeMachine(tracker, claude);
	const conductor = new Conductor(claude, tracker);
	const preview = new LivePreview(context.extensionUri, claude, tracker);
	const database = new DatabasePanel(context, claude);
	const studio3d = new GameStudio(context.extensionUri, claude, tracker);
	const higgsfield = new HiggsfieldStudio(context.extensionUri, claude, tracker);
	// With ChatGPT, the agents' activity is read from Codex's own conversation logs.
	const codex = new CodexTracker((key, event) => tracker.ingest(key, event), key => !!claude.byKey(key));
	const phone = new Phone(context, claude, tracker);
	const queue = new NightQueue(context.extensionUri, claude, tracker, phone);
	const vercel = new VercelPublisher(context, claude, tracker);
	// Pages hand their messages to a live agent, or start one: never to a bare shell.
	const tellAgent = (message: string) => !!deliverToAgent(claude, tracker, message);
	// For the test bench: what a page's message would find, and optionally the delivery itself.
	context.subscriptions.push(vscode.commands.registerCommand('_orbit.debug.tell', (message?: string) => {
		const before = claude.list().map(t => ({ name: t.name, key: claude.keyOf(t), state: tracker.get(claude.keyOf(t)) && { status: tracker.get(claude.keyOf(t))?.status, ended: tracker.get(claude.keyOf(t))?.ended } }));
		const current = claude.current()?.name;
		const active = vscode.window.activeTerminal?.name;
		const went = message ? deliverToAgent(claude, tracker, message)?.name : undefined;
		return { before, current, active, all: vscode.window.terminals.map(t => t.name), went, after: claude.list().map(t => t.name) };
	}));
	const envVars = new EnvVars(context, tellAgent);
	const board = new Board(context, claude, tracker);
	const visual = new VisualCheck(context, tracker, claude);
	const skills = new Store(context, () => vscode.commands.executeCommand('orbit.recipes.refresh'));
	const figma = new Figma(context, skills, tellAgent);
	const supabase = new Supabase(context, tellAgent);
	const stripe = new Stripe(context, tellAgent);
	control.desk = {
		boardList: () => board.list(),
		boardAdd: (title, detail) => {
			if (!title.trim()) {
				throw new Error('Il faut un titre.');
			}
			const card = board.add(title.trim(), detail.trim());
			return { id: card.id, title: card.title };
		},
		boardTake: (id, terminal) => board.take(id, terminal),
		boardMove: (id, column, summary) => board.move(id, column, summary),
		envNames: () => envVars.names(),
		envAsk: (key, why) => envVars.ask(key, why),
		supabaseState: () => supabase.agentState(),
		supabaseSql: (query, file, write) => supabase.agentSql(query, file, write),
		supabaseAuthUrls: add => supabase.agentAuthUrls(add),
		verify: root => verifier.agentRun(root),
		checkpoint: (root, name) => timeMachine.agentSnapshot(root, name),
		queueList: () => queue.agentList(),
		queueAdd: prompt => queue.agentAdd(prompt),
		vercelState: () => vercel.agentState(),
		vercelPublish: production => vercel.agentPublish(production),
		vercelLogs: id => vercel.agentLogs(id),
		stripeState: () => stripe.agentState(),
		preview: command => preview.agent(command),
		previewScreenshot: () => preview.agentScreenshot(),
		stripeCreate: (name, price, currency, interval, description) => stripe.agentCreate(name, price, currency, interval, description),
	};
	// Everything the project is plugged into, behind one button.
	// A service is shown by its own logo, anything else by an icon that says what it is.
	interface Tool { label: string; detail: string; command: string; image?: string; icon?: string; keys?: string }
	const logo = (file: string) => path.join(context.extensionPath, 'media', file);
	const toolGroups: { title: string; items: Tool[] }[] = [
		{
			title: 'Travail', items: [
				{ label: 'Tableau de tâches', detail: 'Des cartes que tes agents prennent et traitent', command: 'orbit.board.show', icon: 'checklist' },
				{ label: 'File de nuit', detail: 'Enchaîner des tâches et lire le rapport', command: 'orbit.queue.show', icon: 'watch', keys: 'Ctrl+Alt+Q' },
				{ label: 'Relecture visuelle', detail: 'La page avant et après, relue par l\'agent', command: 'orbit.visual.show', icon: 'eye' },
				{ label: 'Vue vivante', detail: 'L\'interface en direct, à côté du code', command: 'orbit.preview.show', icon: 'browser', keys: 'Ctrl+Alt+V' },
			],
		},
		{
			title: 'Services', items: [
				{ label: 'Vercel', detail: 'Mettre le projet en ligne', command: 'orbit.vercel.show', image: logo('vercel.svg') },
				{ label: 'Supabase', detail: 'Base de données, comptes, stockage', command: 'orbit.supabase.show', image: logo('supabase.svg') },
				{ label: 'Tableau de bord Supabase', detail: 'Le projet de ce dossier, dans le navigateur', command: 'orbit.supabase.dashboard', image: logo('supabase.svg') },
				{ label: 'Stripe', detail: 'Paiements du projet', command: 'orbit.stripe.show', image: logo('stripe.svg') },
				{ label: 'Base de données locale', detail: 'SQLite et PostgreSQL', command: 'orbit.database.show', icon: 'database', keys: 'Ctrl+Alt+D' },
				{ label: 'Variables d\'environnement', detail: 'Les fichiers .env, masqués aux agents', command: 'orbit.env.show', icon: 'key' },
			],
		},
		{
			title: 'Création', items: [
				{ label: 'Figma vers code', detail: 'Coller un lien, l\'agent construit l\'écran', command: 'orbit.figma.show', image: logo('figma.svg') },
				{ label: 'Higgsfield', detail: 'Images, vidéos, 3D et sons', command: 'orbit.higgsfield.show', image: logo('higgsfield.png'), keys: 'Ctrl+Alt+H' },
				{ label: 'Magasin de compétences', detail: 'Connecteurs et recettes en un clic', command: 'orbit.store.show', icon: 'extensions' },
			],
		},
	];
	// The whole list with its search field (Ctrl+Alt+K).
	const tools = vscode.commands.registerCommand('orbit.tools', async () => {
		const items: (vscode.QuickPickItem & { command: string })[] = toolGroups.flatMap(group => [
			{ label: group.title, kind: vscode.QuickPickItemKind.Separator, command: '' },
			...group.items.map(tool => ({ label: tool.image ? tool.label : `$(${tool.icon}) ${tool.label}`, description: tool.detail, iconPath: tool.image ? vscode.Uri.file(tool.image) : undefined, command: tool.command })),
		]);
		const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Outils du projet', matchOnDescription: true });
		if (picked?.command) {
			await vscode.commands.executeCommand(picked.command);
		}
	});
	// The button of the terminal bar: the same tools in a menu that drops under it. The menu is
	// drawn by Orbit's core; an Orbit whose core does not have it yet shows the list instead.
	vscode.commands.getCommands(false).then(all => vscode.commands.executeCommand('setContext', 'orbit.hasMenu', all.includes('_orbit.menu')));
	const toolsMenu = vscode.commands.registerCommand('orbit.tools.menu', async () => {
		const picked = await vscode.commands.executeCommand<string | undefined>('_orbit.menu', {
			anchor: 'Outils du projet',
			groups: toolGroups.map(group => ({ title: group.title, items: group.items.map(tool => ({ id: tool.command, label: tool.label, detail: tool.detail, image: tool.image, icon: tool.icon, keys: tool.keys })) })),
		}).then(undefined, () => 'orbit.tools');
		if (picked) {
			await vscode.commands.executeCommand(picked);
		}
	});
	context.subscriptions.push(...registerDocumentViewers(context, tellAgent));
	context.subscriptions.push(registerFontViewer(context));
	const updater = new Updater(context);
	context.subscriptions.push(updater, vscode.commands.registerCommand('orbit.update.check', () => updater.check(true)));
	context.subscriptions.push(envVars, board, visual, skills, figma, supabase, stripe, tools, toolsMenu, vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('orbit.env.hideFromAgent') && installHooks()));

	const pickModel = async () => {
		const target = claude.current();
		const pick = await vscode.window.showQuickPick(
			models().map(m => ({ label: m.label, description: m.id, id: m.id })),
			{ title: 'Modèle de Claude', placeHolder: target ? `Appliqué tout de suite à « ${target.name} » — Claude Code le garde ensuite par défaut` : 'Aucun terminal Claude ouvert : ce sera le modèle des prochains' });
		if (!pick) {
			return;
		}
		if (!target) {
			await vscode.workspace.getConfiguration('orbit').update(assistantId() === 'chatgpt' ? 'chatgpt.model' : 'claude.model', pick.id, vscode.ConfigurationTarget.Global);
			return;
		}
		if (tracker.get(claude.keyOf(target))?.status === 'waiting') {
			// Typing now would answer the permission prompt instead.
			vscode.window.showWarningMessage('Claude attend une autorisation dans ce terminal : réponds-lui d\'abord, puis change de modèle.');
			return;
		}
		claude.sendCommand(target, `/model ${pick.id || 'default'}`);
	};

	const renameSession = async (sessionId: string | undefined, terminal?: vscode.Terminal) => {
		if (!sessionId) {
			vscode.window.showInformationMessage('Cette discussion n\'a pas encore commencé : envoie un premier message à Claude.');
			return;
		}
		const current = store.get(sessionId);
		const name = await vscode.window.showInputBox({ title: 'Renommer la discussion', value: current?.title ?? '', prompt: 'Laisse vide pour revenir au titre automatique' });
		if (name === undefined) {
			return;
		}
		await store.rename(sessionId, name);
		const live = terminal ?? (() => {
			const state = tracker.findBySession(sessionId);
			return state ? claude.byKey(state.key) : undefined;
		})();
		if (live) {
			await claude.rename(live, name.trim() || 'Claude');
		}
		sessionsView.refreshSoon();
	};
	const sessionOfTerminal = (t: vscode.Terminal | undefined) => {
		if (!t) {
			return undefined;
		}
		return tracker.get(claude.keyOf(t))?.sessionId ?? claude.sessionIdFor(t);
	};

	// With another assistant than Claude, Orbit's messages name it; the commands' titles are worded by the core from this marker.
	if (assistantId() !== 'claude') {
		installBranding();
	}
	const writeMarker = () => {
		try {
			fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
			const file = path.join(context.globalStorageUri.fsPath, 'assistant');
			if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== assistantId()) {
				fs.writeFileSync(file, assistantId());
			}
		} catch (err) {
			console.error('[orbit] could not record the assistant', err);
		}
	};
	writeMarker();
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('orbit.assistant') && writeMarker()));
	/**
	 * One assistant at a time: the terminals of the previous one are closed, then the window
	 * reloads so every title, logo and page follows, and a fresh agent starts.
	 */
	const afterSwitch = async (before: string): Promise<void> => {
		writeMarker();
		const working = claude.list().filter(t => tracker.get(claude.keyOf(t))?.status === 'running').length;
		if (working) {
			const go = 'Fermer et continuer';
			const answer = await vscode.window.showWarningMessage(`${working} agent${working > 1 ? 's travaillent' : ' travaille'} encore`, { modal: true, detail: `Passer à ${assistant().name} ferme les terminaux d'agent ouverts et interrompt ce travail.` }, go);
			if (answer !== go) {
				await vscode.workspace.getConfiguration('orbit').update('assistant', before, vscode.ConfigurationTarget.Global);
				writeMarker();
				return;
			}
		}
		claude.closeOtherAssistants();
		await new Promise(resolve => setTimeout(resolve, 400));
		vscode.commands.executeCommand('workbench.action.reloadWindow');
	};
	// The button of the status bar: the assistant in use, one click for the other.
	const switcher = vscode.window.createStatusBarItem('orbit.assistant', vscode.StatusBarAlignment.Right, 1001);
	const other = ASSISTANTS.find(a => a.id !== assistantId())!;
	switcher.name = 'Changer d\'IA';
	switcher.text = `$(${assistant().icon}) $(arrow-swap) $(${other.icon})`;
	switcher.tooltip = `Tu travailles avec ${assistant().name}. Cliquer pour passer à ${other.name}.`;
	switcher.command = 'orbit.assistant.toggle';
	switcher.show();
	context.subscriptions.push(switcher);
	const tour = new Tour(context);
	context.subscriptions.push(tour);
	// First launch: which AI does this user work with? Asked once, changeable at any time. The
	// discovery circuit follows, once the choice is made (it names the AI at every stop).
	if (!assistantChosen() && !context.globalState.get<boolean>('orbit.assistant.asked')) {
		context.globalState.update('orbit.assistant.asked', true);
		setTimeout(() => vscode.commands.executeCommand('orbit.assistant.choose'), 2500);
	} else {
		setTimeout(() => tour.offerOnce(), 6000);
	}
	context.subscriptions.push(
		claude, tracker, sessionsView, chat, studio, inline, usage, activity, map, timeMachine, conductor, preview, database, studio3d, higgsfield, codex, phone, queue, vercel, team, follow, community,
		claude.onDidStart(started => assistantId() === 'chatgpt' && codex.expect(started.key, started.cwd)),
		vscode.commands.registerCommand('orbit.assistant.choose', async () => {
			const before = assistantId();
			const picked = await chooseAssistant();
			if (picked && picked !== before) {
				await afterSwitch(before);
			} else if (picked) {
				tour.offerOnce();
			}
		}),
		// One click: straight to the other assistant, no list.
		vscode.commands.registerCommand('orbit.assistant.toggle', async () => {
			const before = assistantId();
			await vscode.workspace.getConfiguration('orbit').update('assistant', before === 'claude' ? 'chatgpt' : 'claude', vscode.ConfigurationTarget.Global);
			await afterSwitch(before);
		}),
		vscode.commands.registerCommand('orbit.community.show', () => community.show('discover')),
		vscode.commands.registerCommand('orbit.community.share', () => community.show('share')),
		vscode.commands.registerCommand('orbit.claude.quickProject', () => claude.quickProject()),
		vscode.window.registerTreeDataProvider('orbit.team', team),
		vscode.commands.registerCommand('orbit.team.start', () => team.startLead()),
		vscode.commands.registerCommand('orbit.team.show', (terminal?: vscode.Terminal) => terminal?.show()),
		vscode.commands.registerCommand('orbit.team.message', async (terminal?: vscode.Terminal) => {
			if (!terminal) {
				return;
			}
			const text = await vscode.window.showInputBox({ title: `Message à ${terminal.name}`, placeHolder: 'Ce que l\'agent doit faire ou corriger…', ignoreFocusOut: true });
			if (text?.trim()) {
				claude.sendMessage(terminal, text.trim());
			}
		}),
		vscode.commands.registerCommand('orbit.team.stop', (terminal?: vscode.Terminal) => terminal?.sendText(String.fromCharCode(27), false)),
		vscode.commands.registerCommand('orbit.team.close', (terminal?: vscode.Terminal) => terminal?.dispose()),
		vscode.commands.registerCommand('orbit.unity.show', () => studio3d.show()),
		vscode.commands.registerCommand('orbit.higgsfield.show', () => higgsfield.show()),
		vscode.commands.registerCommand('orbit.higgsfield.animate', (uri?: vscode.Uri) => higgsfield.show(uri, 'video')),
		vscode.commands.registerCommand('orbit.higgsfield.vary', (uri?: vscode.Uri) => higgsfield.show(uri, 'image')),
		vscode.commands.registerCommand('orbit.database.show', () => database.show()),
		vscode.commands.registerCommand('orbit.preview.show', (address?: string) => preview.show(address)),
		vscode.window.registerTreeDataProvider('orbit.timeline', timeMachine),
		vscode.commands.registerCommand('orbit.time.rewind', node => timeMachine.rewind(node)),
		vscode.commands.registerCommand('orbit.time.revertFile', node => timeMachine.revertFile(node)),
		vscode.commands.registerCommand('orbit.time.comment', node => timeMachine.comment(node)),
		vscode.commands.registerCommand('orbit.time.diff', node => timeMachine.diff(node)),
		vscode.commands.registerCommand('orbit.time.refresh', () => timeMachine.refresh()),
		vscode.commands.registerCommand('orbit.time.snapshot', () => timeMachine.snapshotNow()),
		vscode.commands.registerCommand('orbit.conductor.start', () => conductor.start()),
		vscode.commands.registerCommand('orbit.conductor.merge', () => conductor.merge()),
		vscode.commands.registerCommand('orbit.map.show', () => map.show()),
		vscode.commands.registerCommand('orbit.tutorial', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', TUTORIAL_ID, false)),
		tracker.onDidChange(state => state.status === 'done' && usage.refreshSoon()),
		vscode.commands.registerCommand('orbit.usage.show', () => usage.show()),
		vscode.commands.registerCommand('orbit.usage.openSettings', () => usage.openSettings()),
		vscode.commands.registerCommand('orbit.claude.pickModel', pickModel),
		vscode.commands.registerCommand('orbit.claude.autoModeAll', () => setModeEverywhere(claude, tracker, 'auto')),
		claude.onDidClose(key => tracker.forget(key)),
		vscode.window.registerTreeDataProvider('orbit.sessions', sessionsView),
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, { webviewOptions: { retainContextWhenHidden: true } }),

		vscode.commands.registerCommand('orbit.chat.show', () => chat.show()),
		vscode.commands.registerCommand('orbit.chat.showTerminal', () => chat.showTerminal()),
		vscode.commands.registerCommand('orbit.chat.toggle', () => chat.toggle()),

		vscode.commands.registerCommand('orbit.sessions.open', (id: string) => {
			store.bringHome(id);
			const state = tracker.findBySession(id);
			claude.resume(id, store.get(id)?.customName, state ? claude.byKey(state.key) : undefined);
		}),
		vscode.commands.registerCommand('orbit.sessions.rename', (node?: { session?: { id: string } }) => renameSession(node?.session?.id)),
		vscode.commands.registerCommand('orbit.sessions.renameCurrent', () => {
			const t = claude.current();
			return renameSession(sessionOfTerminal(t), t);
		}),
		vscode.commands.registerCommand('orbit.sessions.refresh', () => sessionsView.refreshSoon()),
		vscode.commands.registerCommand('orbit.sessions.search', async () => {
			const sessions = store.list();
			if (!sessions.length) {
				vscode.window.showInformationMessage('Aucune discussion Claude dans ce projet pour l\'instant.');
				return;
			}
			const pick = await vscode.window.showQuickPick(sessions.map(s => {
				const live = tracker.findBySession(s.id);
				return {
					label: `${live ? '$(sparkle) ' : '$(comment-discussion) '}${s.title}`,
					description: live ? 'ouverte' : timeAgo(s.modified),
					detail: s.lastPrompt.slice(0, 160),
					id: s.id,
				};
			}), { title: 'Discussions récentes', placeHolder: 'Rechercher une discussion (titre ou contenu)…', matchOnDescription: true, matchOnDetail: true });
			if (pick) {
				await vscode.commands.executeCommand('orbit.sessions.open', pick.id);
			}
		}),

		vscode.commands.registerCommand('orbit.claude.focus', () => claude.focus()),
		vscode.commands.registerCommand('orbit.claude.new', () => claude.start()),
		vscode.commands.registerCommand('orbit.claude.newProject', () => claude.newProject()),
		vscode.commands.registerCommand('orbit.claude.split', () => claude.split()),
		vscode.commands.registerCommand('orbit.claude.inEditor', () => claude.inEditor()),
		vscode.commands.registerCommand('orbit.claude.grid', () => claude.grid()),
		vscode.commands.registerCommand('orbit.claude.worktree', () => claude.worktree()),
		vscode.commands.registerCommand('orbit.claude.withOptions', () => claude.withOptions()),
		vscode.commands.registerCommand('orbit.claude.resume', () => claude.create({ flags: ['--resume'] })),
		vscode.commands.registerCommand('orbit.claude.continue', () => claude.create({ flags: ['--continue'] })),
		vscode.commands.registerCommand('orbit.claude.sendSelection', () => claude.sendSelection()),
		vscode.commands.registerCommand('orbit.claude.broadcast', () => claude.broadcast()),
		vscode.commands.registerCommand('orbit.claude.switch', () => claude.switch()),

		vscode.commands.registerCommand('orbit.inlineEdit', () => inline.run()),
		vscode.commands.registerCommand('orbit.acceptInlineEdit', () => inline.accept()),
		vscode.commands.registerCommand('orbit.rejectInlineEdit', () => inline.reject()),
		vscode.commands.registerCommand('orbit.inlineEditDiff', () => inline.diff()),
		vscode.commands.registerCommand('orbit.inlineEditRefine', () => inline.refine()),

		vscode.commands.registerCommand('orbit.openStudio', () => studio.show()),
		vscode.commands.registerCommand('orbit.applyLayoutPreset', async () => {
			const pick = await vscode.window.showQuickPick(
				Object.entries(LAYOUT_PRESETS).map(([id, p]) => ({ label: p.label, detail: p.detail, id })),
				{ title: 'Disposition Orbit' });
			if (pick) {
				await applyPreset(pick.id);
			}
		}),
		vscode.commands.registerCommand('orbit.editRules', async () => {
			// Claude Code reads CLAUDE.md natively, so project rules live there.
			const uri = vscode.Uri.file(path.join(workspaceRoot(), 'CLAUDE.md'));
			try {
				await vscode.workspace.fs.stat(uri);
			} catch {
				await vscode.workspace.fs.writeFile(uri, Buffer.from('# Règles du projet pour Claude\n\n- Stack :\n- Conventions de code :\n- À ne jamais faire :\n'));
			}
			await vscode.window.showTextDocument(uri);
		}),
	);

	// The project you are in, always one click away from the next one.
	const project = vscode.window.createStatusBarItem('orbit.project', vscode.StatusBarAlignment.Left, 1000);
	project.name = 'Projet';
	project.text = `$(folder) ${vscode.workspace.workspaceFolders?.[0]?.name ?? 'Aucun projet'} $(chevron-down)`;
	project.tooltip = `Changer de projet ou en créer un (${keys('⌥⌘P', 'Ctrl+Alt+P')})`;
	project.command = 'orbit.project.switch';
	project.show();
	const lead = vscode.window.createStatusBarItem('orbit.team', vscode.StatusBarAlignment.Left, 999);
	lead.name = 'Chef d\'équipe';
	lead.text = `$(${assistant().icon}) Chef d'équipe`;
	lead.tooltip = `Parle à un seul Claude qui crée et pilote les autres agents (${keys('⌥⌘C', 'Ctrl+Alt+C')})`;
	lead.command = 'orbit.team.start';
	lead.show();
	context.subscriptions.push(lead);
	context.subscriptions.push(project, vscode.commands.registerCommand('orbit.project.switch', () => claude.switchProject()));
	const repos = new RepoProjects(dir => claude.openProject(dir));
	context.subscriptions.push(vscode.commands.registerCommand('orbit.project.fromRepo', () => repos.start()));

	claude.setReopening(
		terminal => tracker.get(claude.keyOf(terminal))?.ended === true,
		() => {
			const last = store.latest();
			// Held when the project lived elsewhere: brought under its present path, or it cannot be resumed.
			if (last) {
				store.bringHome(last.id);
			}
			return last && { id: last.id, name: last.customName, title: last.title };
		},
		ghostsKnown,
	);
	claude.autoStart();
	// Whatever the start-up settings, agents of another assistant than the one in use do not stay.
	setTimeout(() => claude.closeOtherAssistants(), 3200);

	// Someone who already went round the circuit at first launch needs no welcome message on top.
	if (!context.globalState.get(WELCOME_KEY) && context.globalState.get('orbit.tour.seen')) {
		context.globalState.update(WELCOME_KEY, true);
		setTimeout(() => {
			vscode.window.showInformationMessage(`Bienvenue dans Orbit — ${keys('⌘L', 'Ctrl+L')} terminal Claude, ${keys('⌥⌘N', 'Ctrl+Alt+N')} nouveau, ${keys('⌥⌘A', 'Ctrl+Alt+A')} organiser les agents, ${keys('⌘K', 'Ctrl+K')} édition inline, ${keys('⌥⌘,', 'Ctrl+Alt+,')} tout personnaliser.`, 'Suivre le tutoriel', 'Ouvrir le Studio')
				.then(choice => choice === 'Suivre le tutoriel' ? vscode.commands.executeCommand('orbit.tutorial') : choice && studio.show());
		}, 2500);
	}
}

export function deactivate(): void { }
