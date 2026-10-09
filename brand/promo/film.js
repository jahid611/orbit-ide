/* Orbit — film de présentation. Une seule timeline GSAP, en pause : `seek(t)` place le film à t secondes. */
/* global gsap */
(function () {
	const DURATION = 60;
	const $ = (s, root = document) => root.querySelector(s);
	const $$ = (s, root = document) => [...root.querySelectorAll(s)];

	// --- text splitting: every word (or character) sits in a mask and rises into view
	for (const el of $$('[data-split]')) {
		const mode = el.dataset.split;
		const wrap = text => {
			const parts = mode === 'chars' ? [...text] : text.split(/(\s+)/);
			return parts.map(p => /^\s+$/.test(p) ? ' ' : `<span class="w"><span>${p}</span></span>`).join('');
		};
		const walk = node => {
			for (const child of [...node.childNodes]) {
				if (child.nodeType === 3) {
					const span = document.createElement('span');
					span.innerHTML = wrap(child.textContent);
					child.replaceWith(...span.childNodes);
				} else {
					walk(child);
				}
			}
		};
		walk(el);
	}
	const words = scope => $$(`${scope} .w > span`);

	const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
	const show = (id, at) => tl.set(id, { visibility: 'visible' }, at);
	const leave = (id, at, vars = {}) => tl.to(id, { autoAlpha: 0, y: -40, scale: .985, duration: .55, ease: 'power3.in', ...vars }, at);
	const rise = (targets, at, vars = {}) => tl.from(targets, { yPercent: 115, duration: 1, stagger: .055, ...vars }, at);
	const flash = at => tl.fromTo('#flash', { opacity: .16 }, { opacity: 0, duration: .5, ease: 'power2.out', immediateRender: false }, at);

	/**
	 * A screenshot scene: the headline alone first, then the capture rises from below and opens
	 * to the whole frame, a short caption settles over it, and the camera pushes in slowly.
	 */
	function showcase(id, start, end, origin = '50% 50%', drift = true) {
		show(id, start);
		if ($(`${id} .intro .app`)) {
			tl.from(`${id} .intro .app`, { scale: 0, rotate: -30, autoAlpha: 0, duration: .9, ease: 'back.out(1.8)' }, start);
		}
		tl.from(`${id} .intro .kicker`, { autoAlpha: 0, y: 20, duration: .6 }, start + .1);
		rise(words(`${id} .intro h1`), start + .15, { duration: .9, stagger: .05 });
		tl.to(`${id} .intro`, { autoAlpha: 0, y: -70, scale: .94, duration: .6, ease: 'power3.in' }, start + 1.75)
			.fromTo(`${id} .full`, { autoAlpha: 0, yPercent: 62, rotateX: 26, scale: .6, borderRadius: 40, transformPerspective: 1900 }, { autoAlpha: 1, yPercent: 0, rotateX: 0, scale: 1, borderRadius: 0, duration: 1.5, ease: 'expo.inOut' }, start + 1.55)
			.fromTo(drift ? `${id} .full img` : {}, { scale: 1, transformOrigin: origin }, { scale: 1.03, duration: end - start - 3.3, ease: 'sine.inOut' }, start + 3)
			.from(`${id} .scrim`, { autoAlpha: 0, duration: .8, ease: 'power2.out' }, start + 2.7)
			.from(`${id} .caption > *`, { autoAlpha: 0, y: 34, duration: .7, stagger: .12 }, start + 2.95);
		leave(id, end - .5, { y: 0, scale: 1.03 });
	}

	// The background drifts for the whole film.
	tl.fromTo('#bg', { scale: 1.12, xPercent: -2 }, { scale: 1, xPercent: 2, duration: DURATION, ease: 'none' }, 0);

	// --- 1. Ouverture (0 → 6.3)
	show('#s1', 0);
	tl.from('#s1 .logo', { scale: .2, rotate: -50, autoAlpha: 0, duration: 1.6, ease: 'expo.out' }, .25)
		.from('#s1 .halo', { scale: .2, autoAlpha: 0, duration: 2.2, ease: 'power3.out' }, .25)
		.to('#s1 .halo', { scale: 1.12, duration: 4, ease: 'sine.inOut' }, 2.4);
	rise(words('#s1 .wordmark'), 1.1, { duration: 1.1, stagger: .07 });
	rise(words('#s1 .tagline'), 1.9, { duration: .9, stagger: .06 });
	tl.from('#s1 .claude', { autoAlpha: 0, x: -24, scale: .85, duration: .9, ease: 'back.out(1.8)' }, 2.5)
		.from('#s1 .claude img', { rotate: -140, duration: 1.4 }, 2.5)
		.to('#s1 .logo-wrap', { y: -8, duration: 3.4, ease: 'sine.inOut' }, 2.4);
	leave('#s1', 5.75);

	// --- 2. De vrais terminaux (6.2 → 14) · 3. Une équipe d'agents (13.9 → 22)
	showcase('#s2', 6.2, 14, '50% 40%');
	showcase('#s3', 13.9, 22, '45% 62%');
	tl.from('#s3 .alert', { autoAlpha: 0, x: 70, duration: .7 }, 18.6)
		.to('#s3 .alert', { boxShadow: '0 0 0 10px rgba(255,93,115,.18), 0 30px 80px rgba(0,0,0,.45)', duration: .45, repeat: 3, yoyo: true, ease: 'sine.inOut' }, 19.3);

	// --- 4. Vue vivante (21.9 → 30) : the capture first, then the recording plays in a window over it
	showcase('#s4', 21.9, 30, '58% 40%');
	tl.from('#s4 .pip', { autoAlpha: 0, y: 160, rotateX: 16, scale: .8, transformPerspective: 1800, duration: 1.1 }, 25.3);

	// --- 5. La boucle fermée (29.9 → 37.4)
	show('#s5', 29.9);
	tl.from('#s5 .kicker', { autoAlpha: 0, y: 20, duration: .7 }, 30);
	rise(words('#s5 h1'), 30.1, { stagger: .07 });
	tl.from('#s5 .step', { autoAlpha: 0, y: 70, duration: .9, stagger: .18 }, 30.7)
		.from('#s5 .cl', { scaleX: 0, duration: .5, stagger: .16, ease: 'power3.out' }, 31.2)
		.from('#s5 .l1 i', { scaleX: 0, duration: .5, ease: 'power2.inOut' }, 32.1);
	$$('#s5 .check').forEach((el, i) => tl.to(el, { className: 'check ok', duration: .01 }, 32.6 + i * .42).fromTo($('b', el), { scale: 1 }, { scale: 1.35, duration: .16, yoyo: true, repeat: 1, ease: 'power2.out' }, 32.6 + i * .42));
	tl.from('#s5 .l2 i', { scaleX: 0, duration: .5, ease: 'power2.inOut' }, 33.9)
		.from('#s5 .verified', { scale: .4, autoAlpha: 0, duration: .8, ease: 'back.out(2.2)' }, 34.3)
		.from('#s5 .small', { autoAlpha: 0, duration: .6 }, 34.8)
		.from('#s5 .frise', { autoAlpha: 0, y: 40, duration: .8 }, 33.2)
		.fromTo('#s5 .fill', { scaleX: 0 }, { scaleX: 1, duration: 1.4, ease: 'power2.inOut' }, 33.6)
		.from('#s5 .pt', { scale: 0, autoAlpha: 0, duration: .5, stagger: .28, ease: 'back.out(2.4)' }, 33.7)
		.to('#s5 .fill', { scaleX: .4, duration: .9, ease: 'power3.inOut' }, 35.4)
		.from('#s5 .rewind', { autoAlpha: 0, y: 20, duration: .6 }, 35.3);
	flash(34.3);
	leave('#s5', 36.85);

	// --- 6. StarCapture (37.3 → 45) · 7. NovaGame (44.9 → 51.5)
	showcase('#s6', 37.3, 45, '48% 36%');
	showcase('#s7', 44.9, 51.5, '50% 50%', false);
	// A real game in quick cuts: each shot lands slightly zoomed and settles.
	$$('#s7 .full img').forEach((img, i) => {
		const at = i === 0 ? 46.4 : 47.75 + (i - 1) * .68;
		if (i) {
			tl.to(img, { autoAlpha: 1, duration: .1, ease: 'none' }, at);
		}
		tl.fromTo(img, { scale: 1.12 }, { scale: 1, duration: i ? 1.4 : 2.6, ease: 'power2.out', immediateRender: false }, at);
	});
	tl.from('#s7 .playing', { scale: 0, duration: .5, ease: 'back.out(3)' }, 47.9);
	[3, 0, 3, 1, 4, 2].forEach((k, i) => tl.to($$('#s7 kbd')[k], { y: 6, boxShadow: '0 0 0 #0c0b22, 0 0 30px rgba(111,182,255,.8)', borderColor: '#6fb6ff', color: '#fff', duration: .1, yoyo: true, repeat: 1, repeatDelay: .16, ease: 'power2.out' }, 48.5 + i * .4));

	// --- 8. Tout le reste (51.4 → 56.2)
	show('#s8', 51.4);
	tl.fromTo('#s8 .r2', { x: -1900 }, { x: -500, duration: 5.2, ease: 'none' }, 51.4)
		.fromTo('#s8 .r3', { x: -100 }, { x: -1500, duration: 5.2, ease: 'none' }, 51.4)
		.from('#s8 .rows', { autoAlpha: 0, duration: .6, ease: 'power2.out' }, 51.4)
		.from('#s8 .card', { autoAlpha: 0, y: 140, rotateX: 18, transformPerspective: 1600, duration: 1, stagger: .16 }, 51.5)
		.to('#s8 .cards', { opacity: .3, scale: .97, duration: .8, ease: 'power2.out' }, 53.5)
		.from('#s8 .and', { autoAlpha: 0, scale: .8, duration: .7, ease: 'back.out(1.6)' }, 53.6);
	rise(words('#s8 .and'), 53.7, { duration: .8, stagger: .09 });
	leave('#s8', 55.7, { y: 0, scale: 1.04 });

	// --- 9. Fin (56 → 60)
	show('#s9', 56);
	flash(56.05);
	tl.from('#s9 .logo', { scale: .5, autoAlpha: 0, duration: 1.2 }, 56.05)
		.from('#s9 .halo', { scale: .3, autoAlpha: 0, duration: 1.6, ease: 'power3.out' }, 56.05)
		.to('#s9 .halo', { scale: 1.1, duration: 2.4, ease: 'sine.inOut' }, 57.6);
	rise(words('#s9 .wordmark'), 56.4, { duration: 1, stagger: .06 });
	rise(words('#s9 .tagline'), 57, { duration: .8, stagger: .08 });
	tl.from('#s9 .foot', { autoAlpha: 0, y: 14, duration: .8 }, 57.8)
		.to('#stage', { opacity: 0, duration: .7, ease: 'power2.in' }, 59.3);

	// --- the screen recording of the live view, one frame per film frame
	const LIVE = { frames: 132, from: 25.6, to: 29.4 };
	const live = Array.from({ length: LIVE.frames }, (_, i) => { const img = new Image(); img.src = `assets/live/f${String(i + 1).padStart(3, '0')}.jpg`; return img; });
	const canvas = $('#live').getContext('2d');
	let drawn = -1;
	function recording(t) {
		const index = Math.max(0, Math.min(LIVE.frames - 1, Math.floor((t - LIVE.from) / (LIVE.to - LIVE.from) * LIVE.frames)));
		if (index !== drawn && live[index].complete && live[index].naturalWidth) {
			canvas.drawImage(live[index], 0, 0, 1280, 720);
			drawn = index;
		}
	}
	window.READY = Promise.all([document.fonts.ready, ...live.map(img => img.decode().catch(() => { })), ...$$('img').map(img => img.decode().catch(() => { }))]);

	window.FILM = { duration: DURATION, fps: 30 };
	window.seek = t => {
		tl.time(Math.max(0, Math.min(DURATION, t)), false);
		recording(t);
	};

	// Opened by hand: fit the window and play in real time. `?t=12` freezes on a moment.
	const params = new URLSearchParams(location.search);
	if (!params.has('render')) {
		const fit = () => { $('#stage').style.scale = Math.min(innerWidth / 1920, innerHeight / 1080); };
		fit();
		addEventListener('resize', fit);
		if (params.has('t')) {
			window.READY.then(() => window.seek(+params.get('t')));
		} else {
			const start = performance.now();
			const loop = () => { window.seek(((performance.now() - start) / 1000) % DURATION); requestAnimationFrame(loop); };
			window.READY.then(loop);
		}
	} else {
		window.READY.then(() => window.seek(0));
	}
})();
