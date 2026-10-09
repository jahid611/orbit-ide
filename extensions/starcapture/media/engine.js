/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// StarCapture's playback engine: composites the timeline into a canvas, frame by frame,
// with the same rules as the ffmpeg export (fit, transform, keyframes, colour, fades,
// transitions, text animations, karaoke captions). Media play through <video>/<audio>
// elements kept in sync with a master clock; sound goes through Web Audio (gain > 1).

(function () {
	const EPS = 1e-4;
	const dur = (/** @type {any} */ c) => Math.max(0, (c.out - c.in) / (c.speed || 1));
	const end = (/** @type {any} */ c) => c.start + dur(c);
	const clamp = (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, v));
	const smooth = (/** @type {number} */ p) => p * p * (3 - 2 * p);

	function ease(/** @type {number} */ p, /** @type {string | undefined} */ kind) {
		switch (kind) {
			case 'linear': return p;
			case 'in': return p * p * p;
			case 'out': return 1 - Math.pow(1 - p, 3);
			default: return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
		}
	}

	/** Value of an animatable property `local` seconds into a clip. */
	function valueAt(/** @type {any} */ clip, /** @type {string} */ prop, /** @type {number} */ local) {
		const base = clip[prop];
		const keys = clip.keyframes?.[prop];
		if (!keys?.length) {
			return base;
		}
		const sorted = [...keys].sort((a, b) => a.t - b.t);
		if (local <= sorted[0].t) {
			return sorted[0].v;
		}
		for (let i = 0; i < sorted.length - 1; i++) {
			const a = sorted[i];
			const b = sorted[i + 1];
			if (local <= b.t) {
				if (a.ease === 'hold') {
					return a.v;
				}
				return a.v + (b.v - a.v) * ease((local - a.t) / Math.max(1e-6, b.t - a.t), a.ease);
			}
		}
		return sorted[sorted.length - 1].v;
	}

	class Engine {
		/**
		 * @param {HTMLCanvasElement} canvas
		 */
		constructor(canvas) {
			this.canvas = canvas;
			this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { alpha: false }));
			/** @type {any} */
			this.project = null;
			/** @type {Record<string, string>} */
			this.uris = {};
			/** Playable replacements (proxies) for media the browser cannot decode. */
			/** @type {Record<string, string>} */
			this.proxies = {};
			this.time = 0;
			this.playing = false;
			/** Play was asked and the videos are getting to their frame. */
			this.starting = false;
			this.rate = 1;
			/** Loop region, when set. */
			/** @type {[number, number] | null} */
			this.loop = null;
			this.anchor = 0;
			this.anchorTime = 0;
			this.quality = 1;
			/** @type {Map<string, { el: HTMLMediaElement, gain?: GainNode, media: string, used: number }>} */
			this.elements = new Map();
			/** @type {Map<string, HTMLImageElement>} */
			this.images = new Map();
			/** @type {AudioContext | null} */
			this.audio = null;
			/** @type {GainNode | null} */
			this.master = null;
			this.meter = { l: 0, r: 0 };
			/** @type {AnalyserNode | null} */
			this.analyser = null;
			/** @type {(t: number) => void} */
			this.onTime = () => { };
			/** @type {(id: string, error: string) => void} */
			this.onMediaError = () => { };
			this.volume = 1;
			this.dirty = true;
			this.heldSince = performance.now();
			this.loopFrame = this.loopFrame.bind(this);
			requestAnimationFrame(this.loopFrame);
		}

		setProject(/** @type {any} */ project, /** @type {Record<string, string>} */ uris) {
			this.project = project;
			this.uris = uris;
			this.dirty = true;
			// An edit made while the montage plays must not stop its videos: sync(false) paused and
			// repositioned them all, the clock went on, and the picture jerked or went black.
			this.sync(this.playing);
		}

		duration() {
			return this.project ? this.project.clips.reduce((m, /** @type {any} */ c) => Math.max(m, end(c)), 0) : 0;
		}

		ensureAudio() {
			if (!this.audio) {
				this.audio = new AudioContext({ latencyHint: 'interactive' });
				this.master = this.audio.createGain();
				this.analyser = this.audio.createAnalyser();
				this.analyser.fftSize = 1024;
				this.master.connect(this.analyser);
				this.analyser.connect(this.audio.destination);
			}
			if (this.audio.state === 'suspended') {
				this.audio.resume();
			}
		}

		/** The videos on screen at the playhead that cannot show a picture yet (still seeking or loading). */
		waitingVideo() {
			if (!this.project) {
				return false;
			}
			for (const clip of this.activeAt(this.time)) {
				const media = this.mediaOf(clip);
				const track = this.track(clip.track);
				if (!media || media.kind === 'image' || !track || track.kind !== 'video' || track.hidden) {
					continue;
				}
				const el = this.elements.get(`${clip.track}:${clip.media}:${this.time < clip.start ? 'pre' : 'main'}`)?.el;
				if (el && !el.error && (el.seeking || el.readyState < 2)) {
					return true;
				}
			}
			return false;
		}

		play() {
			if (this.playing || this.starting) {
				return;
			}
			this.ensureAudio();
			if (this.time >= this.duration() - 0.02) {
				this.time = this.loop ? this.loop[0] : 0;
			}
			const begin = () => {
				this.starting = false;
				this.playing = true;
				this.anchor = performance.now();
				this.anchorTime = this.time;
				this.sync(true);
			};
			// Every video is first put on its frame, and the clock only starts once they can show it.
			// Started at once, the clock ran ahead of a video still seeking; the video was then sent
			// after it again and again and never caught up: sound, and a black picture.
			this.sync(false);
			if (!this.waitingVideo()) {
				begin();
				return;
			}
			this.starting = true;
			const since = performance.now();
			const wait = () => {
				if (!this.starting) {
					return;
				}
				if (!this.waitingVideo() || performance.now() - since > 3000) {
					begin();
				} else {
					requestAnimationFrame(wait);
				}
			};
			requestAnimationFrame(wait);
		}

		pause() {
			this.starting = false;
			this.playing = false;
			this.rate = 1;
			for (const e of this.elements.values()) {
				e.el.pause();
			}
			this.dirty = true;
		}

		toggle() {
			this.playing || this.starting ? this.pause() : this.play();
		}

		/** Shuttle: J/L press counts (-4…4), like professional editors. */
		shuttle(/** @type {number} */ rate) {
			this.ensureAudio();
			this.rate = rate;
			if (!this.playing) {
				this.play();
			} else {
				this.anchor = performance.now();
				this.anchorTime = this.time;
			}
		}

		seek(/** @type {number} */ t) {
			this.time = clamp(t, 0, Math.max(0, this.duration()));
			this.anchor = performance.now();
			this.anchorTime = this.time;
			this.sync(this.playing);
			this.dirty = true;
			this.onTime(this.time);
		}

		loopFrame(/** @type {number} */ now) {
			requestAnimationFrame(this.loopFrame);
			if (!this.project) {
				return;
			}
			if (this.playing) {
				const total = this.duration();
				// The time of a frame can be a hair earlier than the moment play was pressed: elapsed
				// time never goes backwards. Without this, playing from the very start of the montage
				// gave a negative time, read as « before the beginning » : the clock stopped at once
				// while the videos and the sound went on, with a black picture.
				this.time = this.anchorTime + Math.max(0, now - this.anchor) / 1000 * this.rate;
				if (this.loop && this.time >= this.loop[1]) {
					this.seek(this.loop[0]);
				} else if (this.time >= total || this.time < 0) {
					this.time = clamp(this.time, 0, total);
					this.pause();
				}
				// Whatever was just decided (the end was reached), the media follow the clock's state.
				this.sync(this.playing);
				this.onTime(this.time);
				this.draw();
			} else if (this.dirty) {
				this.dirty = false;
				this.draw();
			}
			if (this.analyser && this.playing) {
				const data = new Float32Array(this.analyser.fftSize);
				this.analyser.getFloatTimeDomainData(data);
				let peak = 0;
				for (const v of data) {
					peak = Math.max(peak, Math.abs(v));
				}
				this.meter.l = Math.max(peak, this.meter.l * .9);
			} else {
				this.meter.l *= .85;
			}
		}

		/** Clips to show at `t`, including the incoming clip of a transition (it starts early). */
		activeAt(/** @type {number} */ t) {
			if (!this.project) {
				return [];
			}
			return this.project.clips.filter((/** @type {any} */ c) => {
				const pre = c.transitionIn && c.transitionIn.type !== 'dip-black' && c.transitionIn.type !== 'dip-white' ? c.transitionIn.duration : 0;
				return t >= c.start - pre - EPS && t < end(c) - EPS;
			});
		}

		track(/** @type {string} */ id) {
			return this.project.tracks.find((/** @type {any} */ t) => t.id === id);
		}

		mediaOf(/** @type {any} */ clip) {
			return clip.media ? this.project.media.find((/** @type {any} */ m) => m.id === clip.media) : undefined;
		}

		/**
		 * One element per (track, media): consecutive cuts of one recording reuse it with a
		 * seek, which keeps 200 jump cuts as light as one clip.
		 */
		elementFor(/** @type {any} */ clip, /** @type {string} */ role) {
			const media = this.mediaOf(clip);
			const key = `${clip.track}:${clip.media}:${role}`;
			let entry = this.elements.get(key);
			if (!entry) {
				const audioOnly = this.track(clip.track)?.kind === 'audio';
				const el = document.createElement(audioOnly ? 'audio' : 'video');
				el.preload = 'auto';
				el.crossOrigin = 'anonymous';
				el.src = this.proxies[clip.media] ?? this.uris[clip.media];
				el.muted = !audioOnly;
				el.playsInline = true;
				/** @type {GainNode | undefined} */
				let gain;
				if (audioOnly && this.audio && this.master) {
					const source = this.audio.createMediaElementSource(el);
					gain = this.audio.createGain();
					source.connect(gain).connect(this.master);
				}
				el.addEventListener('seeked', () => { this.dirty = true; });
				el.addEventListener('loadeddata', () => { this.dirty = true; });
				el.addEventListener('error', () => {
					if (!this.proxies[clip.media]) {
						this.onMediaError(clip.media, el.error?.message || 'format non lu');
					}
				});
				entry = { el, gain, media: clip.media, used: 0 };
				this.elements.set(key, entry);
			}
			if (!entry.gain && this.audio && this.master && entry.el.tagName === 'AUDIO') {
				const source = this.audio.createMediaElementSource(entry.el);
				entry.gain = this.audio.createGain();
				source.connect(entry.gain).connect(this.master);
			}
			entry.used = performance.now();
			void media;
			return entry;
		}

		/** Swaps a media for its playable proxy. */
		useProxy(/** @type {string} */ media, /** @type {string} */ uri) {
			this.proxies[media] = uri;
			for (const [key, e] of this.elements) {
				if (e.media === media) {
					e.el.pause();
					e.el.removeAttribute('src');
					e.el.load();
					this.elements.delete(key);
				}
			}
			this.sync(this.playing);
		}

		sync(/** @type {boolean} */ playing) {
			if (!this.project) {
				return;
			}
			const t = this.time;
			const active = this.activeAt(t);
			/** @type {Set<string>} */
			const live = new Set();
			for (const clip of active) {
				const media = this.mediaOf(clip);
				if (!media || media.kind === 'image') {
					continue;
				}
				const track = this.track(clip.track);
				if (!track || (track.kind === 'video' && track.hidden)) {
					continue;
				}
				// The incoming clip of a transition overlaps the outgoing one: give it its own element.
				const role = t < clip.start ? 'pre' : 'main';
				const entry = this.elementFor(clip, role);
				const key = `${clip.track}:${clip.media}:${role}`;
				live.add(key);
				const src = clamp(clip.in + (t - clip.start) * clip.speed, 0, Math.max(0, media.duration - 0.03));
				const el = entry.el;
				const rate = clip.speed * Math.abs(this.rate || 1);
				if (playing && this.rate > 0) {
					if (Math.abs(el.playbackRate - rate) > 1e-3) {
						el.playbackRate = clamp(rate, 0.0625, 16);
					}
					// A video already on its way to a frame is left to arrive: sending it somewhere else at
					// every drift keeps it seeking for ever. Only a real jump (the user moved) redirects it.
					const drift = Math.abs(el.currentTime - src);
					if (el.seeking ? Math.abs((entry.target ?? src) - src) > 1.5 : drift > 0.25 || el.paused && drift > 0.06) {
						entry.target = src;
						el.currentTime = src;
					}
					if (el.paused) {
						el.play().catch(() => undefined);
					}
				} else {
					if (!el.paused) {
						el.pause();
					}
					if (Math.abs(el.currentTime - src) > 0.5 / (this.project.fps || 30)) {
						entry.target = src;
						el.currentTime = src;
					}
				}
				if (entry.gain && this.audio) {
					const local = t - clip.start;
					let v = track.muted ? 0 : valueAt(clip, 'volume', local) * this.volume;
					if (clip.fadeIn > 0 && local < clip.fadeIn) {
						v *= clamp(local / clip.fadeIn, 0, 1);
					}
					const left = dur(clip) - local;
					if (clip.fadeOut > 0 && left < clip.fadeOut) {
						v *= clamp(left / clip.fadeOut, 0, 1);
					}
					if (playing && this.rate < 0) {
						v = 0;
					}
					entry.gain.gain.setTargetAtTime(v, this.audio.currentTime, 0.01);
				}
			}
			for (const [key, e] of this.elements) {
				if (!live.has(key)) {
					if (!e.el.paused) {
						e.el.pause();
					}
					// Elements unused for a while are released (memory on long timelines).
					if (performance.now() - e.used > 60000) {
						e.el.removeAttribute('src');
						e.el.load();
						this.elements.delete(key);
					}
				}
			}
			// Reverse shuttle: browsers cannot play backwards, so step frames.
			if (playing && this.rate < 0) {
				this.dirty = true;
			}
		}

		/** Resize the drawing buffer to the displayed size (crisp, never above the project size). */
		resize(/** @type {number} */ cssWidth, /** @type {number} */ cssHeight) {
			if (!this.project) {
				return;
			}
			const ratio = this.project.width / this.project.height;
			let w = cssWidth;
			let h = w / ratio;
			if (h > cssHeight) {
				h = cssHeight;
				w = h * ratio;
			}
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			const target = Math.min(this.project.width, Math.round(w * dpr * this.quality));
			this.canvas.style.width = `${Math.round(w)}px`;
			this.canvas.style.height = `${Math.round(h)}px`;
			if (this.canvas.width !== target) {
				this.canvas.width = target;
				this.canvas.height = Math.round(target / ratio);
			}
			this.dirty = true;
		}

		draw(/** @type {CanvasRenderingContext2D} */ ctx = this.ctx, /** @type {number} */ t = this.time) {
			const p = this.project;
			if (!p) {
				return;
			}
			// While a video is between two frames, the last picture stays: no black flash.
			if (ctx === this.ctx && t === this.time && this.waitingVideo() && performance.now() - this.heldSince < 1500) {
				this.dirty = true;
				return;
			}
			if (ctx === this.ctx) {
				this.heldSince = performance.now();
			}
			const k = ctx.canvas.width / p.width;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalAlpha = 1;
			ctx.filter = 'none';
			ctx.fillStyle = p.background || '#000';
			ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
			ctx.setTransform(k, 0, 0, k, 0, 0);
			const active = this.activeAt(t);
			// Video tracks bottom to top, then text tracks bottom to top.
			const order = [...p.tracks.filter((/** @type {any} */ x) => x.kind === 'video').reverse(), ...p.tracks.filter((/** @type {any} */ x) => x.kind === 'text').reverse()];
			for (const track of order) {
				if (track.hidden) {
					continue;
				}
				const clips = active.filter((/** @type {any} */ c) => c.track === track.id).sort((a, b) => a.start - b.start);
				for (const clip of clips) {
					if (clip.text) {
						this.drawText(ctx, clip, t);
					} else {
						this.drawMedia(ctx, clip, t);
					}
				}
			}
			// Dip transitions: a flash of colour peaking on the cut.
			for (const clip of p.clips) {
				const tr = clip.transitionIn;
				if (!tr || (tr.type !== 'dip-black' && tr.type !== 'dip-white') || this.track(clip.track)?.hidden) {
					continue;
				}
				const d = tr.duration;
				const x = t - (clip.start - d / 2);
				if (x >= 0 && x <= d) {
					ctx.globalAlpha = 1 - Math.abs(x - d / 2) / (d / 2);
					ctx.fillStyle = tr.type === 'dip-white' ? '#fff' : '#000';
					ctx.fillRect(0, 0, p.width, p.height);
					ctx.globalAlpha = 1;
				}
			}
		}

		drawMedia(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {any} */ clip, /** @type {number} */ t) {
			const p = this.project;
			const media = this.mediaOf(clip);
			if (!media) {
				return;
			}
			/** @type {CanvasImageSource | undefined} */
			let source;
			let sw = media.width || 1920;
			let sh = media.height || 1080;
			if (media.kind === 'image') {
				let img = this.images.get(media.id);
				if (!img) {
					img = new Image();
					img.src = this.uris[media.id];
					img.onload = () => { this.dirty = true; };
					this.images.set(media.id, img);
				}
				if (!img.complete || !img.naturalWidth) {
					return;
				}
				source = img;
				sw = img.naturalWidth;
				sh = img.naturalHeight;
			} else {
				const role = t < clip.start ? 'pre' : 'main';
				const entry = this.elements.get(`${clip.track}:${clip.media}:${role}`) ?? this.elementFor(clip, role);
				const v = /** @type {HTMLVideoElement} */ (entry.el);
				if (v.readyState < 2 || !v.videoWidth) {
					return;
				}
				source = v;
				sw = v.videoWidth;
				sh = v.videoHeight;
			}
			let local = t - clip.start;
			let alpha = clip.opacity;
			let dx = 0;
			let dy = 0;
			let zoom = 1;
			// The incoming clip of a transition, before its cut.
			const tr = clip.transitionIn;
			if (tr && local < 0 && tr.type !== 'dip-black' && tr.type !== 'dip-white') {
				const q = smooth(clamp((local + tr.duration) / tr.duration, 0, 1));
				if (tr.type === 'crossfade' || tr.type === 'zoom-in' || tr.type === 'zoom-out') {
					alpha *= q;
				}
				if (tr.type === 'slide-left') {
					dx = p.width * (1 - q);
				} else if (tr.type === 'slide-right') {
					dx = -p.width * (1 - q);
				} else if (tr.type === 'slide-up') {
					dy = p.height * (1 - q);
				} else if (tr.type === 'zoom-in') {
					zoom = 1.25 - 0.25 * q;
				} else if (tr.type === 'zoom-out') {
					zoom = 0.8 + 0.2 * q;
				}
				local = 0;
			}
			alpha *= valueAt(clip, 'opacity', local) / (clip.opacity || 1);
			if (clip.fadeIn > 0 && local < clip.fadeIn) {
				alpha *= clamp(local / clip.fadeIn, 0, 1);
			}
			const left = dur(clip) - local;
			if (clip.fadeOut > 0 && left < clip.fadeOut) {
				alpha *= clamp(left / clip.fadeOut, 0, 1);
			}
			if (alpha <= 0.001) {
				return;
			}
			const cr = clip.crop || { left: 0, top: 0, right: 0, bottom: 0 };
			const cx = sw * cr.left;
			const cy = sh * cr.top;
			const cw = Math.max(1, sw * (1 - cr.left - cr.right));
			const ch = Math.max(1, sh * (1 - cr.top - cr.bottom));
			// Fit, as the export does.
			let w = p.width;
			let h = p.height;
			const ratio = cw / ch;
			if (clip.fit === 'stretch') {
				// keep w, h
			} else if ((clip.fit === 'cover') === (ratio > p.width / p.height)) {
				h = p.height;
				w = h * ratio;
			} else {
				w = p.width;
				h = w / ratio;
			}
			const scale = valueAt(clip, 'scale', local) * zoom;
			const rotation = valueAt(clip, 'rotation', local);
			let x = valueAt(clip, 'x', local) + dx;
			let y = valueAt(clip, 'y', local) + dy;
			if (clip.shake) {
				const s = Math.max(0, 1 - local / 0.35);
				x += clip.shake * 18 * Math.sin(local * 61) * s;
				y += clip.shake * 14 * Math.cos(local * 53) * s;
			}
			ctx.save();
			ctx.globalAlpha = clamp(alpha, 0, 1);
			ctx.translate(p.width / 2 + x, p.height / 2 + y);
			if (rotation) {
				ctx.rotate(rotation * Math.PI / 180);
			}
			ctx.scale(scale * (clip.mirror ? -1 : 1), scale);
			const col = clip.color || {};
			const filters = [];
			if (col.brightness) {
				filters.push(`brightness(${1 + col.brightness * 0.5})`);
			}
			if (col.contrast) {
				filters.push(`contrast(${1 + col.contrast})`);
			}
			if (col.saturation) {
				filters.push(`saturate(${Math.max(0, 1 + col.saturation)})`);
			}
			if (col.hue) {
				filters.push(`hue-rotate(${col.hue}deg)`);
			}
			if (clip.blur) {
				filters.push(`blur(${clip.blur * 2}px)`);
			}
			ctx.filter = filters.length ? filters.join(' ') : 'none';
			ctx.drawImage(source, cx, cy, cw, ch, -w / 2, -h / 2, w, h);
			ctx.filter = 'none';
			if (col.temperature) {
				ctx.globalCompositeOperation = 'soft-light';
				ctx.fillStyle = col.temperature > 0 ? `rgba(255,140,40,${Math.abs(col.temperature) * .45})` : `rgba(60,140,255,${Math.abs(col.temperature) * .45})`;
				ctx.fillRect(-w / 2, -h / 2, w, h);
				ctx.globalCompositeOperation = 'source-over';
			}
			if (col.vignette > 0) {
				const g = ctx.createRadialGradient(0, 0, Math.min(w, h) * .3, 0, 0, Math.hypot(w, h) / 2);
				g.addColorStop(0, 'rgba(0,0,0,0)');
				g.addColorStop(1, `rgba(0,0,0,${clamp(col.vignette, 0, 1) * .85})`);
				ctx.fillStyle = g;
				ctx.fillRect(-w / 2, -h / 2, w, h);
			}
			ctx.restore();
		}

		drawText(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {any} */ clip, /** @type {number} */ t) {
			const p = this.project;
			const s = clip.text;
			const local = t - clip.start;
			const length = dur(clip);
			let alpha = clip.opacity;
			let pop = 1;
			let rise = 0;
			const fadeIn = Math.max(clip.fadeIn, s.animation === 'fade' || s.animation === 'slide-up' ? (s.animation === 'fade' ? .25 : .2) : 0);
			if (fadeIn > 0 && local < fadeIn) {
				alpha *= clamp(local / fadeIn, 0, 1);
			}
			if (clip.fadeOut > 0 && length - local < clip.fadeOut) {
				alpha *= clamp((length - local) / clip.fadeOut, 0, 1);
			}
			if (s.animation === 'pop') {
				pop = local < .12 ? .4 + (1.12 - .4) * (local / .12) : local < .2 ? 1.12 - .12 * ((local - .12) / .08) : 1;
			} else if (s.animation === 'bounce') {
				pop = local < .1 ? .7 + .5 * (local / .1) : local < .18 ? 1.2 - .28 * ((local - .1) / .08) : local < .26 ? .92 + .08 * ((local - .18) / .08) : 1;
			}
			const size = s.size * clip.scale;
			if (s.animation === 'slide-up' && local < .25) {
				rise = size * .8 * (1 - smooth(local / .25));
			}
			let content = s.uppercase ? s.content.toUpperCase() : s.content;
			if (s.animation === 'typewriter') {
				const chars = [...content];
				const step = Math.min(1.5, length * .4) / Math.max(1, chars.length);
				content = chars.slice(0, Math.floor(local / step) + 1).join('');
			}
			if (alpha <= 0.001 || !content) {
				return;
			}
			ctx.save();
			ctx.globalAlpha = clamp(alpha, 0, 1);
			ctx.translate(p.width / 2 + clip.x, p.height / 2 + clip.y + rise);
			if (clip.rotation) {
				ctx.rotate(clip.rotation * Math.PI / 180);
			}
			ctx.scale(pop, pop);
			ctx.font = `${s.weight >= 600 ? 'bold' : s.weight <= 300 ? '300' : 'normal'} ${size}px "${s.font}", "Arial Black", sans-serif`;
			ctx.textBaseline = 'middle';
			ctx.lineJoin = 'round';
			ctx.miterLimit = 2;
			const lines = content.split('\n');
			const lineHeight = size * 1.15;
			const widths = lines.map(l => ctx.measureText(l).width);
			const total = lineHeight * lines.length;
			const box = s.background && !s.background.endsWith('00');
			if (box) {
				const pad = size * .28;
				const w = Math.max(...widths);
				const x0 = s.align === 'left' ? -pad : s.align === 'right' ? -w - pad : -w / 2 - pad;
				ctx.fillStyle = s.background;
				ctx.beginPath();
				ctx.roundRect(x0, -total / 2 - pad * .6, w + pad * 2, total + pad * 1.2, size * .18);
				ctx.fill();
			}
			// Karaoke: the words already spoken switch to the highlight colour.
			const wordTimes = s.wordTimes && s.highlight ? s.wordTimes : null;
			let wordIndex = 0;
			lines.forEach((line, i) => {
				const y = -total / 2 + lineHeight * (i + .5);
				const x = s.align === 'left' ? 0 : s.align === 'right' ? -widths[i] : -widths[i] / 2;
				const parts = wordTimes ? line.split(/(\s+)/) : [line];
				let cursor = x;
				for (const part of parts) {
					const w = ctx.measureText(part).width;
					if (!part.trim()) {
						cursor += w;
						continue;
					}
					let color = s.color;
					if (wordTimes) {
						const at = wordTimes[Math.min(wordIndex++, wordTimes.length - 1)];
						if (local >= at) {
							color = s.highlight;
						}
					}
					if (s.shadow && !box) {
						ctx.save();
						ctx.fillStyle = 'rgba(0,0,0,.6)';
						if (s.strokeWidth) {
							ctx.lineWidth = s.strokeWidth * 2 * clip.scale;
							ctx.strokeStyle = 'rgba(0,0,0,.6)';
							ctx.strokeText(part, cursor + s.shadow * clip.scale, y + s.shadow * clip.scale);
						}
						ctx.fillText(part, cursor + s.shadow * clip.scale, y + s.shadow * clip.scale);
						ctx.restore();
					}
					if (s.strokeWidth && !box) {
						ctx.lineWidth = s.strokeWidth * 2 * clip.scale;
						ctx.strokeStyle = s.stroke;
						ctx.strokeText(part, cursor, y);
					}
					ctx.fillStyle = color;
					ctx.fillText(part, cursor, y);
					cursor += w;
				}
			});
			ctx.restore();
		}

		/** Text bounds in project pixels (for direct manipulation in the viewer). */
		textBounds(/** @type {any} */ clip) {
			const s = clip.text;
			const size = s.size * clip.scale;
			this.ctx.save();
			this.ctx.font = `${s.weight >= 600 ? 'bold' : 'normal'} ${size}px "${s.font}", "Arial Black", sans-serif`;
			const lines = (s.uppercase ? s.content.toUpperCase() : s.content).split('\n');
			const w = Math.max(...lines.map((/** @type {string} */ l) => this.ctx.measureText(l).width)) + (s.strokeWidth || 0) * 2;
			this.ctx.restore();
			return { w, h: size * 1.15 * lines.length };
		}

		/**
		 * A still of the montage at `t` (all layers), waiting for every video to reach the frame.
		 * Used for Claude's `sc_frame` and thumbnails.
		 */
		async renderFrame(/** @type {number} */ t, /** @type {number} */ width = 960) {
			const wasPlaying = this.playing;
			if (wasPlaying) {
				this.pause();
			}
			const previous = this.time;
			this.time = clamp(t, 0, this.duration());
			this.sync(false);
			const waits = [];
			for (const clip of this.activeAt(this.time)) {
				const media = this.mediaOf(clip);
				if (!media || media.kind === 'image' || this.track(clip.track)?.kind !== 'video') {
					continue;
				}
				const el = this.elementFor(clip, this.time < clip.start ? 'pre' : 'main').el;
				waits.push(new Promise(resolve => {
					if (!el.seeking && el.readyState >= 2) {
						return resolve(undefined);
					}
					const done = () => resolve(undefined);
					el.addEventListener('seeked', done, { once: true });
					el.addEventListener('loadeddata', done, { once: true });
					setTimeout(done, 4000);
				}));
			}
			await Promise.all(waits);
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(width);
			canvas.height = Math.round(width * this.project.height / this.project.width);
			const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
			this.draw(ctx, this.time);
			const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
			this.time = previous;
			this.sync(false);
			this.dirty = true;
			return dataUrl;
		}
	}

	// @ts-ignore
	window.StarEngine = { Engine, valueAt, dur, end };
})();
