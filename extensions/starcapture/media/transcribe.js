/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// Speech to text with word timings, on this machine: Whisper through transformers.js,
// on the graphics card (WebGPU) when it can, otherwise on the processor. The model is
// downloaded once (Hugging Face) and kept by the browser cache.

const SOURCES = [
	'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm',
	'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/+esm',
];
const MODELS = ['onnx-community/whisper-small_timestamped', 'onnx-community/whisper-base_timestamped'];
/** Seconds of audio fetched per piece; pieces overlap a little so no word is cut. */
const PIECE = 240;
const OVERLAP = 2;

/** @type {any} */
let transcriber = null;
/** @type {Promise<any> | null} */
let loading = null;

async function load(/** @type {(s: string) => void} */ status) {
	if (transcriber) {
		return transcriber;
	}
	if (!loading) {
		loading = (async () => {
			/** @type {any} */
			let t = null;
			for (const url of SOURCES) {
				try {
					t = await import(url);
					break;
				} catch {
					// next source
				}
			}
			if (!t) {
				throw new Error('impossible de charger Whisper (connexion à cdn.jsdelivr.net ?)');
			}
			t.env.allowLocalModels = false;
			t.env.allowRemoteModels = true;
			t.env.useBrowserCache = true;
			const progress = (/** @type {any} */ p) => {
				if (p.status === 'progress' && p.total) {
					status(`Téléchargement de Whisper ${Math.round(p.loaded / p.total * 100)} % (une seule fois)`);
				}
			};
			let lastError;
			for (const model of MODELS) {
				// The processor only: on WebGPU the quantised timestamped models produce gibberish.
				for (const opts of [{ dtype: 'q8' }]) {
					try {
						status('Chargement de Whisper…');
						return await t.pipeline('automatic-speech-recognition', model, { ...opts, progress_callback: progress });
					} catch (err) {
						lastError = err;
					}
				}
			}
			throw lastError ?? new Error('Whisper n\'a pas pu démarrer');
		})();
	}
	try {
		transcriber = await loading;
		return transcriber;
	} catch (err) {
		loading = null;
		throw err;
	}
}

/**
 * Words of a media, in source seconds.
 * @param {{ id: string, duration: number, name: string }} media
 * @param {(from: number, to: number) => Promise<Float32Array>} getAudio 16 kHz mono
 * @param {(s: string) => void} status
 * @param {string} [language]
 */
async function transcribe(media, getAudio, status, language = 'french') {
	const asr = await load(status);
	/** @type {{ w: string, start: number, end: number }[]} */
	const words = [];
	const started = performance.now();
	for (let from = 0; from < media.duration; from += PIECE) {
		const to = Math.min(media.duration, from + PIECE + OVERLAP);
		const done = from / Math.max(1, media.duration);
		const elapsed = (performance.now() - started) / 1000;
		const left = done > 0.05 ? Math.round(elapsed / done * (1 - done)) : undefined;
		status(`Transcription ${Math.round(done * 100)} %${left !== undefined ? ` · encore ~${left < 60 ? `${left} s` : `${Math.round(left / 60)} min`}` : ''}`);
		const audio = await getAudio(from, to);
		if (audio.length < 1600) {
			continue;
		}
		const out = await asr(audio, { language, task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
		const lastEnd = words.length ? words[words.length - 1].end : -1;
		for (const chunk of out.chunks ?? []) {
			const text = String(chunk.text ?? '').trim();
			const [a, b] = chunk.timestamp ?? [];
			if (!text || a === null || a === undefined) {
				continue;
			}
			const start = from + a;
			const end = from + (b ?? a + 0.3);
			// The overlap is transcribed twice: keep the first version.
			if (start < lastEnd - 0.05) {
				continue;
			}
			words.push({ w: text, start: Math.round(start * 1000) / 1000, end: Math.round(Math.max(end, start + 0.05) * 1000) / 1000 });
		}
	}
	status('');
	return words;
}

// @ts-ignore
window.StarTranscribe = { transcribe };
