# three.js pour la visionneuse 3D

`three.min.js` est three.js 0.185.1 (MIT, voir `LICENSE-three`) avec cinq de ses modules, mis en un seul fichier :

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

window.OrbitThree = { THREE, GLTFLoader, DRACOLoader, MeshoptDecoder, OrbitControls, RoomEnvironment };
```

    esbuild entree.js --bundle --minify --format=iife --legal-comments=none --target=chrome120 "--define:import.meta.url=document.baseURI" --outfile=three.min.js

Le `--define` est indispensable : DRACOLoader calcule ses chemins par défaut avec `import.meta.url`, qui n'existe pas hors d'un module ; sans lui, le fichier lève « Invalid URL » au chargement et rien ne s'affiche. La page donne de toute façon le chemin du décodeur (`setDecoderPath`).

`draco_wasm_wrapper.js` et `draco_decoder.wasm` viennent de `three/examples/jsm/libs/draco/gltf/`, tels quels.
