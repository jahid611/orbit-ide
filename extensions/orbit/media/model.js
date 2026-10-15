/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { icon } = window.OrbitIcons;
	// @ts-ignore
	const setup = window.OrbitViewer;
	// @ts-ignore
	const { THREE, GLTFLoader, DRACOLoader, MeshoptDecoder, OrbitControls, RoomEnvironment } = window.OrbitThree;

	const escape = (/** @type {string} */ text) => String(text).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
	const svg = (/** @type {string} */ d) => `<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
	const I = {
		frame: svg('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 12h6M12 9v6'),
		spin: svg('M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5'),
		wire: svg('M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 0v18M4 7.5l16 9M20 7.5l-16 9'),
		grid: svg('M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16'),
		light: svg('M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'),
		play: svg('M8 5v14l11-7L8 5Z'),
		pause: svg('M8 5v14M16 5v14'),
		camera: svg('M4 8h3l2-3h6l2 3h3v11H4zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'),
		out: svg('M14 4h6v6m0-6-9 9M10 6H5v13h13v-5'),
		info: svg('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9h.01'),
	};

	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="bar">
			<button id="frame" class="tool" title="Recentrer (F)">${I.frame}</button>
			<button id="spin" class="tool" title="Rotation automatique (R)">${I.spin}</button>
			<span class="sep"></span>
			<button id="wire" class="tool" title="Fil de fer (W)">${I.wire}</button>
			<button id="grid" class="tool on" title="Sol (G)">${I.grid}</button>
			<button id="backdrop" class="tool" title="Fond clair ou sombre (B)">${I.light}</button>
			<span id="anim" class="anim" hidden><span class="sep"></span><button id="play" class="tool" title="Lire ou arrêter l'animation (Espace)">${I.play}</button><select id="clip" title="Animation"></select></span>
			<span class="spacer"></span>
			<button id="infoBtn" class="tool on" title="Fiche du modèle (I)">${I.info}</button>
			<button id="capture" class="text" title="Enregistrer cette vue en PNG">${I.camera}<span>Capture</span></button>
			<button id="agent" class="text accent" title="Envoyer ce modèle et sa fiche à ${escape(setup.assistant)}"><span>Demander à ${escape(setup.assistant)}</span></button>
			<button id="external" class="tool" title="Ouvrir avec l'application du système">${I.out}</button>
		</header>
		<div class="body view3d" id="stage">
			<div id="status" class="status">${icon('refresh')}<span>Ouverture de ${escape(setup.name)}…</span></div>
			<aside id="info" class="info" hidden></aside>
			<div class="hint">Glisser : tourner · Clic droit ou Maj : déplacer · Molette : zoom · Double-clic : viser un point</div>
		</div>`;
	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	const stage = /** @type {HTMLElement} */ ($('stage'));

	function status(/** @type {string} */ text, failed = false) {
		$('status').hidden = !text;
		$('status').className = `status ${failed ? 'failed' : ''}`;
		$('status').innerHTML = `${failed ? '' : icon('refresh')}<span>${escape(text)}</span>`;
	}

	// ------------------------------------------------------------------ scene

	const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
	renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.NeutralToneMapping;
	stage.prepend(renderer.domElement);

	const scene = new THREE.Scene();
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	// A light from above as well: the room alone leaves models without any shade.
	const sun = new THREE.DirectionalLight(0xffffff, 1.2);
	sun.position.set(3, 6, 4);
	scene.add(sun);

	const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.09;
	controls.screenSpacePanning = true;
	controls.autoRotateSpeed = 1.6;

	const BACKDROPS = [{ sky: 0x1b1b22, grid: [0x5a5a6a, 0x34343e] }, { sky: 0xeceef2, grid: [0x9a9aa6, 0xc9c9d2] }];
	let backdrop = 0;
	/** @type {any} */
	let grid;
	/** @type {any} */
	let model;
	/** @type {any} */
	let mixer;
	/** @type {any[]} */
	let clips = [];
	/** @type {any} */
	let action;
	let playing = false;
	let wireframe = false;
	let dirty = true;
	/** The size of the model, for the grid and the camera. */
	let radius = 1;
	const clock = new THREE.Clock();

	function paintBackdrop() {
		scene.background = new THREE.Color(BACKDROPS[backdrop].sky);
		document.body.classList.toggle('bright', backdrop === 1);
		if (grid) {
			const showing = grid.visible;
			placeGrid();
			grid.visible = showing;
		}
		dirty = true;
	}

	/** A floor under the model, sized to it, with lines every power of ten. */
	function placeGrid() {
		const box = model ? new THREE.Box3().setFromObject(model) : new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
		const size = box.getSize(new THREE.Vector3());
		const span = Math.max(size.x, size.z, 0.001);
		const step = Math.pow(10, Math.floor(Math.log10(span / 2)));
		const width = Math.ceil(span * 3 / step) * step;
		if (grid) {
			scene.remove(grid);
			grid.geometry.dispose();
			grid.material.dispose();
		}
		grid = new THREE.GridHelper(width, Math.round(width / step), ...BACKDROPS[backdrop].grid);
		grid.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
		grid.material.transparent = true;
		grid.material.opacity = 0.75;
		scene.add(grid);
	}

	/** The whole model in view, seen from the front, a little from above and from the side. */
	function frame() {
		if (!model) {
			return;
		}
		const box = new THREE.Box3().setFromObject(model);
		if (box.isEmpty()) {
			return;
		}
		const sphere = box.getBoundingSphere(new THREE.Sphere());
		radius = Math.max(sphere.radius, 1e-4);
		const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.3;
		controls.target.copy(sphere.center);
		camera.position.copy(sphere.center).add(new THREE.Vector3(0.55, 0.38, 1).normalize().multiplyScalar(distance));
		camera.near = distance / 1000;
		camera.far = distance * 100;
		camera.updateProjectionMatrix();
		controls.minDistance = radius / 100;
		controls.maxDistance = distance * 20;
		controls.update();
		dirty = true;
	}

	function resize() {
		const width = Math.max(1, stage.clientWidth);
		const height = Math.max(1, stage.clientHeight);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		dirty = true;
	}
	new ResizeObserver(resize).observe(stage);

	function loop() {
		requestAnimationFrame(loop);
		const delta = clock.getDelta();
		const moved = controls.update();
		if (mixer && playing) {
			mixer.update(delta);
			dirty = true;
		}
		if (moved || dirty || controls.autoRotate) {
			renderer.render(scene, camera);
			dirty = false;
		}
	}
	controls.addEventListener('change', () => { dirty = true; });

	// ------------------------------------------------------------------ the file

	/** What the model holds, counted once it is loaded. */
	function facts(/** @type {any} */ gltf) {
		let meshes = 0;
		let triangles = 0;
		let vertices = 0;
		let skinned = false;
		const materials = new Set();
		const textures = new Set();
		model.traverse((/** @type {any} */ node) => {
			if (!node.isMesh && !node.isPoints && !node.isLine) {
				return;
			}
			meshes++;
			skinned ||= !!node.isSkinnedMesh;
			const geometry = node.geometry;
			const count = geometry.attributes.position?.count ?? 0;
			vertices += count;
			if (node.isMesh) {
				triangles += Math.floor((geometry.index ? geometry.index.count : count) / 3);
			}
			for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
				if (!material) {
					continue;
				}
				materials.add(material);
				for (const value of Object.values(material)) {
					if (value && /** @type {any} */ (value).isTexture) {
						textures.add(value);
					}
				}
			}
		});
		const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
		const extras = gltf.parser?.json?.asset ?? {};
		return { meshes, triangles, vertices, materials: materials.size, textures: textures.size, animations: clips.length, skinned, size, generator: extras.generator, extensions: gltf.parser?.json?.extensionsUsed ?? [] };
	}

	const number = (/** @type {number} */ n) => n.toLocaleString('fr-FR');
	/** glTF counts in metres. */
	const space = String.fromCharCode(160);
	const length = (/** @type {number} */ n) => n >= 1 ? `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${space}m` : n >= 0.01 ? `${(n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${space}cm` : `${(n * 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${space}mm`;
	/** @type {ReturnType<typeof facts> | undefined} */
	let known;

	function showFacts() {
		if (!known) {
			return;
		}
		const rows = [
			['Triangles', number(known.triangles)],
			['Sommets', number(known.vertices)],
			['Maillages', number(known.meshes)],
			['Matériaux', number(known.materials)],
			['Textures', number(known.textures)],
			['Animations', known.animations ? number(known.animations) : 'aucune'],
			['Squelette', known.skinned ? 'oui' : 'non'],
			['Taille', `${length(known.size.x)} × ${length(known.size.y)} × ${length(known.size.z)}`],
		];
		if (known.generator) {
			rows.push(['Créé par', known.generator]);
		}
		if (known.extensions.length) {
			rows.push(['Extensions', known.extensions.map((/** @type {string} */ e) => e.replace(/^(KHR|EXT)_/, '').replace(/_/g, ' ')).join(', ')]);
		}
		$('info').innerHTML = `<div class="infoName" title="${escape(setup.name)}">${escape(setup.name)}</div><dl>${rows.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`;
		$('info').hidden = !$('infoBtn').classList.contains('on');
	}

	function clear() {
		if (!model) {
			return;
		}
		scene.remove(model);
		model.traverse((/** @type {any} */ node) => {
			node.geometry?.dispose();
			for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
				for (const value of Object.values(material)) {
					if (value && /** @type {any} */ (value).isTexture) {
						/** @type {any} */ (value).dispose();
					}
				}
				material.dispose();
			}
		});
		mixer?.stopAllAction();
		model = mixer = action = undefined;
	}

	const draco = new DRACOLoader();
	draco.setDecoderPath(setup.draco);
	const loader = new GLTFLoader();
	loader.setDRACOLoader(draco);
	loader.setMeshoptDecoder(MeshoptDecoder);

	async function open(/** @type {string} */ url, keepView = false) {
		status(keepView ? '' : `Ouverture de ${setup.name}…`);
		/** @type {any} */
		let gltf;
		try {
			gltf = await loader.loadAsync(url, (/** @type {ProgressEvent} */ e) => {
				if (!keepView && e.total) {
					status(`Ouverture de ${setup.name}… ${Math.round(e.loaded / e.total * 100)} %`);
				}
			});
		} catch (err) {
			status(`Ce modèle ne s'ouvre pas : ${err instanceof Error ? err.message : String(err)}`, true);
			return;
		}
		const view = keepView && model ? { position: camera.position.clone(), target: controls.target.clone() } : undefined;
		clear();
		model = gltf.scene || gltf.scenes?.[0];
		if (!model) {
			status('Ce fichier ne contient aucune scène à afficher.', true);
			return;
		}
		scene.add(model);
		applyWireframe();
		clips = gltf.animations ?? [];
		mixer = clips.length ? new THREE.AnimationMixer(model) : undefined;
		$('anim').hidden = !clips.length;
		$('clip').innerHTML = clips.map((/** @type {any} */ clip, /** @type {number} */ i) => `<option value="${i}">${escape(clip.name || `Animation ${i + 1}`)} (${clip.duration.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s)</option>`).join('');
		if (clips.length) {
			choose(0);
		}
		known = facts(gltf);
		showFacts();
		const showing = grid ? grid.visible : true;
		placeGrid();
		grid.visible = showing;
		if (view) {
			camera.position.copy(view.position);
			controls.target.copy(view.target);
			controls.update();
		} else {
			frame();
		}
		status('');
		dirty = true;
	}

	function choose(/** @type {number} */ index) {
		if (!mixer) {
			return;
		}
		mixer.stopAllAction();
		action = mixer.clipAction(clips[index]);
		action.play();
		setPlaying(true);
	}

	function setPlaying(/** @type {boolean} */ on) {
		playing = on && !!mixer;
		$('play').innerHTML = playing ? I.pause : I.play;
		$('play').classList.toggle('on', playing);
		clock.getDelta();
		dirty = true;
	}

	function applyWireframe() {
		model?.traverse((/** @type {any} */ node) => {
			for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
				material.wireframe = wireframe;
			}
		});
		$('wire').classList.toggle('on', wireframe);
		dirty = true;
	}

	// ------------------------------------------------------------------ controls

	const toggle = {
		spin: () => {
			controls.autoRotate = !controls.autoRotate;
			$('spin').classList.toggle('on', controls.autoRotate);
		},
		wire: () => {
			wireframe = !wireframe;
			applyWireframe();
		},
		grid: () => {
			if (grid) {
				grid.visible = !grid.visible;
				$('grid').classList.toggle('on', grid.visible);
				dirty = true;
			}
		},
		backdrop: () => {
			backdrop = 1 - backdrop;
			$('backdrop').classList.toggle('on', backdrop === 1);
			paintBackdrop();
		},
		info: () => {
			$('infoBtn').classList.toggle('on');
			$('info').hidden = !$('infoBtn').classList.contains('on') || !known;
		},
	};
	$('frame').addEventListener('click', frame);
	$('spin').addEventListener('click', toggle.spin);
	$('wire').addEventListener('click', toggle.wire);
	$('grid').addEventListener('click', toggle.grid);
	$('backdrop').addEventListener('click', toggle.backdrop);
	$('infoBtn').addEventListener('click', toggle.info);
	$('play').addEventListener('click', () => setPlaying(!playing));
	$('clip').addEventListener('change', () => choose(Number($('clip').value)));
	$('capture').addEventListener('click', () => {
		renderer.render(scene, camera);
		vscode.postMessage({ type: 'capture', data: renderer.domElement.toDataURL('image/png') });
	});
	$('agent').addEventListener('click', () => {
		const lines = known ? [`${number(known.triangles)} triangles, ${number(known.vertices)} sommets, ${known.meshes} maillages, ${known.materials} matériaux, ${known.textures} textures, ${known.animations} animations${known.skinned ? ', avec squelette' : ''}`, `Taille : ${length(known.size.x)} × ${length(known.size.y)} × ${length(known.size.z)}`] : [];
		vscode.postMessage({ type: 'agent', facts: lines.join('\n') });
	});
	$('external').addEventListener('click', () => vscode.postMessage({ type: 'external' }));

	// Double-click: the point under the mouse becomes the centre of the turn.
	renderer.domElement.addEventListener('dblclick', (/** @type {MouseEvent} */ e) => {
		if (!model) {
			return;
		}
		const rect = renderer.domElement.getBoundingClientRect();
		const ray = new THREE.Raycaster();
		ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
		const hit = ray.intersectObject(model, true)[0];
		if (hit) {
			camera.position.add(hit.point.clone().sub(controls.target));
			controls.target.copy(hit.point);
			controls.update();
		}
	});

	window.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
		if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) {
			return;
		}
		const key = e.key.toLowerCase();
		if (key === 'f') {
			frame();
		} else if (key === 'r') {
			toggle.spin();
		} else if (key === 'w') {
			toggle.wire();
		} else if (key === 'g') {
			toggle.grid();
		} else if (key === 'b') {
			toggle.backdrop();
		} else if (key === 'i') {
			toggle.info();
		} else if (key === ' ' && mixer) {
			setPlaying(!playing);
		} else {
			return;
		}
		e.preventDefault();
	});

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'reload') {
			open(msg.url, true);
		}
	});

	paintBackdrop();
	placeGrid();
	resize();
	loop();
	open(setup.url);
})();
