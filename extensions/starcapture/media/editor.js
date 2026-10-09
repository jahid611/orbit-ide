/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// StarCapture's editor page: media bin, viewer, inspector and the multitrack timeline.
// The project lives in the extension (one source of truth, undo with Ctrl+Z); the page
// sends editing steps and redraws whenever a new project arrives.

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { icon } = window.OrbitIcons ?? { icon: () => '' };
	// @ts-ignore
	const { Engine, valueAt, dur, end } = window.StarEngine;

	const TRACK_H = { video: 66, audio: 46, text: 32 };
	const HEADER_W = 156;
	const SNAP_PX = 8;
	const TRANSITIONS = [
		{ id: 'crossfade', label: 'Fondu enchaîné' }, { id: 'dip-black', label: 'Fondu au noir' }, { id: 'dip-white', label: 'Flash blanc' },
		{ id: 'slide-left', label: 'Glisser à gauche' }, { id: 'slide-right', label: 'Glisser à droite' }, { id: 'slide-up', label: 'Glisser vers le haut' },
		{ id: 'zoom-in', label: 'Zoom avant' }, { id: 'zoom-out', label: 'Zoom arrière' },
	];
	const TEXT_PRESETS = [
		{ id: 'youtube', label: 'Mot choc', sample: 'INCROYABLE', css: 'font: 900 22px "Arial Black"; color: #fff; -webkit-text-stroke: 3px #000; paint-order: stroke fill; text-transform: uppercase;' },
		{ id: 'beast', label: 'Énorme jaune', sample: '1 000 000 €', css: 'font: 900 24px Impact; color: #ffe600; -webkit-text-stroke: 3px #000; paint-order: stroke fill;' },
		{ id: 'caption', label: 'Sous-titre karaoké', sample: 'ET LÀ <b>ÇA</b> PART', css: 'font: 900 15px "Arial Black"; color: #fff; -webkit-text-stroke: 2px #000; paint-order: stroke fill;' },
		{ id: 'title', label: 'Titre', sample: 'Chapitre 1', css: 'font: 900 22px "Arial Black"; color: #fff; text-shadow: 0 3px 8px rgba(0,0,0,.6);' },
		{ id: 'subtitle', label: 'Sous-titre sobre', sample: 'Bonjour à tous', css: 'font: 600 15px "Segoe UI"; color: #fff; -webkit-text-stroke: 1px #000; paint-order: stroke fill;' },
		{ id: 'lowerThird', label: 'Bandeau nom', sample: 'Jahid · Créateur', css: 'font: 700 14px "Segoe UI"; color: #fff; background: #8b7bff; padding: 4px 10px; border-radius: 6px;' },
		{ id: 'minimal', label: 'Minimal', sample: 'Quelques jours plus tard', css: 'font: 300 16px "Segoe UI"; color: #fff;' },
		{ id: 'typewriter', label: 'Machine à écrire', sample: 'chargement…', css: 'font: 600 16px Consolas, monospace; color: #5eead4;' },
	];
	const LOOKS = [
		{ id: 'none', label: 'Aucun', color: { brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, vignette: 0 } },
		{ id: 'vivid', label: 'Vif', color: { brightness: .02, contrast: .12, saturation: .35, hue: 0, temperature: .05, vignette: 0 } },
		{ id: 'cinema', label: 'Cinéma', color: { brightness: -.04, contrast: .22, saturation: -.12, hue: 0, temperature: .12, vignette: .45 } },
		{ id: 'warm', label: 'Chaud', color: { brightness: .03, contrast: .05, saturation: .1, hue: 0, temperature: .45, vignette: .1 } },
		{ id: 'cold', label: 'Froid', color: { brightness: 0, contrast: .1, saturation: -.05, hue: 0, temperature: -.45, vignette: .15 } },
		{ id: 'bw', label: 'Noir et blanc', color: { brightness: 0, contrast: .25, saturation: -1, hue: 0, temperature: 0, vignette: .3 } },
		{ id: 'faded', label: 'Délavé', color: { brightness: .08, contrast: -.18, saturation: -.25, hue: 0, temperature: .08, vignette: 0 } },
		{ id: 'punchy', label: 'YouTube', color: { brightness: .04, contrast: .18, saturation: .25, hue: 0, temperature: .03, vignette: .2 } },
	];
	const FONTS = ['Arial Black', 'Impact', 'Segoe UI', 'Segoe UI Black', 'Bahnschrift', 'Arial', 'Verdana', 'Georgia', 'Consolas', 'Comic Sans MS', 'Trebuchet MS'];

	/** @type {any} */
	let project = null;
	/** @type {Record<string, string>} */
	let uris = {};
	/** Media whose file is no longer on the disk. */
	let missing = new Set();
	/** Thumbnails of images, framed on what they actually show. @type {Record<string, string>} */
	const pictures = {};
	/** @type {Record<string, Uint8Array>} */
	const peaks = {};
	/** @type {Record<string, { uri: string, every: number, count: number, width: number, height: number }>} */
	const strips = {};
	/** @type {string[]} */
	let selection = [];
	let tool = 'select';
	let snapping = true;
	let ripple = false;
	let pxPerSec = 40;
	let scrollX = 0;
	let tab = 'media';
	/** Which kind of media the library shows: all, video, image or audio. */
	let mediaFilter = 'all';
	/** The inspector's tab, kept from one clip to the next. */
	let inspTab = '';
	/** The user's library of creations (effects, text styles, overlays), sent by the extension. */
	/** @type {any[]} */
	let creations = [];
	/** @type {[number, number] | null} */
	let inOut = null;
	/** @type {any[] | null} */
	let clipboard = null;
	/** During a drag, the clips as they will be dropped. @type {Map<string, any> | null} */
	let preview = null;

	/** StarCapture's logo, inlined by brand/logos/apply.mjs. */
	const LOGO = 'data:image/png;base64,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';
	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="top">
			<div class="brand"><img class="logo" src="${LOGO}" alt="" /><b>StarCapture</b></div>
			<span class="spacer"></span>
			<input class="name" id="name" spellcheck="false" title="Nom du montage" />
			<span class="spacer"></span>
			<div class="group">
				<button class="tool" id="undo" title="Annuler (Ctrl+Z)">${turn(true)}</button>
				<button class="tool" id="redo" title="Rétablir (Ctrl+Maj+Z)">${turn(false)}</button>
			</div>
			<button class="ghost" id="claude" title="Confier le montage à Claude"><span class="claude-mark"></span> Monter avec Claude</button>
			<button class="primary" id="export" title="Exporter la vidéo (Ctrl+E)">${icon('send')} Exporter</button>
		</header>
		<main class="body">
			<aside class="left">
				<nav class="tabs">
					<button data-tab="media" class="on" title="Médias">${icon('read')}<span>Médias</span></button>
					<button data-tab="text" title="Titres et textes">${tIcon()}<span>Texte</span></button>
					<button data-tab="transitions" title="Transitions">${icon('layout')}<span>Transitions</span></button>
					<button data-tab="effects" title="Effets">${icon('sparkle')}<span>Effets</span></button>
					<button data-tab="ai" title="Parole, sous-titres et IA">${icon('audio')}<span>Sous-titres</span></button>
					<button data-tab="creations" title="Tes effets, styles de texte et filigranes, réutilisables dans tous tes montages">${icon('star')}<span>Créations</span></button>
				</nav>
				<div class="panel" id="panel"></div>
			</aside>
			<section class="viewer">
				<div class="stage" id="stage"><canvas id="screen"></canvas><div class="overlay" id="overlay"></div><div class="drop" id="drop" hidden>Dépose tes fichiers pour les importer</div>
				<div class="empty-state" id="emptyState" hidden>
					<span class="big-star">${starMark()}</span>
					<h2>Commence ton montage</h2>
					<p>Importe tes vidéos, tes sons, ta musique et tes images : ils se posent sur la timeline, prêts à être coupés.</p>
					<div class="empty-actions"><button class="primary" id="emptyImport">${icon('plus')} Importer des médias</button><button class="ghost" id="emptyClaude"><span class="claude-mark"></span> Demander à Claude</button></div>
					<p class="dim small">Ou glisse-les ici depuis l'explorateur d'Orbit.</p>
				</div></div>
				<div class="transport">
					<div class="scrub" id="scrub" title="Aller à ce moment du montage"><span class="rail"><i id="scrubFill"></i></span><b id="scrubKnob"></b><em id="scrubTip" hidden></em></div>
					<span class="clock"><span class="tc" id="tc">00:00:00.00</span><span class="tc dim" id="total">00:00:00.00</span></span>
					<span class="spacer"></span>
					<button class="icon" id="start" title="Début (Origine)">${skip(true)}</button>
					<button class="icon" id="prevFrame" title="Image précédente (←)">${icon('back')}</button>
					<button class="icon big" id="play" title="Lecture (Espace)">${icon('play')}</button>
					<button class="icon" id="nextFrame" title="Image suivante (→)">${icon('forward')}</button>
					<button class="icon" id="endBtn" title="Fin (Fin)">${skip(false)}</button>
					<span class="spacer"></span>
					<span class="listen" title="Volume d'écoute : ne change pas le son de la vidéo exportée"><button class="icon" id="listenMute"></button><input type="range" id="listen" min="0" max="1" step="0.01" /></span>
					<div class="meter"><i id="meter"></i></div>
					<button class="icon" id="cinema" title="Aperçu en plein écran (F)"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
					<select id="quality" title="Qualité de prévisualisation"><option value="1">Pleine</option><option value="0.5">1/2</option><option value="0.25">1/4</option></select>
				</div>
			</section>
			<aside class="right" id="inspector"></aside>
		</main>
		<section class="timeline" id="timeline">
			<div class="tl-resize" id="tlResize" title="Glisser pour agrandir la timeline"></div>
			<div class="tl-bar">
				<button class="tool on" data-tool="select" title="Sélection (V)">${icon('agent')}</button>
				<button class="tool" data-tool="blade" title="Lame : couper un clip (C)">${blade()}</button>
				<span class="sep"></span>
				<button class="icon" id="splitBtn" title="Couper à la tête de lecture (S)">${splitIcon()}</button>
				<button class="icon" id="deleteBtn" title="Supprimer la sélection (Suppr)">${icon('trash')}</button>
				<button class="icon" id="addTrack" title="Ajouter une piste">${icon('plus')}</button>
				<span class="sep"></span>
				<button class="quick" id="quickSilences" title="Retire les silences de la voix, coupes nettes">${waveIcon()}<span>Couper les silences</span></button>
				<button class="quick" id="quickCaptions" title="Sous-titres mot par mot, d'après la parole">${tIcon()}<span>Sous-titres automatiques</span></button>
				<span class="hint" id="tlHint"></span>
				<span class="spacer"></span>
				<button class="toggle on" id="snap" title="Magnétisme (N)">${magnet()}</button>
				<button class="toggle" id="ripple" title="Montage en décalage : supprimer et raccourcir referme les trous (R)">${rippleIcon()}</button>
				<span class="sep"></span>
				<button class="icon" id="zoomOut" title="Dézoomer (-)">${minus()}</button>
				<input type="range" id="zoom" min="0" max="1000" value="500" />
				<button class="icon" id="zoomIn" title="Zoomer (+)">${icon('plus')}</button>
				<button class="icon" id="fit" title="Tout voir (Maj+Z)">${icon('expand')}</button>
			</div>
			<div class="tl-main" id="tlMain">
				<div class="ruler" id="ruler"><canvas id="rulerCanvas"></canvas></div>
				<div class="tracks" id="tracks"></div>
				<div class="playhead" id="playhead"><i></i></div>
				<div class="snapline" id="snapline" hidden></div>
				<div class="marquee" id="marquee" hidden></div>
			</div>
			<div class="tl-scroll"><div id="hscroll"></div></div>
		</section>
		<div class="toast" id="toast" hidden></div>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	const engine = new Engine($('screen'));
	const fps = () => project?.fps || 30;
	const frame = () => 1 / fps();
	const snapTime = (/** @type {number} */ t) => Math.round(t * fps()) / fps();
	const total = () => project ? project.clips.reduce((m, /** @type {any} */ c) => Math.max(m, end(c)), 0) : 0;
	const trackOf = (/** @type {string} */ id) => project.tracks.find((/** @type {any} */ t) => t.id === id);
	const clipOf = (/** @type {string} */ id) => project.clips.find((/** @type {any} */ c) => c.id === id);
	const mediaOf = (/** @type {any} */ c) => c?.media ? project.media.find((/** @type {any} */ m) => m.id === c.media) : undefined;
	const esc = (/** @type {any} */ s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);

	function edit(/** @type {string} */ label, /** @type {any[]} */ ops) {
		vscode.postMessage({ type: 'edit', label, ops });
	}

	/**
	 * The thumbnail of an image. An overlay (a banner, a logo) is a full frame that is almost all
	 * transparent: shown whole it is a speck on a dark tile. It is framed on what it shows instead.
	 */
	function picture(/** @type {any} */ m) {
		if (m.kind !== 'image' || missing.has(m.id) || pictures[m.id] !== undefined || !uris[m.id]) {
			return;
		}
		pictures[m.id] = '';
		const show = (/** @type {string} */ src) => {
			pictures[m.id] = src;
			const img = /** @type {HTMLImageElement | null} */ (document.querySelector(`[data-media="${m.id}"] .thumb img`));
			if (img) {
				img.src = src;
				img.hidden = false;
			}
		};
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.onload = () => {
			try {
				const w = 192;
				const h = Math.max(1, Math.round(w * image.naturalHeight / image.naturalWidth));
				const probe = document.createElement('canvas');
				probe.width = w;
				probe.height = h;
				const g = /** @type {CanvasRenderingContext2D} */ (probe.getContext('2d', { willReadFrequently: true }));
				g.drawImage(image, 0, 0, w, h);
				const data = g.getImageData(0, 0, w, h).data;
				let x0 = w, y0 = h, x1 = -1, y1 = -1;
				for (let y = 0; y < h; y++) {
					for (let x = 0; x < w; x++) {
						if (data[(y * w + x) * 4 + 3] > 12) {
							x0 = Math.min(x0, x);
							x1 = Math.max(x1, x);
							y0 = Math.min(y0, y);
							y1 = Math.max(y1, y);
						}
					}
				}
				if (x1 < 0) {
					show(uris[m.id]); // nothing but transparency
					return;
				}
				// A little air around it, then back to the picture's own pixels.
				const pad = 6;
				const k = image.naturalWidth / w;
				const sx = Math.max(0, x0 - pad) * k;
				const sy = Math.max(0, y0 - pad) * k;
				const sw = (Math.min(w, x1 + 1 + pad) - Math.max(0, x0 - pad)) * k;
				const sh = (Math.min(h, y1 + 1 + pad) - Math.max(0, y0 - pad)) * k;
				const scale = Math.min(1, 320 / sw, 200 / sh);
				const out = document.createElement('canvas');
				out.width = Math.max(1, Math.round(sw * scale));
				out.height = Math.max(1, Math.round(sh * scale));
				/** @type {CanvasRenderingContext2D} */ (out.getContext('2d')).drawImage(image, sx, sy, sw, sh, 0, 0, out.width, out.height);
				show(out.toDataURL('image/png'));
			} catch {
				show(uris[m.id]);
			}
		};
		image.onerror = () => {
			delete pictures[m.id];
			if (!missing.has(m.id)) {
				missing.add(m.id);
				if (tab === 'media') {
					renderPanel();
				}
			}
		};
		image.src = uris[m.id];
	}

	function toast(/** @type {string} */ text, error = false) {
		const t = $('toast');
		t.textContent = text;
		t.className = `toast${error ? ' error' : ''}`;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, error ? 6000 : 2600);
	}

	function timecode(/** @type {number} */ t) {
		const f = Math.floor((t % 1) * fps() + 1e-6);
		const s = Math.floor(t) % 60;
		const m = Math.floor(t / 60) % 60;
		const h = Math.floor(t / 3600);
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
	}

	function shortTime(/** @type {number} */ t) {
		const m = Math.floor(t / 60);
		const s = (t % 60).toFixed(t < 10 ? 1 : 0);
		return m ? `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}` : `${s} s`;
	}

	function sendView() {
		vscode.postMessage({ type: 'view', playhead: engine.time, selection, playing: engine.playing });
	}

	// --- left panel

	function renderPanel() {
		document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.getAttribute('data-tab') === tab));
		const panel = $('panel');
		if (!project) {
			panel.innerHTML = '';
			return;
		}
		if (tab === 'media') {
			const used = new Set(project.clips.map((/** @type {any} */ clip) => clip.media));
			const kinds = [['all', 'Projet'], ['video', 'Vidéos'], ['image', 'Images'], ['audio', 'Sons']];
			const shown = project.media.filter((/** @type {any} */ m) => mediaFilter === 'all' || m.kind === mediaFilter);
			panel.innerHTML = `
				<div class="lib">
					<nav class="kinds">${kinds.map(k => `<button data-kind="${k[0]}" class="${mediaFilter === k[0] ? 'on' : ''}">${k[1]}<em>${k[0] === 'all' ? project.media.length : project.media.filter((/** @type {any} */ m) => m.kind === k[0]).length}</em></button>`).join('')}</nav>
					<div class="wall">
						<button class="importer" id="import">${icon('plus')}<b>Importer</b><span>ou glisse des fichiers ici</span></button>
						<div class="media-list">${shown.map((/** @type {any} */ m) => `
							<div class="media ${used.has(m.id) ? 'used' : ''}" draggable="true" data-media="${m.id}" title="${esc(m.path)}${m.width ? `\n${m.width}×${m.height}` : ''}${m.fps ? ` · ${Math.round(m.fps)} i/s` : ''}">
								${missing.has(m.id) ? `<div class="thumb gone" data-relink="${m.id}" title="Ce fichier n'est plus à cet endroit :\n${esc(m.path)}\nClique pour le retrouver.">${icon('alert')}<span class="len">Introuvable</span></div>` : `<div class="thumb ${m.kind}" style="${strips[m.id] ? `background-image:url('${strips[m.id].uri}');background-size:${strips[m.id].count * 100}% 100%;background-position:${strips[m.id].count > 1 ? (Math.min(3, strips[m.id].count - 1) / (strips[m.id].count - 1)) * 100 : 0}% 0` : ''}">${m.kind === 'image' && !strips[m.id] ? `<img alt="" draggable="false" src="${pictures[m.id] ?? ''}" ${pictures[m.id] ? '' : 'hidden'}>` : ''}${m.kind === 'audio' ? icon('audio') : ''}${used.has(m.id) ? '<span class="in">Ajouté</span>' : ''}${m.kind === 'image' ? '' : `<span class="len">${shortTime(m.duration)}</span>`}<button class="icon add" data-add="${m.id}" title="Ajouter à la tête de lecture">${icon('plus')}</button></div>`}
								<span class="mname">${esc(m.name)}</span>
							</div>`).join('') || `<p class="empty">${project.media.length ? 'Rien de ce type dans le projet.' : 'Importe des vidéos, des sons ou des images, ou glisse-les ici.'}</p>`}</div>
					</div>
				</div>`;
			$('import').onclick = () => vscode.postMessage({ type: 'import' });
			shown.forEach(picture);
			panel.querySelectorAll('[data-kind]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => {
				mediaFilter = String(b.dataset.kind);
				renderPanel();
			});
		} else if (tab === 'text') {
			panel.innerHTML = `<div class="panel-head"><b>Textes</b></div><p class="dim small">Clique pour ajouter à la tête de lecture.</p>
				<div class="cards">${TEXT_PRESETS.map(p => `<button class="card text-card" data-text="${p.id}"><span class="sample" style='${p.css}'>${p.sample}</span><span class="clabel">${p.label}</span></button>`).join('')}</div>`;
		} else if (tab === 'transitions') {
			panel.innerHTML = `<div class="panel-head"><b>Transitions</b></div><p class="dim small">S'applique au début du clip sélectionné (ou du clip sous la tête de lecture).</p>
				<div class="cards">${TRANSITIONS.map(t => `<button class="card tr-card" data-transition="${t.id}"><span class="tr-anim ${t.id}"><i></i><b></b></span><span class="clabel">${t.label}</span></button>`).join('')}
				<button class="card tr-card" data-transition="none"><span class="tr-anim none"></span><span class="clabel">Aucune</span></button></div>`;
		} else if (tab === 'effects') {
			panel.innerHTML = `<div class="panel-head"><b>Effets</b></div><p class="dim small">Sur le clip vidéo sélectionné, à la tête de lecture.</p>
				<div class="fx-list">
					<button class="fx" data-fx="punch">${icon('expand')}<span><b>Zoom punch</b><i>Zoom rapide sur une punchline</i></span></button>
					<button class="fx" data-fx="punchHold">${icon('target')}<span><b>Zoom jump cut</b><i>Recadre plus serré jusqu'au prochain plan</i></span></button>
					<button class="fx" data-fx="shake">${icon('sparkle')}<span><b>Secousse</b><i>Impact sur un moment fort</i></span></button>
					<button class="fx" data-fx="kenburns">${icon('camera')}<span><b>Ken Burns</b><i>Zoom lent sur tout le clip</i></span></button>
					<button class="fx" data-fx="speed2">${icon('forward')}<span><b>Accéléré x2</b><i>Passages longs</i></span></button>
					<button class="fx" data-fx="slow">${icon('back')}<span><b>Ralenti x0,5</b><i>Moment épique</i></span></button>
					<button class="fx" data-fx="mirror">${icon('layout')}<span><b>Miroir</b><i>Retourner l'image</i></span></button>
					<button class="fx" data-fx="blur">${icon('empty')}<span><b>Flou</b><i>Arrière-plan, censure</i></span></button>
				</div>
				<div class="panel-head"><b>Étalonnage</b></div>
				<div class="looks">${LOOKS.map(l => `<button class="look" data-look="${l.id}"><span class="swatch ${l.id}"></span>${l.label}</button>`).join('')}</div>`;
		} else if (tab === 'creations') {
			const kinds = /** @type {Record<string, string>} */ ({ effect: 'Effet', text: 'Texte', overlay: 'Incrustation' });
			const one = selection.length ? clipOf(selection.find(id => trackOf(clipOf(id)?.track)?.kind !== 'audio') ?? selection[0]) : undefined;
			panel.innerHTML = `<div class="panel-head"><b>Mes créations</b><span class="spacer"></span><button class="small" id="keep" ${one ? '' : 'disabled'} title="${one ? 'Enregistre ce clip (ses réglages, son style ou son image) pour le réutiliser partout' : 'Sélectionne d\'abord un clip'}">${icon('plus')} Enregistrer la sélection</button></div>
				<p class="dim small">Effets, styles de texte et filigranes gardés d'un montage à l'autre. Demande-en un à Claude : il le fabrique et le range ici.</p>
				<div class="cards">${creations.map(k => `<div class="card creation" data-creation="${esc(k.id)}" title="${esc(k.description || 'Cliquer pour appliquer')}">
					<span class="sample ${k.kind}" ${k.picture ? `style="background-image:url('${k.picture}')"` : ''}>${k.picture ? '' : k.kind === 'text' ? tIcon() : icon('sparkle')}</span>
					<span class="cname">${esc(k.name)}</span><span class="clabel">${kinds[k.kind] ?? ''}</span>
					<button class="drop-creation" data-drop="${esc(k.id)}" title="Supprimer de mes créations">${icon('close')}</button>
				</div>`).join('') || '<p class="empty">Rien encore. Règle un clip comme tu l\'aimes (zoom, couleur, texte, logo posé par-dessus), sélectionne-le, puis « Enregistrer la sélection ».</p>'}</div>`;
			$('keep').onclick = () => one && vscode.postMessage({ type: 'saveCreation', from: one.id });
			panel.querySelectorAll('[data-creation]').forEach((/** @type {HTMLElement} */ card) => card.onclick = e => {
				const drop = /** @type {HTMLElement} */ (e.target).closest('[data-drop]');
				vscode.postMessage(drop ? { type: 'deleteCreation', id: drop.getAttribute('data-drop') } : { type: 'applyCreation', id: card.dataset.creation });
			});
		} else if (tab === 'ai') {
			const media = project.media.filter((/** @type {any} */ m) => m.kind !== 'image' && m.hasAudio !== false);
			const first = media[0];
			const words = first ? project.transcripts?.[first.id] : undefined;
			panel.innerHTML = `
				<div class="panel-head"><b>Parole et IA</b></div>
				<div class="ai-box">
					<label class="dim small">Média</label>
					<select id="aiMedia">${media.map((/** @type {any} */ m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
					<div class="ai-actions">
						<button class="ai" id="transcribe">${icon('audio')}<span><b>${words ? 'Retranscrire' : 'Transcrire la parole'}</b><i>Whisper, sur ta machine</i></span></button>
						<button class="ai" id="captions">${tIcon()}<span><b>Sous-titres automatiques</b><i>Style karaoké, mot par mot</i></span></button>
						<button class="ai" id="silences">${icon('close')}<span><b>Couper les silences</b><i>Coupes nettes, rythme YouTube</i></span></button>
						<button class="ai" id="fillers">${icon('edit')}<span><b>Couper les hésitations</b><i>« euh », « heu », « bah »…</i></span></button>
						<button class="ai" id="ducking">${icon('audio')}<span><b>Musique sous la voix</b><i>La musique baisse quand on parle</i></span></button>
					</div>
					<div class="ask"><textarea id="askText" rows="3" placeholder="Demande à Claude : « monte-moi ça façon Squeezie », « ajoute des sous-titres et des zooms sur les blagues »…"></textarea><button class="primary" id="askBtn"><span class="claude-mark light"></span> Envoyer</button></div>
				</div>
				<div class="panel-head"><b>Transcription</b><span class="spacer"></span><span class="dim small" id="trStatus"></span></div>
				<div class="transcript" id="transcript">${words ? transcriptHtml(first.id, words) : '<p class="empty">Transcris la parole pour lire, chercher et couper ta vidéo comme un texte.</p>'}</div>`;
			$('transcribe').onclick = () => transcribe($('aiMedia').value);
			$('captions').onclick = () => autoCaptions($('aiMedia').value);
			$('silences').onclick = () => cutSilences($('aiMedia').value);
			$('fillers').onclick = () => cutFillers($('aiMedia').value);
			$('ducking').onclick = async () => {
				const voice = $('aiMedia').value;
				await wordsOf(voice);
				// Music: sound clips of other files (not the voice, not a video's own sound).
				const music = project.clips.filter((/** @type {any} */ c) => trackOf(c.track)?.kind === 'audio' && c.media !== voice && !c.link);
				if (!music.length) {
					toast('Ajoute d\'abord une musique (Importer, puis glisse-la sur la piste Musique)', true);
					return;
				}
				edit('Musique sous la voix', music.map((/** @type {any} */ c) => ({ op: 'duck', id: c.id, media: voice, level: 0.2 })));
				toast(`Ducking appliqué à ${music.length} clip${music.length > 1 ? 's' : ''} de musique`);
			};
			$('askBtn').onclick = () => {
				const text = $('askText').value.trim();
				if (text) {
					vscode.postMessage({ type: 'askClaude', text });
					$('askText').value = '';
					toast('Demande envoyée à Claude');
				}
			};
			$('aiMedia').onchange = () => {
				const id = $('aiMedia').value;
				const w = project.transcripts?.[id];
				$('transcript').innerHTML = w ? transcriptHtml(id, w) : '<p class="empty">Pas encore transcrit.</p>';
			};
		}
	}

	/** Transcript words placed on the timeline through the audio clips of that media. */
	function placedWords(/** @type {string} */ mediaId, /** @type {any[]} */ words) {
		const clips = project.clips.filter((/** @type {any} */ c) => c.media === mediaId && trackOf(c.track)?.kind === 'audio');
		/** @type {{ w: string, t: number, end: number }[]} */
		const out = [];
		for (const c of clips) {
			for (const w of words) {
				if (w.start >= c.in - 0.02 && w.end <= c.out + 0.02) {
					out.push({ w: w.w, t: c.start + (w.start - c.in) / c.speed, end: c.start + (w.end - c.in) / c.speed });
				}
			}
		}
		return out.sort((a, b) => a.t - b.t);
	}

	function transcriptHtml(/** @type {string} */ mediaId, /** @type {any[]} */ words) {
		const placed = placedWords(mediaId, words);
		if (!placed.length) {
			return '<p class="empty">Ce média n\'est plus sur la timeline.</p>';
		}
		const lines = [];
		let line = [];
		for (const w of placed) {
			const last = line[line.length - 1];
			if (last && (w.t - last.end > 0.8 || /[.!?]$/.test(last.w))) {
				lines.push(line);
				line = [];
			}
			line.push(w);
		}
		lines.push(line);
		return lines.map(l => `<p><span class="ts" data-seek="${l[0].t}">${shortTime(l[0].t)}</span>${l.map(w => `<span class="w" data-seek="${w.t}" data-end="${w.end}">${esc(w.w)}</span>`).join(' ')}</p>`).join('');
	}

	// --- inspector

	function renderInspector() {
		const box = $('inspector');
		if (!project) {
			box.innerHTML = '';
			return;
		}
		let clip = selection.length === 1 ? clipOf(selection[0]) : undefined;
		if (!clip && selection.length === 2) {
			// A video and its own sound, selected together as they always are: the inspector shows the picture.
			const pair = selection.map(id => clipOf(id));
			if (pair[0]?.link && pair[0].link === pair[1]?.link) {
				clip = pair.find(one => trackOf(one.track)?.kind === 'video') ?? pair[0];
			}
		}
		if (!clip) {
			box.innerHTML = `
				<div class="insp-head"><b>${selection.length > 1 ? `${selection.length} clips` : 'Projet'}</b></div>
				${selection.length > 1 ? `<div class="insp-section"><button class="wide" id="multiDelete">${icon('trash')} Supprimer</button><button class="wide" id="multiRipple">${icon('trash')} Supprimer et recoller</button></div>` : ''}
				<div class="insp-section"><h4>Format</h4>
					<div class="formats">${SHAPES.map(([a, b, l]) => `<button class="fmt ${shapeOf(project) === `${a}:${b}` ? 'on' : ''}" data-a="${a}" data-b="${b}" title="${l}"><i style="aspect-ratio:${a}/${b}"></i><b>${a}:${b}</b><span>${l}</span></button>`).join('')}</div>
					${row('Définition', `<select id="pres">${QUALITIES.map(([q, l]) => `<option value="${q}" ${Math.min(project.width, project.height) === q ? 'selected' : ''}>${l}</option>`).join('')}${QUALITIES.some(([q]) => Math.min(project.width, project.height) === q) ? '' : `<option selected value="${Math.min(project.width, project.height)}">${Math.min(project.width, project.height)}p</option>`}</select>`)}
					${row('Taille', `<span class="pair"><input type="number" id="pw" min="16" max="7680" step="2" value="${project.width}" /><span class="dim">×</span><input type="number" id="ph" min="16" max="7680" step="2" value="${project.height}" /></span>`)}
					${row('Vidéos', `<span class="seg" id="pfit"><button data-fit="cover" class="${frameFit() === 'cover' ? 'on' : ''}" title="Les vidéos remplissent le cadre, quitte à être rognées">Remplir</button><button data-fit="contain" class="${frameFit() === 'contain' ? 'on' : ''}" title="Les vidéos sont montrées entières, avec des bandes">Entières</button></span>`)}
					${row('Images/s', `<select id="pfps">${[24, 25, 30, 50, 60].map(f => `<option ${project.fps === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
					${row('Fond', `<input type="color" id="pbg" value="${project.background}" />`)}
				</div>
				<div class="insp-section"><h4>Statistiques</h4>
					<p class="dim small">${project.clips.length} clips · ${project.media.length} médias · durée ${timecode(total())}<br>${project.width} × ${project.height} · ${project.fps} i/s</p>
				</div>
				<div class="insp-section"><h4>Marqueurs</h4>${project.markers.length ? project.markers.map((/** @type {any} */ m) => `<div class="marker-row" data-seek="${m.t}"><i style="background:${m.color || '#f5c542'}"></i><span>${esc(m.label)}</span><span class="dim">${shortTime(m.t)}</span></div>`).join('') : '<p class="dim small">M pour poser un marqueur.</p>'}</div>`;
			// The shape and the definition are two choices: 9:16 in 4K, 16:9 in 720p…
			const resize = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ quality) => {
				const even = (/** @type {number} */ v) => Math.round(v / 2) * 2;
				const [w, h] = a >= b ? [even(quality * a / b), quality] : [quality, even(quality * b / a)];
				if (w !== project.width || h !== project.height) {
					edit('Format du projet', [{ op: 'project', patch: { width: w, height: h }, fit: frameFit() }]);
				}
			};
			box.querySelectorAll('.fmt').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => resize(Number(b.dataset.a), Number(b.dataset.b), Math.min(project.width, project.height)));
			$('pres').onchange = () => resize(project.width, project.height, Number($('pres').value));
			const custom = () => {
				const w = Math.min(7680, Math.max(16, Number($('pw').value) || project.width));
				const h = Math.min(7680, Math.max(16, Number($('ph').value) || project.height));
				if (w !== project.width || h !== project.height) {
					edit('Format du projet', [{ op: 'project', patch: { width: w, height: h }, fit: frameFit() }]);
				}
			};
			$('pw').onchange = custom;
			$('ph').onchange = custom;
			$('pfit').querySelectorAll('button').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => {
				const ids = framedClips().map((/** @type {any} */ clip) => clip.id);
				if (ids.length && frameFit() !== b.dataset.fit) {
					edit(b.dataset.fit === 'cover' ? 'Vidéos : remplir le cadre' : 'Vidéos : entières', ids.map((/** @type {string} */ id) => ({ op: 'update', id, patch: { fit: b.dataset.fit } })));
				}
			});
			$('pfps').onchange = () => edit('Images par seconde', [{ op: 'project', patch: { fps: Number($('pfps').value) } }]);
			$('pbg').onchange = () => edit('Couleur de fond', [{ op: 'project', patch: { background: $('pbg').value } }]);
			$('multiDelete')?.addEventListener('click', () => removeSelection(false));
			$('multiRipple')?.addEventListener('click', () => removeSelection(true));
			inspectorTabs(box);
			return;
		}
		const media = mediaOf(clip);
		const kind = trackOf(clip.track)?.kind;
		const local = engine.time - clip.start;
		const kf = (/** @type {string} */ prop) => {
			const keys = clip.keyframes?.[prop] ?? [];
			const here = keys.some((/** @type {any} */ k) => Math.abs(k.t - local) < frame() / 2);
			return `<button class="kf ${keys.length ? 'has' : ''} ${here ? 'here' : ''}" data-kf="${prop}" title="${here ? 'Retirer l\'image clé' : 'Image clé à la tête de lecture'}">${diamond()}</button>`;
		};
		const num = (/** @type {string} */ path, /** @type {number} */ value, /** @type {number} */ step, /** @type {string} */ unit = '', /** @type {string} */ prop = '') => `<span class="num"><input type="number" data-path="${path}" value="${Math.round(value * 1000) / 1000}" step="${step}" />${unit ? `<em>${unit}</em>` : ''}</span>${prop ? kf(prop) : ''}`;
		const slider = (/** @type {string} */ path, /** @type {number} */ value, /** @type {number} */ min, /** @type {number} */ max, /** @type {number} */ step) => `<input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}" value="${value}" /><span class="val">${Math.round(value * 100) / 100}</span>`;
		const sections = [];
		sections.push(`<div class="insp-section"><h4>Clip</h4>
			${row('Début', num('start', clip.start, frame(), 's'))}
			${row('Durée', num('_duration', dur(clip), frame(), 's'))}
			${media && media.kind !== 'image' ? row('Vitesse', `<select data-path="speed">${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map(s => `<option value="${s}" ${Math.abs(clip.speed - s) < 1e-3 ? 'selected' : ''}>${s === 1 ? 'Normale' : `x${String(s).replace('.', ',')}`}</option>`).join('')}${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].some(s => Math.abs(clip.speed - s) < 1e-3) ? '' : `<option selected value="${clip.speed}">x${clip.speed}</option>`}</select>`) : ''}
			${media ? `<p class="dim small src">${esc(media.name)} · source ${shortTime(clip.in)} → ${shortTime(clip.out)}</p>` : ''}
		</div>`);
		if (clip.text) {
			const s = clip.text;
			sections.push(`<div class="insp-section"><h4>Texte</h4>
				<textarea class="text-edit" data-path="text.content" rows="3">${esc(s.content)}</textarea>
				${row('Police', `<select data-path="text.font">${[...new Set([s.font, ...FONTS])].map(f => `<option ${f === s.font ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>`)}
				${row('Taille', num('text.size', s.size, 1, 'px'))}
				${row('Graisse', `<select data-path="text.weight">${[[300, 'Fine'], [400, 'Normale'], [600, 'Semi-grasse'], [800, 'Grasse'], [900, 'Noire']].map(([v, l]) => `<option value="${v}" ${s.weight === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
				${row('Couleur', `<input type="color" data-path="text.color" value="${s.color.slice(0, 7)}" />`)}
				${row('Contour', `<input type="color" data-path="text.stroke" value="${s.stroke.slice(0, 7)}" />${num('text.strokeWidth', s.strokeWidth, 1, 'px')}`)}
				${row('Ombre', num('text.shadow', s.shadow, 1, 'px'))}
				${row('Fond', `<input type="color" data-path="text.background" value="${(s.background || '#000000').slice(0, 7)}" /><label class="check"><input type="checkbox" data-bg ${s.background ? 'checked' : ''}/> Encadré</label>`)}
				${row('Karaoké', `<input type="color" data-path="text.highlight" value="${(s.highlight || '#ffe600').slice(0, 7)}" /><span class="dim small">${s.wordTimes ? `${s.wordTimes.length} mots minutés` : 'mot surligné'}</span>`)}
				${row('Alignement', `<div class="seg">${['left', 'center', 'right'].map(a => `<button data-align="${a}" class="${s.align === a ? 'on' : ''}">${a === 'left' ? 'Gauche' : a === 'center' ? 'Centre' : 'Droite'}</button>`).join('')}</div>`)}
				${row('Majuscules', `<label class="switch"><input type="checkbox" data-path="text.uppercase" ${s.uppercase ? 'checked' : ''}/><i></i></label>`)}
				${row('Animation', `<select data-path="text.animation">${[['none', 'Aucune'], ['pop', 'Pop'], ['bounce', 'Rebond'], ['fade', 'Fondu'], ['slide-up', 'Montée'], ['typewriter', 'Machine à écrire']].map(([v, l]) => `<option value="${v}" ${s.animation === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
			</div>`);
		}
		if (kind !== 'audio') {
			sections.push(`<div class="insp-section"><h4>Cadre</h4>
				${media ? row('Ajustement', `<div class="seg">${[['contain', 'Entier'], ['cover', 'Remplir'], ['stretch', 'Étirer']].map(([v, l]) => `<button data-fit="${v}" class="${clip.fit === v ? 'on' : ''}">${l}</button>`).join('')}</div>`) : ''}
				${row('Position X', num('x', valueAt(clip, 'x', local), 1, 'px', 'x'))}
				${row('Position Y', num('y', valueAt(clip, 'y', local), 1, 'px', 'y'))}
				${row('Échelle', num('scale', valueAt(clip, 'scale', local), 0.01, '×', 'scale'))}
				${row('Rotation', num('rotation', valueAt(clip, 'rotation', local), 1, '°', 'rotation'))}
				${row('Opacité', num('opacity', valueAt(clip, 'opacity', local), 0.05, '', 'opacity'))}
				${media ? row('Miroir', `<label class="switch"><input type="checkbox" data-path="mirror" ${clip.mirror ? 'checked' : ''}/><i></i></label>`) : ''}
				<div class="insp-actions"><button class="small" id="resetTransform">Réinitialiser</button>${media ? '<button class="small" id="center">Centrer</button>' : ''}</div>
			</div>`);
			if (media) {
				sections.push(`<div class="insp-section"><h4>Recadrage</h4>
					${row('Gauche', slider('crop.left', clip.crop.left, 0, 0.45, 0.01))}
					${row('Droite', slider('crop.right', clip.crop.right, 0, 0.45, 0.01))}
					${row('Haut', slider('crop.top', clip.crop.top, 0, 0.45, 0.01))}
					${row('Bas', slider('crop.bottom', clip.crop.bottom, 0, 0.45, 0.01))}
				</div>
				<div class="insp-section"><h4>Couleur</h4>
					<div class="looks mini">${LOOKS.map(l => `<button class="look" data-look="${l.id}" title="${l.label}"><span class="swatch ${l.id}"></span></button>`).join('')}</div>
					${row('Luminosité', slider('color.brightness', clip.color.brightness, -1, 1, 0.01))}
					${row('Contraste', slider('color.contrast', clip.color.contrast, -1, 1, 0.01))}
					${row('Saturation', slider('color.saturation', clip.color.saturation, -1, 1, 0.01))}
					${row('Température', slider('color.temperature', clip.color.temperature, -1, 1, 0.01))}
					${row('Teinte', slider('color.hue', clip.color.hue, -180, 180, 1))}
					${row('Vignette', slider('color.vignette', clip.color.vignette, 0, 1, 0.01))}
					${row('Flou', slider('blur', clip.blur || 0, 0, 10, 0.1))}
					${row('Secousse', slider('shake', clip.shake || 0, 0, 1, 0.05))}
				</div>`);
			}
		}
		if (kind === 'audio' || (kind !== 'text' && !media)) {
			const db = clip.volume > 0 ? (20 * Math.log10(clip.volume)).toFixed(1) : '-∞';
			sections.push(`<div class="insp-section"><h4>Son</h4>
				${row('Volume', `${slider('volume', clip.volume, 0, 2, 0.01).replace(/<span class="val">[^<]*<\/span>/, `<span class="val">${db} dB</span>`)}${kf('volume')}`)}
				<div class="insp-actions"><button class="small" data-vol="0.15">Musique de fond</button><button class="small" data-vol="1">0 dB</button><button class="small" data-vol="0">Couper</button></div>
			</div>`);
		}
		// A video's sound sits on its own clip, linked to the picture. It is set from the picture too:
		// nobody looks for the volume of a video on another track.
		const voice = kind === 'video' && clip.link ? project.clips.find((/** @type {any} */ other) => other.link === clip.link && other.id !== clip.id && trackOf(other.track)?.kind === 'audio') : undefined;
		if (voice) {
			const db = voice.volume > 0 ? `${(20 * Math.log10(voice.volume)).toFixed(1)} dB` : 'coupé';
			sections.push(`<div class="insp-section"><h4>Son</h4>
				${row('Volume', `<span class="voice"><input type="range" id="voiceVol" min="0" max="2" step="0.01" value="${voice.volume}" /><span class="val" id="voiceDb">${db}</span></span>`)}
				${row('Fondu d\'entrée', `<span class="voice"><input type="number" id="voiceIn" min="0" step="0.05" value="${voice.fadeIn || 0}" /><span class="dim">s</span></span>`)}
				${row('Fondu de sortie', `<span class="voice"><input type="number" id="voiceOut" min="0" step="0.05" value="${voice.fadeOut || 0}" /><span class="dim">s</span></span>`)}
				<div class="insp-actions"><button class="small" data-voice="${voice.volume > 0 ? 0 : 1}">${voice.volume > 0 ? 'Couper le son' : 'Rétablir le son'}</button><button class="small" data-voice="1">0 dB</button><button class="small" data-voice="0.15">En fond</button><button class="small" id="voiceDetach" title="Le son devient un clip à part : il se déplace, se coupe et se supprime sans l'image">Détacher</button></div>
			</div>`);
		} else if (kind === 'video' && media?.kind === 'video') {
			sections.push(`<div class="insp-section"><h4>Son</h4><p class="dim small">${media.hasAudio === false ? 'Cette vidéo n\'a pas de son.' : 'Le son de ce clip a été détaché ou supprimé : il se règle sur son propre clip, dans les pistes audio.'}</p></div>`);
		}
		sections.push(`<div class="insp-section"><h4>Fondus</h4>
			${row('Entrée', num('fadeIn', clip.fadeIn, 0.05, 's'))}
			${row('Sortie', num('fadeOut', clip.fadeOut, 0.05, 's'))}
		</div>`);
		if (kind === 'video') {
			sections.push(`<div class="insp-section"><h4>Transition d'entrée</h4>
				${row('Type', `<select id="trType"><option value="none">Aucune</option>${TRANSITIONS.map(t => `<option value="${t.id}" ${clip.transitionIn?.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}</select>`)}
				${clip.transitionIn ? row('Durée', num('_trDuration', clip.transitionIn.duration, 0.05, 's')) : ''}
			</div>`);
		}
		box.innerHTML = `<div class="insp-head"><span class="kind ${kind}">${kind === 'video' ? icon('camera') : kind === 'audio' ? icon('audio') : tIcon()}</span><b>${esc(clip.name || (clip.text ? clip.text.content : media?.name) || 'Clip')}</b><span class="spacer"></span><button class="icon" id="delClip" title="Supprimer (Suppr)">${icon('trash')}</button></div>${sections.join('')}`;
		bindInspector(clip, local);
		inspectorTabs(box);
	}

	/** The sections of the inspector, grouped behind tabs: one group on screen at a time. */
	function inspectorTabs(/** @type {HTMLElement} */ box) {
		const groups = /** @type {Record<string, string>} */ ({ 'Clip': 'Vidéo', 'Cadre': 'Vidéo', 'Recadrage': 'Vidéo', 'Transition d\'entrée': 'Animation', 'Fondus': 'Animation', 'Couleur': 'Couleur', 'Son': 'Audio', 'Texte': 'Texte', 'Format': 'Projet', 'Statistiques': 'Projet', 'Marqueurs': 'Marqueurs' });
		const sections = /** @type {HTMLElement[]} */ (Array.from(box.querySelectorAll('.insp-section')));
		const names = /** @type {string[]} */ ([]);
		for (const section of sections) {
			const group = groups[section.querySelector('h4')?.textContent ?? ''] ?? 'Projet';
			section.dataset.group = group;
			if (!names.includes(group)) {
				names.push(group);
			}
		}
		// A text clip opens on its text, any other on the first group it has.
		const order = ['Texte', 'Vidéo', 'Audio', 'Animation', 'Couleur', 'Projet', 'Marqueurs'].filter(n => names.includes(n));
		if (order.length < 2) {
			return;
		}
		const current = order.includes(inspTab) ? inspTab : order[0];
		const bar = document.createElement('nav');
		bar.className = 'insp-tabs';
		bar.innerHTML = order.map(n => `<button class="${n === current ? 'on' : ''}" data-insp="${n}">${n}</button>`).join('');
		box.querySelector('.insp-head')?.after(bar);
		sections.forEach(section => { section.hidden = section.dataset.group !== current; });
		bar.querySelectorAll('button').forEach(b => b.onclick = () => {
			inspTab = String(b.dataset.insp);
			renderInspector();
		});
	}

	const SHAPES = /** @type {[number, number, string][]} */ ([[16, 9, 'YouTube'], [9, 16, 'Shorts, TikTok'], [1, 1, 'Carré'], [4, 5, 'Instagram'], [4, 3, 'Classique'], [21, 9, 'Cinéma']]);
	const QUALITIES = /** @type {[number, string][]} */ ([[720, '720p · HD'], [1080, '1080p · Full HD'], [1440, '1440p · 2K'], [2160, '2160p · 4K']]);
	/** The shape of the frame, as one of the known ones (« 16:9 ») when it is one. */
	const shapeOf = (/** @type {any} */ p) => {
		const found = SHAPES.find(([a, b]) => Math.abs(p.width / p.height - a / b) < 0.012);
		return found ? `${found[0]}:${found[1]}` : '';
	};
	/** The videos whose shape is not the frame's: the ones « fill » or « whole » changes. */
	const framedClips = () => project.clips.filter((/** @type {any} */ clip) => {
		const media = project.media.find((/** @type {any} */ m) => m.id === clip.media);
		return media?.kind === 'video' && media.width && media.height && Math.abs(media.width / media.height - project.width / project.height) > 0.012;
	});
	const frameFit = () => {
		const clips = framedClips();
		return clips.length && clips.every((/** @type {any} */ clip) => clip.fit === 'contain') ? 'contain' : 'cover';
	};

	function row(/** @type {string} */ label, /** @type {string} */ control) {
		return `<div class="row"><label>${label}</label><div class="ctrl">${control}</div></div>`;
	}

	/** Builds a patch from a dotted path (`color.contrast` → { color: { contrast } }). */
	function patchOf(/** @type {string} */ path, /** @type {any} */ value) {
		const [a, b] = path.split('.');
		return b ? { [a]: { [b]: value } } : { [a]: value };
	}

	function bindInspector(/** @type {any} */ clip, /** @type {number} */ local) {
		const box = $('inspector');
		const commit = (/** @type {string} */ path, /** @type {any} */ value, /** @type {string} */ label) => {
			if (path === '_duration') {
				edit('Durée', [{ op: 'update', id: clip.id, patch: { out: clip.in + Math.max(frame(), value) * clip.speed } }]);
				return;
			}
			if (path === '_trDuration') {
				edit('Durée de transition', [{ op: 'transition', id: clip.id, type: clip.transitionIn.type, duration: value }]);
				return;
			}
			// An animated property: edit the keyframe at the playhead.
			const keys = clip.keyframes?.[path];
			if (keys?.length && ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'].includes(path)) {
				const next = keys.filter((/** @type {any} */ k) => Math.abs(k.t - local) >= frame() / 2).concat({ t: Math.max(0, local), v: value });
				edit(label, [{ op: 'update', id: clip.id, patch: { keyframes: { [path]: next.sort((a, b) => a.t - b.t) } } }]);
				return;
			}
			const linkedIds = path === 'speed' ? project.clips.filter((/** @type {any} */ c) => c.link && c.link === clip.link).map((/** @type {any} */ c) => c.id) : [clip.id];
			edit(label, (linkedIds.length ? linkedIds : [clip.id]).map((/** @type {string} */ id) => ({ op: 'update', id, patch: patchOf(path, value) })));
		};
		box.querySelectorAll('[data-path]').forEach((/** @type {HTMLInputElement} */ el) => {
			const path = /** @type {string} */ (el.dataset.path);
			const label = el.closest('.row')?.querySelector('label')?.textContent || 'Modification';
			const value = () => el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.tagName === 'SELECT' && /^(speed|text\.weight)$/.test(path) ? Number(el.value) : el.value;
			if (el.type === 'range') {
				// Live while dragging, one undo step when released.
				el.addEventListener('input', () => {
					const v = Number(el.value);
					const shown = el.nextElementSibling;
					if (shown && path !== 'volume') {
						shown.textContent = String(Math.round(v * 100) / 100);
					}
					const tmp = structuredClone(clip);
					const [a, b] = path.split('.');
					if (b) {
						tmp[a][b] = v;
					} else {
						tmp[a] = v;
					}
					livePreview([tmp]);
				});
				el.addEventListener('change', () => commit(path, value(), label));
			} else if (el.tagName === 'TEXTAREA') {
				el.addEventListener('input', () => {
					const tmp = structuredClone(clip);
					tmp.text.content = el.value;
					livePreview([tmp]);
				});
				el.addEventListener('change', () => commit(path, el.value, 'Texte'));
			} else {
				el.addEventListener('change', () => commit(path, value(), label));
			}
		});
		box.querySelectorAll('[data-fit]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => commit('fit', b.dataset.fit, 'Ajustement'));
		box.querySelectorAll('[data-align]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => commit('text.align', b.dataset.align, 'Alignement'));
		if (voice) {
			const set = (/** @type {Record<string, any>} */ patch, /** @type {string} */ label) => edit(label, [{ op: 'update', id: voice.id, patch }]);
			$('voiceVol').oninput = () => {
				const v = Number($('voiceVol').value);
				$('voiceDb').textContent = v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : 'coupé';
			};
			$('voiceVol').onchange = () => set({ volume: Number($('voiceVol').value) }, 'Volume de la vidéo');
			$('voiceIn').onchange = () => set({ fadeIn: Math.max(0, Number($('voiceIn').value) || 0) }, 'Fondu du son');
			$('voiceOut').onchange = () => set({ fadeOut: Math.max(0, Number($('voiceOut').value) || 0) }, 'Fondu du son');
			box.querySelectorAll('[data-voice]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => set({ volume: Number(b.dataset.voice) }, Number(b.dataset.voice) === 0 ? 'Couper le son de la vidéo' : 'Volume de la vidéo'));
			$('voiceDetach').onclick = () => edit('Détacher le son', [{ op: 'update', id: clip.id, patch: { link: null } }, { op: 'update', id: voice.id, patch: { link: null } }]);
		}
		box.querySelectorAll('[data-vol]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => commit('volume', Number(b.dataset.vol), 'Volume'));
		box.querySelectorAll('[data-look]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => applyLook(/** @type {string} */ (b.dataset.look), [clip.id]));
		box.querySelector('[data-bg]')?.addEventListener('change', (/** @type {any} */ e) => commit('text.background', e.target.checked ? '#000000cc' : '', 'Fond du texte'));
		box.querySelectorAll('[data-kf]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => toggleKeyframe(clip, /** @type {string} */ (b.dataset.kf), local));
		$('trType')?.addEventListener('change', () => edit('Transition', [{ op: 'transition', id: clip.id, type: $('trType').value, duration: clip.transitionIn?.duration ?? 0.5 }]));
		$('delClip').onclick = () => removeSelection(ripple);
		$('resetTransform')?.addEventListener('click', () => edit('Réinitialiser le cadre', [{ op: 'update', id: clip.id, patch: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [] } } }]));
		$('center')?.addEventListener('click', () => edit('Centrer', [{ op: 'update', id: clip.id, patch: { x: 0, y: 0 } }]));
	}

	function toggleKeyframe(/** @type {any} */ clip, /** @type {string} */ prop, /** @type {number} */ local) {
		const keys = clip.keyframes?.[prop] ?? [];
		const here = keys.find((/** @type {any} */ k) => Math.abs(k.t - local) < frame() / 2);
		const next = here ? keys.filter((/** @type {any} */ k) => k !== here) : [...keys, { t: Math.max(0, local), v: valueAt(clip, prop, local) }].sort((a, b) => a.t - b.t);
		edit(here ? 'Retirer une image clé' : 'Image clé', [{ op: 'update', id: clip.id, patch: { keyframes: { [prop]: next } } }]);
	}

	function applyLook(/** @type {string} */ id, /** @type {string[]} */ ids) {
		const look = LOOKS.find(l => l.id === id);
		const targets = ids.filter(i => mediaOf(clipOf(i)) && trackOf(clipOf(i).track)?.kind === 'video');
		if (!look || !targets.length) {
			toast('Sélectionne un clip vidéo', true);
			return;
		}
		edit(`Étalonnage ${look.label}`, targets.map(i => ({ op: 'update', id: i, patch: { color: look.color } })));
	}

	/** Shows uncommitted values (sliders being dragged) without an undo step. */
	function livePreview(/** @type {any[]} */ clips) {
		const map = new Map(clips.map(c => [c.id, c]));
		engine.setProject({ ...project, clips: project.clips.map((/** @type {any} */ c) => map.get(c.id) ?? c) }, uris);
	}

	// --- timeline

	function layout() {
		/** @type {{ id: string, top: number, height: number, kind: string }[]} */
		const rows = [];
		let y = 0;
		for (const t of project.tracks) {
			const h = TRACK_H[/** @type {'video' | 'audio' | 'text'} */ (t.kind)] ?? 46;
			rows.push({ id: t.id, top: y, height: h, kind: t.kind });
			y += h + 2;
		}
		return { rows, height: y };
	}

	const timeToX = (/** @type {number} */ t) => HEADER_W + t * pxPerSec - scrollX;
	const xToTime = (/** @type {number} */ x) => Math.max(0, (x - HEADER_W + scrollX) / pxPerSec);

	function renderTimeline() {
		if (!project) {
			return;
		}
		const { rows, height } = layout();
		const tracks = $('tracks');
		const clips = preview ? project.clips.map((/** @type {any} */ c) => preview?.get(c.id) ?? c).concat([...preview.values()].filter(c => !clipOf(c.id))) : project.clips;
		tracks.style.height = `${height}px`;
		const width = $('tlMain').clientWidth;
		const visibleFrom = xToTime(HEADER_W) - 2;
		const visibleTo = xToTime(width) + 2;
		tracks.innerHTML = rows.map(r => {
			const t = trackOf(r.id);
			return `<div class="track ${r.kind} ${t.hidden ? 'hidden' : ''} ${t.muted ? 'muted' : ''} ${t.locked ? 'locked' : ''}" data-track="${r.id}" style="top:${r.top}px;height:${r.height}px">
				<div class="th"><span class="tname">${esc(t.name)}</span><span class="spacer"></span>
					${r.kind !== 'audio' ? `<button class="tb ${t.hidden ? 'off' : ''}" data-hide="${r.id}" title="${t.hidden ? 'Afficher' : 'Masquer'}">${eye(!t.hidden)}</button>` : ''}
					${r.kind === 'audio' ? `<button class="tb ${t.muted ? 'off' : ''}" data-mute="${r.id}" title="${t.muted ? 'Rétablir le son' : 'Couper le son'}">${speaker(!t.muted)}</button>` : ''}
					<button class="tb ${t.locked ? 'off' : ''}" data-lock="${r.id}" title="${t.locked ? 'Déverrouiller' : 'Verrouiller'}">${icon('lock')}</button>
				</div>
				<div class="lane">${clips.filter((/** @type {any} */ c) => c.track === r.id && end(c) >= visibleFrom && c.start <= visibleTo).map((/** @type {any} */ c) => clipHtml(c, r)).join('')}</div>
			</div>`;
		}).join('');
		// Waveforms are drawn into canvases after layout.
		tracks.querySelectorAll('canvas.wave').forEach((/** @type {HTMLCanvasElement} */ cv) => drawWave(cv, clipOf(/** @type {string} */ (cv.dataset.clip)) ?? preview?.get(/** @type {string} */ (cv.dataset.clip))));
		renderRuler();
		renderPlayhead();
		const content = Math.max(total() + 30, (width - HEADER_W) / pxPerSec);
		$('hscroll').style.width = `${content * pxPerSec + HEADER_W}px`;
	}

	function clipHtml(/** @type {any} */ c, /** @type {any} */ r) {
		const x = timeToX(c.start);
		const w = Math.max(3, dur(c) * pxPerSec);
		const media = mediaOf(c);
		const sel = selection.includes(c.id);
		let body = '';
		if (c.text) {
			body = `<span class="clabel">${tIcon()} ${esc(c.text.content)}</span>`;
		} else if (r.kind === 'video' && media) {
			const s = strips[media.id];
			if (s && media.kind === 'video') {
				// Frames of the source under the clip, at the right times.
				const tileW = s.width * (r.height - 6) / s.height;
				const n = Math.min(80, Math.ceil(w / tileW) + 1);
				const tiles = [];
				for (let i = 0; i < n; i++) {
					const at = c.in + (i * tileW / pxPerSec) * c.speed;
					const idx = Math.min(s.count - 1, Math.max(0, Math.floor(at / s.every)));
					tiles.push(`<i style="left:${i * tileW}px;width:${tileW}px;background-image:url('${s.uri}');background-size:${s.count * tileW}px 100%;background-position:${-idx * tileW}px 0"></i>`);
				}
				body = `<div class="strip">${tiles.join('')}</div><span class="clabel">${esc(media.name)}</span>`;
			} else {
				body = `<span class="clabel">${esc(media?.name ?? '')}</span>`;
			}
		} else if (media) {
			body = `<canvas class="wave" data-clip="${c.id}" width="${Math.min(4000, Math.ceil(w))}" height="${r.height - 4}"></canvas><span class="clabel">${esc(media.name)}${c.volume !== 1 ? ` · ${c.volume > 0 ? (20 * Math.log10(c.volume)).toFixed(1) : '-∞'} dB` : ''}</span>`;
		}
		const badges = [
			c.speed !== 1 ? `<b class="badge">x${String(c.speed).replace('.', ',')}</b>` : '',
			c.keyframes && Object.values(c.keyframes).some((/** @type {any} */ k) => k?.length) ? `<b class="badge kfb">${diamond()}</b>` : '',
		].join('');
		const tr = c.transitionIn ? `<span class="tr" style="width:${Math.max(8, c.transitionIn.duration * pxPerSec)}px;left:${c.transitionIn.type.startsWith('dip') ? -c.transitionIn.duration * pxPerSec / 2 : -c.transitionIn.duration * pxPerSec}px" title="${TRANSITIONS.find(t => t.id === c.transitionIn.type)?.label}"></span>` : '';
		const fades = `${c.fadeIn ? `<span class="fade in" style="width:${c.fadeIn * pxPerSec}px"></span>` : ''}${c.fadeOut ? `<span class="fade out" style="width:${c.fadeOut * pxPerSec}px"></span>` : ''}`;
		const sort = c.text ? 'text' : media?.kind === 'image' ? 'image' : r.kind === 'audio' && !c.link ? 'music' : '';
		return `<div class="clip ${r.kind} ${sort} ${sel ? 'sel' : ''}" data-clip="${c.id}" style="left:${x - HEADER_W}px;width:${w}px">${tr}${body}${fades}<span class="badges">${badges}</span><span class="h l" data-handle="l"></span><span class="h r" data-handle="r"></span></div>`;
	}

	function drawWave(/** @type {HTMLCanvasElement} */ cv, /** @type {any} */ c) {
		const media = mediaOf(c);
		const data = media && peaks[media.id];
		const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
		ctx.clearRect(0, 0, cv.width, cv.height);
		if (!data) {
			return;
		}
		const mid = cv.height / 2;
		const gain = Math.min(2, c.volume);
		// The sound of a video in mint, a music laid under it in blue.
		ctx.fillStyle = c.link ? 'rgba(47, 214, 193, .9)' : 'rgba(110, 176, 255, .9)';
		for (let x = 0; x < cv.width; x++) {
			const t0 = c.in + (x / pxPerSec) * c.speed;
			const t1 = c.in + ((x + 1) / pxPerSec) * c.speed;
			let max = 0;
			for (let i = Math.floor(t0 * 100); i < Math.max(Math.floor(t0 * 100) + 1, Math.floor(t1 * 100)); i++) {
				max = Math.max(max, data[i] ?? 0);
			}
			const h = Math.max(1, (max / 255) * mid * gain);
			ctx.fillRect(x, mid - h, 1, h * 2);
		}
	}

	function renderRuler() {
		const cv = $('rulerCanvas');
		const width = $('tlMain').clientWidth;
		const dpr = window.devicePixelRatio || 1;
		cv.width = width * dpr;
		cv.height = 26 * dpr;
		cv.style.width = `${width}px`;
		const ctx = cv.getContext('2d');
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, width, 26);
		// A step that keeps labels ~90 px apart.
		const steps = [1 / fps(), 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
		const step = steps.find(s => s * pxPerSec >= 90) ?? 600;
		const minor = step / 5;
		const from = Math.floor(xToTime(HEADER_W) / minor) * minor;
		const to = xToTime(width);
		ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
		ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted') || '#888';
		ctx.strokeStyle = 'rgba(127,127,127,.35)';
		for (let t = from; t <= to; t += minor) {
			const x = Math.round(timeToX(t)) + .5;
			if (x < HEADER_W) {
				continue;
			}
			const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
			ctx.beginPath();
			ctx.moveTo(x, major ? 12 : 19);
			ctx.lineTo(x, 26);
			ctx.stroke();
			if (major) {
				ctx.fillText(step < 1 ? `${t.toFixed(2)}s` : shortClock(t), x + 3, 10);
			}
		}
		if (inOut) {
			ctx.fillStyle = 'rgba(139, 123, 255, .25)';
			ctx.fillRect(timeToX(inOut[0]), 0, (inOut[1] - inOut[0]) * pxPerSec, 26);
		}
		for (const m of project.markers) {
			const x = timeToX(m.t);
			ctx.fillStyle = m.color || '#f5c542';
			ctx.beginPath();
			ctx.moveTo(x - 5, 14);
			ctx.lineTo(x + 5, 14);
			ctx.lineTo(x, 22);
			ctx.fill();
		}
	}

	function shortClock(/** @type {number} */ t) {
		const m = Math.floor(t / 60);
		const s = Math.round(t % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function renderPlayhead() {
		const x = timeToX(engine.time);
		const ph = $('playhead');
		ph.style.transform = `translateX(${x}px)`;
		ph.hidden = x < HEADER_W - 1;
		$('tc').textContent = timecode(engine.time);
		showPlayState();
		document.querySelectorAll('.transcript .w').forEach((/** @type {HTMLElement} */ w) => {
			const on = engine.time >= Number(w.dataset.seek) && engine.time < Number(w.dataset.end);
			w.classList.toggle('now', on);
		});
	}

	/**
	 * The play button's icon changes only when the state does: rewriting it on every tick
	 * removed the element under the mouse between press and release, which swallowed clicks.
	 */
	let shownPlaying = false;
	function showPlayState() {
		if (engine.playing !== shownPlaying) {
			shownPlaying = engine.playing;
			$('play').innerHTML = icon(shownPlaying ? 'pause' : 'play');
			$('play').title = shownPlaying ? 'Pause (Espace)' : 'Lecture (Espace)';
		}
	}

	/** Keeps the playhead in view while playing. */
	function follow() {
		const width = $('tlMain').clientWidth;
		const x = timeToX(engine.time);
		if (engine.playing && (x > width - 60 || x < HEADER_W)) {
			scrollX = Math.max(0, engine.time * pxPerSec - (width - HEADER_W) * 0.15);
			$('tlScroll').scrollLeft = scrollX;
			renderTimeline();
		}
	}

	/** Snap candidates in time: playhead, clip edges, markers, in/out. */
	function snapTargets(/** @type {string[]} */ ignore) {
		const list = [0, engine.time, ...project.markers.map((/** @type {any} */ m) => m.t)];
		for (const c of project.clips) {
			if (!ignore.includes(c.id)) {
				list.push(c.start, end(c));
			}
		}
		if (inOut) {
			list.push(...inOut);
		}
		return list;
	}

	function snap(/** @type {number} */ t, /** @type {string[]} */ ignore, /** @type {boolean} */ force = false) {
		if (!snapping && !force) {
			$('snapline').hidden = true;
			return t;
		}
		let best = t;
		let dist = SNAP_PX / pxPerSec;
		for (const s of snapTargets(ignore)) {
			if (Math.abs(s - t) < dist) {
				dist = Math.abs(s - t);
				best = s;
			}
		}
		const line = $('snapline');
		line.hidden = best === t;
		line.style.transform = `translateX(${timeToX(best)}px)`;
		return best;
	}

	function linkedIds(/** @type {string[]} */ ids) {
		const links = new Set(ids.map(i => clipOf(i)?.link).filter(Boolean));
		return project.clips.filter((/** @type {any} */ c) => ids.includes(c.id) || (c.link && links.has(c.link))).map((/** @type {any} */ c) => c.id);
	}

	// Clip interactions: select, move (also to another track), trim, blade.
	$('tracks').addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
		const target = /** @type {HTMLElement} */ (e.target);
		const btn = target.closest('[data-hide],[data-mute],[data-lock]');
		if (btn) {
			const id = btn.getAttribute('data-hide') || btn.getAttribute('data-mute') || btn.getAttribute('data-lock');
			const t = trackOf(/** @type {string} */ (id));
			const field = btn.hasAttribute('data-hide') ? 'hidden' : btn.hasAttribute('data-mute') ? 'muted' : 'locked';
			edit(`${field === 'hidden' ? 'Visibilité' : field === 'muted' ? 'Son' : 'Verrou'} de ${t.name}`, [{ op: 'track', id, patch: { [field]: !t[field] } }]);
			return;
		}
		const el = target.closest('.clip');
		if (!el) {
			if (target.closest('.lane') || target.closest('.tracks')) {
				// Empty space: move the playhead, or draw a selection box.
				startMarquee(e);
			}
			return;
		}
		const id = /** @type {string} */ (el.getAttribute('data-clip'));
		const clip = clipOf(id);
		if (!clip || trackOf(clip.track)?.locked) {
			return;
		}
		if (tool === 'blade') {
			const t = snap(snapTime(xToTime(e.clientX - $('tlMain').getBoundingClientRect().left)), [], true);
			edit('Couper', [{ op: 'split', t, ids: e.altKey ? [id] : [id] }]);
			$('snapline').hidden = true;
			return;
		}
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			selection = selection.includes(id) ? selection.filter(s => s !== id) : [...selection, id];
		} else if (!selection.includes(id)) {
			selection = e.altKey ? [id] : linkedIds([id]);
		}
		renderSelection();
		const handle = target.getAttribute('data-handle');
		dragClips(e, clip, handle, e.altKey);
	});

	function renderSelection() {
		document.querySelectorAll('.clip').forEach(c => c.classList.toggle('sel', selection.includes(/** @type {string} */ (c.getAttribute('data-clip')))));
		renderInspector();
		renderOverlay();
		sendView();
	}

	function dragClips(/** @type {PointerEvent} */ e, /** @type {any} */ clip, /** @type {string | null} */ handle, /** @type {boolean} */ alone) {
		const main = $('tlMain');
		const rect = main.getBoundingClientRect();
		const startX = e.clientX;
		const startY = e.clientY;
		const ids = handle ? (alone ? [clip.id] : linkedIds([clip.id])) : selection;
		const originals = ids.map(i => structuredClone(clipOf(i))).filter(Boolean);
		const { rows } = layout();
		const rowAt = (/** @type {number} */ y) => rows.find(r => y >= r.top && y < r.top + r.height + 2);
		let moved = false;
		const onMove = (/** @type {PointerEvent} */ ev) => {
			const dx = (ev.clientX - startX) / pxPerSec;
			if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) {
				return;
			}
			moved = true;
			preview = new Map();
			if (handle === 'l' || handle === 'r') {
				for (const o of originals) {
					const media = mediaOf(o);
					const c = structuredClone(o);
					if (handle === 'l') {
						let start = snap(snapTime(o.start + dx), ids);
						const minStart = media && media.kind !== 'image' ? o.start - o.in / o.speed : 0;
						start = Math.max(minStart, Math.min(end(o) - frame(), start));
						c.in = o.in + (start - o.start) * o.speed;
						c.start = start;
					} else {
						let stop = snap(snapTime(end(o) + dx), ids);
						const maxOut = media && media.kind !== 'image' ? media.duration : Infinity;
						stop = Math.max(o.start + frame(), stop);
						c.out = Math.min(maxOut, o.in + (stop - o.start) * o.speed);
					}
					preview.set(c.id, c);
				}
				$('tlHint').textContent = `Durée ${shortTime(dur(preview.get(clip.id)))}`;
			} else {
				// Move: the grabbed clip snaps, the others follow; vertical drag changes track.
				const grabbed = originals.find(o => o.id === clip.id) ?? originals[0];
				const snapped = snap(snapTime(grabbed.start + dx), ids);
				const shift = Math.max(-Math.min(...originals.map(o => o.start)), snapped - grabbed.start);
				const fromRow = rowAt(startY - rect.top - 26 + $('tlMain').scrollTop);
				const toRow = rowAt(ev.clientY - rect.top - 26 + $('tlMain').scrollTop);
				for (const o of originals) {
					const c = structuredClone(o);
					c.start = o.start + shift;
					if (fromRow && toRow && fromRow.id !== toRow.id && trackOf(o.track).kind === toRow.kind && (o.track === fromRow.id)) {
						c.track = toRow.id;
					}
					preview.set(c.id, c);
				}
				$('tlHint').textContent = `${shift >= 0 ? '+' : '−'}${shortTime(Math.abs(shift))} · ${timecode(snapped)}`;
			}
			renderTimeline();
			livePreview([...preview.values()]);
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			$('snapline').hidden = true;
			$('tlHint').textContent = '';
			if (moved && preview) {
				const changes = [...preview.values()];
				preview = null;
				const ops = changes.map(c => ({ op: 'update', id: c.id, patch: { start: c.start, in: c.in, out: c.out, track: c.track } }));
				// Ripple trim: the clips after a shortened clip follow its end.
				if (ripple && handle === 'r') {
					const o = originals.find(x => x.id === clip.id);
					const delta = end(changes.find(c => c.id === clip.id)) - end(o);
					for (const other of project.clips) {
						if (!ids.includes(other.id) && other.start >= end(o) - 1e-3) {
							ops.push({ op: 'update', id: other.id, patch: { start: other.start + delta } });
						}
					}
				}
				edit(handle ? 'Raccourcir' : 'Déplacer', ops);
			} else {
				preview = null;
			}
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	function startMarquee(/** @type {PointerEvent} */ e) {
		const main = $('tlMain');
		const rect = main.getBoundingClientRect();
		const x0 = e.clientX - rect.left;
		const y0 = e.clientY - rect.top;
		const box = $('marquee');
		let moved = false;
		const onMove = (/** @type {PointerEvent} */ ev) => {
			const x1 = ev.clientX - rect.left;
			const y1 = ev.clientY - rect.top;
			if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) {
				return;
			}
			moved = true;
			box.hidden = false;
			Object.assign(box.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
			const r = box.getBoundingClientRect();
			selection = [...document.querySelectorAll('.clip')].filter(c => {
				const b = c.getBoundingClientRect();
				return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
			}).map(c => /** @type {string} */ (c.getAttribute('data-clip')));
			document.querySelectorAll('.clip').forEach(c => c.classList.toggle('sel', selection.includes(/** @type {string} */ (c.getAttribute('data-clip')))));
		};
		const onUp = (/** @type {PointerEvent} */ ev) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			box.hidden = true;
			if (!moved) {
				selection = [];
				engine.seek(snapTime(xToTime(ev.clientX - rect.left)));
			}
			renderSelection();
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// Ruler: scrub.
	$('ruler').addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
		const rect = $('tlMain').getBoundingClientRect();
		const wasPlaying = engine.playing;
		engine.pause();
		const at = (/** @type {PointerEvent} */ ev) => engine.seek(snap(snapTime(xToTime(ev.clientX - rect.left)), []));
		at(e);
		const onMove = (/** @type {PointerEvent} */ ev) => at(ev);
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			$('snapline').hidden = true;
			if (wasPlaying) {
				engine.play();
			}
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	});
	$('playhead').addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => $('ruler').dispatchEvent(new PointerEvent('pointerdown', e)));

	// Zoom and scroll.
	const zoomTo = (/** @type {number} */ next, /** @type {number} */ anchorX = $('tlMain').clientWidth / 2) => {
		const t = xToTime(anchorX);
		pxPerSec = Math.min(600, Math.max(0.5, next));
		scrollX = Math.max(0, t * pxPerSec - (anchorX - HEADER_W));
		$('zoom').value = String(Math.round(Math.log(pxPerSec / 0.5) / Math.log(1200) * 1000));
		renderTimeline();
		requestAnimationFrame(() => { $('tlScroll').scrollLeft = scrollX; });
	};
	$('zoom').addEventListener('input', () => zoomTo(0.5 * Math.pow(1200, Number($('zoom').value) / 1000)));
	$('zoomIn').onclick = () => zoomTo(pxPerSec * 1.5);
	$('zoomOut').onclick = () => zoomTo(pxPerSec / 1.5);
	const fit = () => {
		const width = $('tlMain').clientWidth - HEADER_W - 40;
		pxPerSec = Math.min(600, Math.max(0.5, width / Math.max(1, total())));
		scrollX = 0;
		zoomTo(pxPerSec, HEADER_W);
	};
	$('fit').onclick = fit;
	$('tlMain').addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			zoomTo(pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - $('tlMain').getBoundingClientRect().left);
		} else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
			scrollX = Math.max(0, scrollX + (e.deltaX || e.deltaY));
			$('tlScroll').scrollLeft = scrollX;
			renderTimeline();
		} else {
			$('tlMain').scrollTop += e.deltaY;
		}
	}, { passive: false });
	const tlScroll = /** @type {HTMLElement} */ (document.querySelector('.tl-scroll'));
	tlScroll.id = 'tlScroll';
	tlScroll.addEventListener('scroll', () => {
		if (Math.abs(tlScroll.scrollLeft - scrollX) > 1) {
			scrollX = tlScroll.scrollLeft;
			renderTimeline();
		}
	});

	// Drag media from the bin (or files from the explorer) onto the timeline.
	document.addEventListener('dragstart', (/** @type {DragEvent} */ e) => {
		const m = /** @type {HTMLElement} */ (e.target).closest?.('[data-media]');
		if (m && e.dataTransfer) {
			e.dataTransfer.setData('application/x-starcapture-media', /** @type {string} */ (m.getAttribute('data-media')));
			e.dataTransfer.effectAllowed = 'copy';
		}
	});
	$('timeline').addEventListener('dragover', (/** @type {DragEvent} */ e) => {
		e.preventDefault();
		const t = snap(snapTime(xToTime(e.clientX - $('tlMain').getBoundingClientRect().left)), []);
		$('tlHint').textContent = `Déposer à ${timecode(t)}`;
	});
	$('timeline').addEventListener('drop', (/** @type {DragEvent} */ e) => {
		e.preventDefault();
		$('snapline').hidden = true;
		const rect = $('tlMain').getBoundingClientRect();
		const t = snap(snapTime(xToTime(e.clientX - rect.left)), []);
		const row = layout().rows.find(r => e.clientY - rect.top - 26 + $('tlMain').scrollTop >= r.top && e.clientY - rect.top - 26 + $('tlMain').scrollTop < r.top + r.height + 2);
		const media = e.dataTransfer?.getData('application/x-starcapture-media');
		if (media) {
			edit('Ajouter un clip', [{ op: 'addMedia', media, start: t, track: row?.id }]);
			return;
		}
		dropFiles(e, t, row?.id);
	});
	$('stage').addEventListener('dragover', (/** @type {DragEvent} */ e) => {
		e.preventDefault();
		$('drop').hidden = false;
	});
	$('stage').addEventListener('dragleave', () => { $('drop').hidden = true; });
	$('stage').addEventListener('drop', (/** @type {DragEvent} */ e) => {
		e.preventDefault();
		$('drop').hidden = true;
		const media = e.dataTransfer?.getData('application/x-starcapture-media');
		if (media) {
			edit('Ajouter un clip', [{ op: 'addMedia', media, start: snapTime(engine.time) }]);
			return;
		}
		dropFiles(e, snapTime(engine.time));
	});

	// The library takes files too: they join the project without going on the timeline.
	const overLibrary = (/** @type {boolean} */ on) => $('panel').classList.toggle('dropping', on);
	$('panel').addEventListener('dragover', (/** @type {DragEvent} */ e) => {
		if (e.dataTransfer?.types.includes('application/x-starcapture-media')) {
			return; // a media of the library itself, on its way to the timeline
		}
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'copy';
		}
		overLibrary(true);
	});
	$('panel').addEventListener('dragleave', (/** @type {DragEvent} */ e) => {
		if (!$('panel').contains(/** @type {Node | null} */ (e.relatedTarget))) {
			overLibrary(false);
		}
	});
	$('panel').addEventListener('drop', (/** @type {DragEvent} */ e) => {
		overLibrary(false);
		if (e.dataTransfer?.types.includes('application/x-starcapture-media')) {
			return;
		}
		e.preventDefault();
		if (tab !== 'media') {
			tab = 'media';
			renderPanel();
		}
		dropFiles(e, undefined);
	});
	// Dropped beside every target, a file would make the page navigate to it.
	window.addEventListener('dragover', e => e.preventDefault());
	window.addEventListener('drop', e => e.preventDefault());

	const MEDIA_FILE = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|gif|webp)$/i;
	/** @type {Map<string, () => void>} */
	const uploadAcks = new Map();

	/**
	 * Files dropped from Windows (the desktop, a folder) reach the page as contents, without a path.
	 * They are handed to Orbit piece by piece, which keeps them in the « medias » folder of the montage.
	 */
	async function uploadFiles(/** @type {File[]} */ files, /** @type {number | undefined} */ at, /** @type {string | undefined} */ track) {
		const PIECE = 4 * 1024 * 1024;
		for (let n = 0; n < files.length; n++) {
			const file = files[n];
			const id = `${Date.now().toString(36)}${n}`;
			const many = files.length > 1 ? ` (${n + 1}/${files.length})` : '';
			for (let offset = 0; offset < file.size || offset === 0; offset += PIECE) {
				const data = new Uint8Array(await file.slice(offset, offset + PIECE).arrayBuffer());
				const last = offset + PIECE >= file.size;
				const done = new Promise(resolve => uploadAcks.set(id, () => resolve(undefined)));
				vscode.postMessage({ type: 'upload', id, name: file.name, offset, data, last, at, track });
				await done;
				toast(last ? `${file.name} importé${many}` : `Import de ${file.name}${many} : ${Math.round((offset + PIECE) / file.size * 100)} %`);
			}
		}
	}

	/** Files dropped from Orbit's explorer arrive as URIs. */
	function dropFiles(/** @type {DragEvent} */ e, /** @type {number | undefined} */ at, /** @type {string | undefined} */ track = undefined) {
		const list = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
		const paths = list.map(u => {
			try {
				return u.startsWith('file:') ? decodeURIComponent(new URL(u).pathname).replace(/^\/([a-zA-Z]:)/, '$1') : u;
			} catch {
				return u;
			}
		}).filter(p => MEDIA_FILE.test(p));
		if (paths.length) {
			vscode.postMessage({ type: 'importPaths', paths, at, track });
			return;
		}
		const all = Array.from(e.dataTransfer?.files ?? []);
		const files = all.filter(file => MEDIA_FILE.test(file.name));
		if (files.length) {
			uploadFiles(files, at, track);
		} else if (all.length || list.length) {
			toast('StarCapture prend les vidéos, les sons et les images.', true);
		}
	}

	// --- panel actions

	$('panel').addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const t = /** @type {HTMLElement} */ (e.target);
		const gone = t.closest('[data-relink]');
		if (gone) {
			vscode.postMessage({ type: 'relink', id: gone.getAttribute('data-relink') });
			return;
		}
		const add = t.closest('[data-add]');
		if (add) {
			edit('Ajouter un clip', [{ op: 'addMedia', media: add.getAttribute('data-add'), start: snapTime(engine.time) }]);
			return;
		}
		const text = t.closest('[data-text]');
		if (text) {
			const preset = /** @type {string} */ (text.getAttribute('data-text'));
			const sample = TEXT_PRESETS.find(p => p.id === preset)?.sample.replace(/<[^>]+>/g, '') ?? 'Texte';
			edit('Ajouter un texte', [{ op: 'addText', content: sample, start: snapTime(engine.time), duration: preset === 'youtube' || preset === 'beast' ? 1.2 : 3, preset }]);
			return;
		}
		const tr = t.closest('[data-transition]');
		if (tr) {
			const type = tr.getAttribute('data-transition');
			const targets = selection.map(clipOf).filter(c => c && trackOf(c.track)?.kind === 'video');
			const list = targets.length ? targets : project.clips.filter((/** @type {any} */ c) => trackOf(c.track)?.kind === 'video' && c.start <= engine.time + 1e-3 && end(c) > engine.time).slice(0, 1);
			if (!list.length) {
				toast('Sélectionne le clip qui doit entrer avec la transition', true);
				return;
			}
			edit('Transition', list.map((/** @type {any} */ c) => ({ op: 'transition', id: c.id, type, duration: 0.5 })));
			return;
		}
		const fx = t.closest('[data-fx]');
		if (fx) {
			applyEffect(/** @type {string} */ (fx.getAttribute('data-fx')));
			return;
		}
		const look = t.closest('[data-look]');
		if (look) {
			applyLook(/** @type {string} */ (look.getAttribute('data-look')), selection);
			return;
		}
		const seek = t.closest('[data-seek]');
		if (seek) {
			engine.seek(Number(seek.getAttribute('data-seek')));
		}
	});
	$('panel').addEventListener('dblclick', (/** @type {MouseEvent} */ e) => {
		const m = /** @type {HTMLElement} */ (e.target).closest('[data-media]');
		if (m) {
			edit('Ajouter un clip', [{ op: 'addMedia', media: m.getAttribute('data-media'), start: snapTime(engine.time) }]);
		}
	});
	$('inspector').addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const seek = /** @type {HTMLElement} */ (e.target).closest('[data-seek]');
		if (seek) {
			engine.seek(Number(seek.getAttribute('data-seek')));
		}
	});
	document.querySelectorAll('.tabs [data-tab]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => {
		tab = /** @type {string} */ (b.dataset.tab);
		renderPanel();
	});

	/** The video clip to act on: selected, or under the playhead on the top-most video track. */
	function targetVideoClip() {
		const sel = selection.map(clipOf).find(c => c && mediaOf(c) && trackOf(c.track)?.kind === 'video');
		if (sel) {
			return sel;
		}
		const order = project.tracks.filter((/** @type {any} */ t) => t.kind === 'video').map((/** @type {any} */ t) => t.id);
		return project.clips.filter((/** @type {any} */ c) => order.includes(c.track) && c.start <= engine.time + 1e-3 && end(c) > engine.time && mediaOf(c)).sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track))[0];
	}

	function applyEffect(/** @type {string} */ fx) {
		const clip = targetVideoClip();
		if (!clip) {
			toast('Place la tête de lecture sur un clip vidéo', true);
			return;
		}
		const local = engine.time - clip.start;
		switch (fx) {
			case 'punch':
				edit('Zoom punch', [{ op: 'punchIn', id: clip.id, t: engine.time, zoom: 1.25, hold: 0.9 }]);
				break;
			case 'punchHold':
				edit('Zoom jump cut', [{ op: 'split', t: snapTime(engine.time), ids: [clip.id] }]);
				setTimeout(() => {
					const right = project.clips.find((/** @type {any} */ c) => c.track === clip.track && Math.abs(c.start - snapTime(engine.time)) < 1e-3);
					if (right) {
						edit('Recadrer plus serré', [{ op: 'update', id: right.id, patch: { scale: clip.scale * 1.18 } }]);
					}
				}, 250);
				break;
			case 'shake':
				edit('Secousse', [{ op: 'split', t: snapTime(engine.time), ids: [clip.id] }]);
				setTimeout(() => {
					const right = project.clips.find((/** @type {any} */ c) => c.track === clip.track && Math.abs(c.start - snapTime(engine.time)) < 1e-3);
					if (right) {
						edit('Secousse', [{ op: 'update', id: right.id, patch: { shake: 0.7 } }]);
					}
				}, 250);
				break;
			case 'kenburns':
				edit('Ken Burns', [{ op: 'update', id: clip.id, patch: { keyframes: { scale: [{ t: 0, v: clip.scale, ease: 'linear' }, { t: dur(clip), v: clip.scale * 1.15 }] } } }]);
				break;
			case 'speed2':
			case 'slow': {
				const speed = fx === 'speed2' ? 2 : 0.5;
				edit(fx === 'speed2' ? 'Accéléré' : 'Ralenti', linkedIds([clip.id]).map(id => ({ op: 'update', id, patch: { speed: clipOf(id).speed === speed ? 1 : speed } })));
				break;
			}
			case 'mirror':
				edit('Miroir', [{ op: 'update', id: clip.id, patch: { mirror: !clip.mirror } }]);
				break;
			case 'blur':
				edit('Flou', [{ op: 'update', id: clip.id, patch: { blur: clip.blur ? 0 : 4 } }]);
				break;
		}
		void local;
	}

	// --- speech: transcription, captions, silence and filler cuts

	const LANGUAGES = /** @type {Record<string, string>} */ ({ fr: 'french', en: 'english', es: 'spanish', de: 'german', it: 'italian', pt: 'portuguese', nl: 'dutch', ar: 'arabic', ja: 'japanese', ko: 'korean', zh: 'chinese', ru: 'russian', tr: 'turkish', pl: 'polish' });

	/** @type {Map<string, { resolve: (words: any[]) => void, previous: any }>} */
	const waitingTranscripts = new Map();

	/** Transcription by the extension (whisper.cpp); resolves when new words reach the project. */
	function transcribe(/** @type {string} */ mediaId, /** @type {string} */ language = 'fr') {
		toast('Transcription en cours…');
		return new Promise(resolve => {
			waitingTranscripts.set(mediaId, { resolve, previous: project.transcripts?.[mediaId] });
			vscode.postMessage({ type: 'transcribeNative', media: mediaId, language });
		});
	}

	/** Fallback when whisper.cpp cannot run: Whisper inside this page. */
	async function transcribeInPage(/** @type {string} */ mediaId, /** @type {string} */ language = 'fr') {
		// @ts-ignore
		const T = window.StarTranscribe;
		if (!T) {
			throw new Error('Whisper n\'a pas pu être chargé (connexion à cdn.jsdelivr.net ?)');
		}
		const media = project.media.find((/** @type {any} */ m) => m.id === mediaId);
		const status = (/** @type {string} */ s) => {
			const el = $('trStatus');
			if (el) {
				el.textContent = s;
			}
		};
		return T.transcribe(media, (/** @type {number} */ from, /** @type {number} */ to) => requestAudio(mediaId, from, to), status, LANGUAGES[language.toLowerCase().slice(0, 2)] ?? language);
	}

	/** @type {Map<string, { resolve: (v: Float32Array) => void, reject: (e: Error) => void }>} */
	const audioRequests = new Map();
	function requestAudio(/** @type {string} */ media, /** @type {number} */ from, /** @type {number} */ to) {
		const requestId = Math.random().toString(36).slice(2);
		return new Promise((resolve, reject) => {
			audioRequests.set(requestId, { resolve, reject });
			vscode.postMessage({ type: 'speechAudio', requestId, media, from, to });
		});
	}

	async function wordsOf(/** @type {string} */ mediaId) {
		return project.transcripts?.[mediaId] ?? await transcribe(mediaId);
	}

	async function autoCaptions(/** @type {string} */ mediaId) {
		const words = await wordsOf(mediaId);
		if (!words?.length) {
			return;
		}
		const placed = placedWords(mediaId, words);
		const track = project.tracks.find((/** @type {any} */ t) => t.kind === 'text');
		const ops = [];
		if (track) {
			// Fresh captions replace earlier automatic ones.
			const old = project.clips.filter((/** @type {any} */ c) => c.track === track.id && c.text?.wordTimes).map((/** @type {any} */ c) => c.id);
			if (old.length) {
				ops.push({ op: 'remove', ids: old });
			}
		}
		// 1 to 3 words per caption, never across a pause or a sentence end.
		let group = [];
		const flush = () => {
			if (!group.length) {
				return;
			}
			const start = group[0].t;
			const stop = Math.max(group[group.length - 1].end, start + 0.35);
			ops.push({ op: 'addText', content: group.map(w => w.w.replace(/[.,!?;:]+$/, '')).join(' '), start, duration: stop - start, preset: 'caption', style: { wordTimes: group.map(w => Math.max(0, w.t - start)) }, track: track?.id });
			group = [];
		};
		for (const w of placed) {
			const last = group[group.length - 1];
			if (last && (w.t - last.end > 0.4 || group.length >= 3 || /[.!?]$/.test(last.w) || group.map(g => g.w).join(' ').length > 18)) {
				flush();
			}
			group.push(w);
		}
		flush();
		// Each caption ends where the next one starts, so they never flicker.
		const texts = ops.filter(o => o.op === 'addText');
		for (let i = 0; i < texts.length - 1; i++) {
			const gap = texts[i + 1].start - (texts[i].start + texts[i].duration);
			if (gap > 0 && gap < 0.3) {
				texts[i].duration += gap;
			}
		}
		edit(`Sous-titres automatiques (${texts.length})`, ops);
		toast(`${texts.length} sous-titres ajoutés`);
	}

	function cutSilences(/** @type {string} */ mediaId) {
		vscode.postMessage({ type: 'cutSilences', media: mediaId });
	}

	async function cutFillers(/** @type {string} */ mediaId) {
		const words = await wordsOf(mediaId);
		if (!words?.length) {
			return;
		}
		const fillers = /^(euh+|heu+|hum+|hmm+|bah|ben|euuh+|uh+|um+|erm+)[.,!?]*$/i;
		const ranges = placedWords(mediaId, words).filter(w => fillers.test(w.w.trim())).map(w => [Math.max(0, w.t - 0.04), w.end + 0.04]);
		if (!ranges.length) {
			toast('Aucune hésitation trouvée');
			return;
		}
		edit(`Couper ${ranges.length} hésitations`, [{ op: 'removeRanges', ranges }]);
		toast(`${ranges.length} hésitations coupées`);
	}

	// --- viewer: direct manipulation of the selected clip

	function renderOverlay() {
		const ov = $('overlay');
		const clip = selection.length === 1 ? clipOf(selection[0]) : undefined;
		if (!clip || engine.playing || trackOf(clip.track)?.kind === 'audio' || engine.time < clip.start || engine.time >= end(clip)) {
			ov.innerHTML = '';
			return;
		}
		const cv = $('screen');
		const k = cv.clientWidth / project.width;
		const local = engine.time - clip.start;
		let w;
		let h;
		if (clip.text) {
			({ w, h } = engine.textBounds(clip));
		} else {
			const media = mediaOf(clip);
			const ratio = (media?.width || 16) / (media?.height || 9);
			const pr = project.width / project.height;
			[w, h] = clip.fit === 'stretch' ? [project.width, project.height] : (clip.fit === 'cover') === (ratio > pr) ? [project.height * ratio, project.height] : [project.width, project.width / ratio];
			const s = valueAt(clip, 'scale', local);
			w *= s;
			h *= s;
		}
		const x = (project.width / 2 + valueAt(clip, 'x', local)) * k;
		const y = (project.height / 2 + valueAt(clip, 'y', local)) * k;
		ov.innerHTML = `<div class="gizmo" style="left:${cv.offsetLeft + x}px;top:${cv.offsetTop + y}px;width:${w * k}px;height:${h * k}px;transform:translate(-50%,-50%) rotate(${valueAt(clip, 'rotation', local)}deg)"><i class="c tl" data-scale></i><i class="c tr" data-scale></i><i class="c bl" data-scale></i><i class="c br" data-scale></i></div>`;
	}

	$('overlay').addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
		const clip = selection.length === 1 ? clipOf(selection[0]) : undefined;
		const gizmo = /** @type {HTMLElement} */ (e.target).closest('.gizmo');
		if (!clip || !gizmo) {
			return;
		}
		const k = $('screen').clientWidth / project.width;
		const local = engine.time - clip.start;
		const scaling = /** @type {HTMLElement} */ (e.target).hasAttribute('data-scale');
		const sx = e.clientX;
		const sy = e.clientY;
		const x0 = valueAt(clip, 'x', local);
		const y0 = valueAt(clip, 'y', local);
		const s0 = clip.text ? clip.scale : valueAt(clip, 'scale', local);
		const rect = gizmo.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const d0 = Math.hypot(sx - cx, sy - cy);
		/** @type {any} */
		let next = null;
		const onMove = (/** @type {PointerEvent} */ ev) => {
			next = structuredClone(clip);
			if (scaling) {
				next.scale = Math.max(0.05, s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy) / Math.max(1, d0));
				if (next.keyframes?.scale?.length) {
					next.keyframes.scale = [];
				}
			} else {
				let nx = x0 + (ev.clientX - sx) / k;
				let ny = y0 + (ev.clientY - sy) / k;
				// Snap to the centre lines.
				if (Math.abs(nx) < 12 / k) {
					nx = 0;
				}
				if (Math.abs(ny) < 12 / k) {
					ny = 0;
				}
				next.x = Math.round(nx);
				next.y = Math.round(ny);
				next.keyframes = { ...next.keyframes, x: [], y: [] };
			}
			livePreview([next]);
			const g = /** @type {HTMLElement} */ ($('overlay').querySelector('.gizmo'));
			if (g && !scaling) {
				g.style.left = `${$('screen').offsetLeft + (project.width / 2 + next.x) * k}px`;
				g.style.top = `${$('screen').offsetTop + (project.height / 2 + next.y) * k}px`;
			}
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			if (next) {
				edit(scaling ? 'Échelle' : 'Position', [{ op: 'update', id: clip.id, patch: scaling ? { scale: next.scale, keyframes: next.keyframes } : { x: next.x, y: next.y, keyframes: next.keyframes } }]);
			}
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	});

	// --- transport and toolbar

	$('play').onclick = () => engine.toggle();
	// The preview alone on the whole screen. The system's own full screen is asked first (nothing
	// but the picture); an Orbit whose pages may not ask for it falls back on Zen mode.
	let cinema = false;
	let zen = false;
	let idle = /** @type {any} */ (0);
	const viewer = /** @type {HTMLElement} */ (document.querySelector('.viewer'));
	const wake = () => {
		document.body.classList.remove('idle');
		clearTimeout(idle);
		if (cinema) {
			idle = setTimeout(() => document.body.classList.add('idle'), 2200);
		}
	};
	const setCinema = async (/** @type {boolean} */ on) => {
		if (on === cinema) {
			return;
		}
		cinema = on;
		document.body.classList.toggle('cinema', on);
		if (on) {
			try {
				await viewer.requestFullscreen();
			} catch {
				zen = true;
				vscode.postMessage({ type: 'cinema', on: true });
			}
		} else {
			if (document.fullscreenElement) {
				await document.exitFullscreen().catch(() => undefined);
			}
			if (zen) {
				zen = false;
				vscode.postMessage({ type: 'cinema', on: false });
			}
		}
		wake();
		resizeViewer();
	};
	// Leaving full screen by any other way (the system's own Escape) leaves the mode too.
	document.addEventListener('fullscreenchange', () => {
		if (!document.fullscreenElement && cinema && !zen) {
			setCinema(false);
		}
		resizeViewer();
	});
	viewer.addEventListener('mousemove', wake);
	$('cinema').onclick = () => setCinema(!cinema);
	window.addEventListener('keydown', e => {
		if (cinema) {
			wake();
		}
		if (cinema && e.key === 'Escape') {
			e.stopPropagation();
			setCinema(false);
		}
	}, true);
	$('start').onclick = () => engine.seek(0);
	$('endBtn').onclick = () => engine.seek(total());
	$('prevFrame').onclick = () => engine.seek(engine.time - frame());
	$('nextFrame').onclick = () => engine.seek(engine.time + frame());
	$('quality').onchange = () => {
		engine.quality = Number($('quality').value);
		resizeViewer();
	};
	$('emptyImport').onclick = () => vscode.postMessage({ type: 'import', toTimeline: true });
	$('emptyClaude').onclick = () => vscode.postMessage({ type: 'askClaude', text: '' });
	$('export').onclick = () => vscode.postMessage({ type: 'export' });
	$('claude').onclick = () => vscode.postMessage({ type: 'askClaude', text: '' });
	$('undo').onclick = () => vscode.postMessage({ type: 'undo' });
	$('redo').onclick = () => vscode.postMessage({ type: 'redo' });
	$('splitBtn').onclick = () => splitAtPlayhead();
	$('deleteBtn').onclick = () => removeSelection(false);
	/** The media that carries the voice: the one selected, else the first that has sound. */
	const voiceMedia = () => {
		const chosen = selection.map(id => clipOf(id)).find(clip => clip?.media && mediaOf(clip)?.kind !== 'image');
		return chosen?.media ?? project?.media.find((/** @type {any} */ m) => m.kind !== 'image' && m.hasAudio !== false)?.id;
	};
	$('quickSilences').onclick = () => {
		const id = voiceMedia();
		id ? cutSilences(id) : toast('Importe d\'abord une vidéo ou un son', true);
	};
	$('quickCaptions').onclick = () => {
		const id = voiceMedia();
		id ? autoCaptions(id) : toast('Importe d\'abord une vidéo ou un son', true);
	};
	$('addTrack').onclick = async () => {
		const kind = await pick(['video', 'audio', 'text'], ['Piste vidéo', 'Piste audio', 'Piste de texte']);
		if (kind) {
			edit('Ajouter une piste', [{ op: 'track', kind }]);
		}
	};
	$('name').addEventListener('change', () => edit('Renommer', [{ op: 'project', patch: { name: $('name').value.trim() || 'Montage' } }]));
	document.querySelectorAll('[data-tool]').forEach((/** @type {HTMLElement} */ b) => b.onclick = () => setTool(/** @type {string} */ (b.dataset.tool)));
	$('snap').onclick = () => {
		snapping = !snapping;
		$('snap').classList.toggle('on', snapping);
	};
	$('ripple').onclick = () => {
		ripple = !ripple;
		$('ripple').classList.toggle('on', ripple);
		toast(ripple ? 'Montage en décalage : les trous se referment' : 'Montage en écrasement');
	};

	function setTool(/** @type {string} */ t) {
		tool = t;
		document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.getAttribute('data-tool') === t));
		$('timeline').classList.toggle('blade', t === 'blade');
	}

	/** A small menu at the toolbar (no native dialogs in a webview). */
	function pick(/** @type {string[]} */ values, /** @type {string[]} */ labels) {
		return new Promise(resolve => {
			const menu = document.createElement('div');
			menu.className = 'menu';
			menu.innerHTML = labels.map((l, i) => `<button data-v="${values[i]}">${l}</button>`).join('');
			const r = $('addTrack').getBoundingClientRect();
			menu.style.left = `${r.left}px`;
			menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
			document.body.appendChild(menu);
			const close = (/** @type {string | undefined} */ v) => {
				menu.remove();
				window.removeEventListener('pointerdown', outside, true);
				resolve(v);
			};
			const outside = (/** @type {Event} */ e) => {
				if (!menu.contains(/** @type {Node} */ (e.target))) {
					close(undefined);
				}
			};
			menu.addEventListener('click', e => {
				const b = /** @type {HTMLElement} */ (e.target).closest('[data-v]');
				if (b) {
					close(/** @type {string} */ (b.getAttribute('data-v')));
				}
			});
			setTimeout(() => window.addEventListener('pointerdown', outside, true));
		});
	}

	function removeSelection(/** @type {boolean} */ withRipple) {
		if (!selection.length) {
			return;
		}
		edit(withRipple ? 'Supprimer et recoller' : 'Supprimer', [{ op: 'remove', ids: selection, ripple: withRipple }]);
		selection = [];
		renderInspector();
	}

	/** Split at the playhead: the selected clips, or everything under it. */
	function splitAtPlayhead() {
		const t = snapTime(engine.time);
		const under = project.clips.filter((/** @type {any} */ c) => c.start < t - 1e-3 && end(c) > t + 1e-3);
		const ids = selection.length ? selection.filter(id => under.some((/** @type {any} */ c) => c.id === id)) : [];
		if (!under.length) {
			toast('Rien à couper sous la tête de lecture');
			return;
		}
		edit('Couper', [{ op: 'split', t, ids: ids.length ? ids : undefined }]);
	}

	document.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		const typing = /** @type {HTMLElement} */ (e.target).closest('input, textarea, select, [contenteditable]');
		if (typing) {
			if (e.key === 'Escape') {
				/** @type {HTMLElement} */ (e.target).blur();
			}
			return;
		}
		const k = e.key;
		const ctrl = e.ctrlKey || e.metaKey;
		if (k === ' ') {
			e.preventDefault();
			engine.toggle();
		} else if ((k === 'f' || k === 'F') && !ctrl && !e.altKey) {
			e.preventDefault();
			$('cinema').click();
		} else if (k === 'k' && !ctrl || k === 'K' && !ctrl) {
			engine.pause();
		} else if (k === 'l' && !ctrl) {
			engine.shuttle(engine.playing && engine.rate > 0 ? Math.min(8, engine.rate * 2) : 1);
		} else if (k === 'j' && !ctrl) {
			engine.shuttle(engine.playing && engine.rate < 0 ? Math.max(-8, engine.rate * 2) : -1);
		} else if (k === 'ArrowLeft') {
			e.preventDefault();
			engine.seek(engine.time - (e.shiftKey ? 1 : frame()));
		} else if (k === 'ArrowRight') {
			e.preventDefault();
			engine.seek(engine.time + (e.shiftKey ? 1 : frame()));
		} else if (k === 'ArrowUp' || k === 'ArrowDown') {
			// Jump to the previous / next cut.
			e.preventDefault();
			const cuts = [...new Set(project.clips.flatMap((/** @type {any} */ c) => [c.start, end(c)]))].sort((a, b) => a - b);
			const t = k === 'ArrowUp' ? [...cuts].reverse().find(c => c < engine.time - 1e-3) : cuts.find(c => c > engine.time + 1e-3);
			if (t !== undefined) {
				engine.seek(t);
			}
		} else if (k === 'Home') {
			engine.seek(0);
		} else if (k === 'End') {
			engine.seek(total());
		} else if ((k === 's' || k === 'S') && !ctrl || (k === 'k' && ctrl)) {
			e.preventDefault();
			splitAtPlayhead();
		} else if (k === 'Delete' || k === 'Backspace') {
			e.preventDefault();
			removeSelection(e.shiftKey || ripple);
		} else if (k === 'c' && !ctrl) {
			setTool(tool === 'blade' ? 'select' : 'blade');
		} else if (k === 'v' && !ctrl) {
			setTool('select');
		} else if (k === 'n' && !ctrl) {
			$('snap').click();
		} else if (k === 'r' && !ctrl) {
			$('ripple').click();
		} else if (k === 'm' && !ctrl) {
			edit('Marqueur', [{ op: 'marker', t: snapTime(engine.time), label: `Marqueur ${project.markers.length + 1}` }]);
		} else if (k === 'i' && !ctrl) {
			inOut = [snapTime(engine.time), Math.max(snapTime(engine.time) + frame(), inOut?.[1] ?? total())];
			engine.loop = null;
			renderRuler();
		} else if (k === 'o' && !ctrl) {
			inOut = [Math.min(inOut?.[0] ?? 0, snapTime(engine.time) - frame()), snapTime(engine.time)];
			renderRuler();
		} else if (k === 'x' && !ctrl) {
			inOut = null;
			engine.loop = null;
			renderRuler();
		} else if ((k === '+' || k === '=') && !ctrl) {
			zoomTo(pxPerSec * 1.5);
		} else if (k === '-' && !ctrl) {
			zoomTo(pxPerSec / 1.5);
		} else if ((k === 'Z' || k === 'z') && e.shiftKey && !ctrl) {
			fit();
		} else if (k === 'a' && ctrl) {
			e.preventDefault();
			selection = project.clips.map((/** @type {any} */ c) => c.id);
			renderSelection();
		} else if (k === 'd' && ctrl) {
			e.preventDefault();
			if (selection.length) {
				edit('Dupliquer', [{ op: 'duplicate', ids: selection }]);
			}
		} else if (k === 'c' && ctrl) {
			clipboard = selection.map(id => structuredClone(clipOf(id))).filter(Boolean);
			if (clipboard.length) {
				toast(`${clipboard.length} clip${clipboard.length > 1 ? 's' : ''} copié${clipboard.length > 1 ? 's' : ''}`);
			}
		} else if (k === 'v' && ctrl && clipboard?.length) {
			const first = Math.min(...clipboard.map(c => c.start));
			const at = snapTime(engine.time);
			edit('Coller', [{ op: 'duplicate', ids: clipboard.map(c => c.id), offset: at - first }]);
		} else if (k === 'Escape') {
			selection = [];
			setTool('select');
			renderSelection();
		} else if (k === 'e' && ctrl) {
			e.preventDefault();
			vscode.postMessage({ type: 'export' });
		} else if (k === '/' || k === '?') {
			toast('Espace lecture · J/K/L navette · ←→ image · ↑↓ coupe précédente/suivante · S couper · C lame · Suppr / Maj+Suppr · M marqueur · I/O entrée/sortie · Ctrl+D dupliquer · +/- zoom · Maj+Z tout voir');
		}
	});

	// The split between viewer and timeline follows the handle, and is remembered.
	const savedHeight = vscode.getState()?.timelineHeight;
	if (savedHeight) {
		document.documentElement.style.setProperty('--tl-h', `${savedHeight}px`);
	}
	$('tlResize').addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
		e.preventDefault();
		const onMove = (/** @type {PointerEvent} */ ev) => {
			const h = Math.min(window.innerHeight - 200, Math.max(140, window.innerHeight - ev.clientY));
			document.documentElement.style.setProperty('--tl-h', `${h}px`);
			vscode.setState({ ...(vscode.getState() ?? {}), timelineHeight: h });
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	});

	// --- viewer size

	function resizeViewer() {
		const stage = $('stage');
		// Full screen: the picture goes edge to edge.
		const margin = document.body.classList.contains('cinema') ? 0 : 24;
		engine.resize(stage.clientWidth - margin, stage.clientHeight - margin);
		renderOverlay();
	}
	new ResizeObserver(() => {
		resizeViewer();
		renderTimeline();
	}).observe(document.body);

	// The listening volume: how loud the montage plays here. It is the viewer's own setting, kept
	// from one montage to the next, and never part of what is exported.
	{
		let level = 1;
		let muted = false;
		try {
			const kept = JSON.parse(localStorage.getItem('starcapture.listen') ?? '{}');
			level = typeof kept.level === 'number' ? Math.min(1, Math.max(0, kept.level)) : 1;
			muted = kept.muted === true;
		} catch {
			// no storage here: full volume
		}
		const apply = () => {
			engine.volume = muted ? 0 : level;
			engine.dirty = true;
			if (!engine.playing) {
				engine.sync(false);
			}
			$('listen').value = String(muted ? 0 : level);
			$('listen').style.setProperty('--part', `${(muted ? 0 : level) * 100}%`);
			$('listenMute').innerHTML = speaker(!muted && level > 0);
			$('listenMute').title = muted || level === 0 ? 'Rétablir le son' : 'Couper le son de l\'écoute';
			try {
				localStorage.setItem('starcapture.listen', JSON.stringify({ level, muted }));
			} catch {
				// not kept
			}
		};
		$('listen').oninput = () => {
			level = Number($('listen').value);
			muted = false;
			apply();
		};
		$('listenMute').onclick = () => {
			if (!muted && level === 0) {
				level = 1;
			} else {
				muted = !muted;
			}
			apply();
		};
		apply();
	}

	// The bar under the picture: the whole montage from left to right, to go anywhere in one
	// click or by dragging, in the window as in full screen.
	const renderScrub = () => {
		const part = total() > 0 ? Math.min(1, Math.max(0, engine.time / total())) : 0;
		$('scrubFill').style.width = `${part * 100}%`;
		$('scrubKnob').style.left = `${part * 100}%`;
	};
	{
		const bar = $('scrub');
		const timeAt = (/** @type {PointerEvent} */ e) => {
			const rect = bar.getBoundingClientRect();
			return Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width))) * total();
		};
		const tip = (/** @type {PointerEvent} */ e) => {
			const rect = bar.getBoundingClientRect();
			$('scrubTip').textContent = timecode(timeAt(e));
			$('scrubTip').style.left = `${Math.min(rect.width - 34, Math.max(34, e.clientX - rect.left))}px`;
			$('scrubTip').hidden = false;
		};
		let resume = false;
		bar.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
			if (e.button !== 0 || !project) {
				return;
			}
			e.preventDefault();
			bar.setPointerCapture(e.pointerId);
			bar.classList.add('dragging');
			// Dragging shows each picture on the way; playback picks up where the bar is let go.
			resume = engine.playing;
			if (resume) {
				engine.pause();
			}
			engine.seek(snapTime(timeAt(e)));
		});
		bar.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
			tip(e);
			if (bar.classList.contains('dragging')) {
				engine.seek(snapTime(timeAt(e)));
			}
		});
		const release = () => {
			if (!bar.classList.contains('dragging')) {
				return;
			}
			bar.classList.remove('dragging');
			if (resume) {
				engine.play();
			}
		};
		bar.addEventListener('pointerup', release);
		bar.addEventListener('pointercancel', release);
		bar.addEventListener('pointerleave', () => { $('scrubTip').hidden = true; });
	}

	engine.onTime = () => {
		renderScrub();
		renderPlayhead();
		follow();
		if (!engine.playing) {
			renderOverlay();
			throttleInspector();
		}
	};
	let inspectorTimer = 0;
	const throttleInspector = () => {
		clearTimeout(inspectorTimer);
		inspectorTimer = setTimeout(() => {
			if (selection.length === 1) {
				renderInspector();
			}
			sendView();
		}, 120);
	};
	engine.onMediaError = (/** @type {string} */ id) => {
		const media = project.media.find((/** @type {any} */ m) => m.id === id);
		toast(`${media?.name ?? 'Un média'} n'est pas lisible ici : préparation d'une copie de lecture…`);
		vscode.postMessage({ type: 'proxy', media: id });
	};
	setInterval(() => {
		const m = $('meter');
		m.style.width = `${Math.min(100, engine.meter.l * 100)}%`;
		m.classList.toggle('hot', engine.meter.l > 0.95);
		showPlayState();
	}, 80);

	// --- messages

	window.addEventListener('message', async (/** @type {MessageEvent} */ ev) => {
		const msg = ev.data;
		switch (msg.type) {
			case 'creations':
				creations = msg.list ?? [];
				if (tab === 'creations') {
					renderPanel();
				}
				break;
			case 'project': {
				const first = !project;
				project = msg.project;
				for (const id of Object.keys(pictures)) {
					// A file found again, or pointed elsewhere, gets a new thumbnail.
					if (uris[id] !== msg.media[id] || missing.has(id) !== (msg.missing ?? []).includes(id)) {
						delete pictures[id];
					}
				}
				uris = msg.media;
				missing = new Set(msg.missing ?? []);
				selection = selection.filter(id => clipOf(id));
				engine.setProject(project, uris);
				if (document.activeElement !== $('name')) {
					$('name').value = project.name;
				}
				$('total').textContent = timecode(total());
				if (first) {
					resizeViewer();
					requestAnimationFrame(fit);
				}
				renderPanel();
				renderInspector();
				renderTimeline();
				renderOverlay();
				$('emptyState').hidden = project.media.length > 0 || project.clips.length > 0;
				for (const [id, wait] of waitingTranscripts) {
					const words = project.transcripts?.[id];
					if (words && JSON.stringify(words) !== JSON.stringify(wait.previous)) {
						waitingTranscripts.delete(id);
						wait.resolve(words);
						toast(`Transcription terminée : ${project.transcripts[id].length} mots`);
					}
				}
				break;
			}
			case 'peaks': {
				const bin = atob(msg.peaks);
				const arr = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) {
					arr[i] = bin.charCodeAt(i);
				}
				peaks[msg.media] = arr;
				renderTimeline();
				break;
			}
			case 'uploaded':
				uploadAcks.get(msg.id)?.();
				uploadAcks.delete(msg.id);
				break;
			case 'strip':
				strips[msg.media] = msg;
				renderTimeline();
				if (tab === 'media') {
					renderPanel();
				}
				break;
			case 'toast':
				toast(msg.text, !!msg.error);
				break;
			case 'proxy':
				engine.useProxy(msg.media, msg.uri);
				toast('Copie de lecture prête');
				break;
			case 'command':
				if (msg.name === 'play') {
					engine.seek(msg.t);
					engine.play();
				} else {
					engine.pause();
					engine.seek(msg.t);
				}
				break;
			case 'renderFrame':
				try {
					const dataUrl = await engine.renderFrame(msg.t, msg.width);
					vscode.postMessage({ type: 'reply', requestId: msg.requestId, value: { dataUrl } });
				} catch (err) {
					vscode.postMessage({ type: 'reply', requestId: msg.requestId, error: String(err) });
				}
				break;
			case 'trStatus': {
				const el = $('trStatus');
				if (el) {
					el.textContent = msg.text;
				}
				break;
			}
			case 'transcribe':
				try {
					tab = 'ai';
					renderPanel();
					const words = await transcribeInPage(msg.media, msg.language || 'fr');
					vscode.postMessage({ type: 'reply', requestId: msg.requestId, value: { words } });
				} catch (err) {
					vscode.postMessage({ type: 'reply', requestId: msg.requestId, error: err instanceof Error ? err.message : String(err) });
				}
				break;
			case 'speechAudio': {
				const req = audioRequests.get(msg.requestId);
				if (req) {
					audioRequests.delete(msg.requestId);
					if (msg.error) {
						req.reject(new Error(msg.error));
					} else {
						const bin = atob(msg.data);
						const bytes = new Uint8Array(bin.length);
						for (let i = 0; i < bin.length; i++) {
							bytes[i] = bin.charCodeAt(i);
						}
						req.resolve(new Float32Array(bytes.buffer));
					}
				}
				break;
			}
		}
	});

	// --- icons drawn for the editor

	function starMark() {
		return '<svg viewBox="0 0 24 24" width="18" height="18"><defs><linearGradient id="scg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd166"/><stop offset=".55" stop-color="#ff6b9a"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs><path fill="url(#scg)" d="M12 1.8l2.6 6.2 6.7.6-5.1 4.4 1.6 6.5L12 16.1 6.2 19.5l1.6-6.5L2.7 8.6l6.7-.6z"/><circle cx="12" cy="11.6" r="2.6" fill="#0a0918"/><circle cx="12" cy="11.6" r="1.1" fill="#fff"/></svg>';
	}
	function blade() {
		return '<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/><path d="M6.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/><path d="M8.6 7.4L20 18"/><path d="M8.6 16.6L20 6"/></svg>';
	}
	function magnet() {
		return '<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v8a7 7 0 0 0 14 0V4"/><path d="M5 4h4v8a3 3 0 0 0 6 0V4h4"/><path d="M5 8h4M15 8h4"/></svg>';
	}
	function rippleIcon() {
		return '<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8h6v8h-6z"/><path d="M14.5 8h6v8h-6z"/><path d="M12 4v16" stroke-dasharray="2 2.5"/></svg>';
	}
	function tIcon() {
		return '<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/></svg>';
	}
	function skip(/** @type {boolean} */ back) {
		return `<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${back ? '' : 'style="transform:scaleX(-1)"'}><path d="M6 5v14"/><path fill="currentColor" stroke="none" d="M18 5.8v12.4c0 .8-.9 1.3-1.6.8L8.7 13a1.2 1.2 0 0 1 0-2l7.7-6c.7-.5 1.6 0 1.6.8z"/></svg>`;
	}
	function turn(/** @type {boolean} */ back) {
		return `<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${back ? 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3' : 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3'}"/></svg>`;
	}
	function splitIcon() {
		return '<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M7 8H4v8h3M17 8h3v8h-3"/></svg>';
	}
	function waveIcon() {
		return '<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h3l2-5 3 10 2.5-7 1.5 2h4"/></svg>';
	}
	function minus() {
		return '<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5.5 12h13"/></svg>';
	}
	function diamond() {
		return '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M6 1l5 5-5 5-5-5z" fill="currentColor"/></svg>';
	}
	function eye(/** @type {boolean} */ open) {
		return `<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><path d="M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z"/>${open ? '' : '<path d="M4 20L20 4"/>'}</svg>`;
	}
	function speaker(/** @type {boolean} */ on) {
		return `<svg class="oi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>${on ? '<path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>' : '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'}</svg>`;
	}

	// For diagnostics from developer tools.
	// @ts-ignore
	window.StarCaptureDebug = { engine, get project() { return project; }, get selection() { return selection; } };

	vscode.postMessage({ type: 'ready' });
})();
