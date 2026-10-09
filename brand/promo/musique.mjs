// Compose la musique de fond du film : une nappe électronique douce, entièrement synthétisée ici
// (aucun échantillon, aucun droit à demander). Usage : node musique.mjs  → musique.wav
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;
const DURATION = 60;
const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const N = SR * DURATION;
const L = new Float32Array(N);
const R = new Float32Array(N);
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

// La mineur, fa, do, sol : une suite qui monte sans jamais se résoudre trop tôt.
const CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]];
const bars = Math.ceil(DURATION / BAR);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function add(buffer, start, length, fn) {
	const from = Math.max(0, Math.floor(start * SR));
	const to = Math.min(N, from + Math.floor(length * SR));
	for (let i = from; i < to; i++) {
		buffer[i] += fn((i - from) / SR);
	}
}

for (let bar = 0; bar < bars; bar++) {
	const t0 = bar * BAR;
	const chord = CHORDS[bar % 4];
	const intro = bar < 2;
	const outro = t0 >= 55.2;
	const drums = !intro && !outro;

	// Nappe : deux dents de scie désaccordées par note, adoucies par un filtre passe-bas.
	for (const [n, note] of chord.entries()) {
		for (const [side, buffer] of [[-1, L], [1, R]]) {
			const f1 = hz(note) * (1 + side * .0035);
			const f2 = hz(note + 12) * (1 - side * .002);
			let low = 0;
			const cutoff = .035 + .02 * Math.sin(bar * .7 + n);
			add(buffer, t0, BAR + .6, t => {
				const env = Math.min(1, t / .5) * Math.min(1, (BAR + .6 - t) / .6);
				const saw = ((t * f1) % 1) * 2 - 1 + .5 * (((t * f2) % 1) * 2 - 1);
				low += cutoff * (saw - low);
				return low * env * .11;
			});
		}
	}

	// Basse : la fondamentale, ronde, sur le premier et le troisième temps.
	if (!intro) {
		const f = hz(chord[0] - 12);
		for (const beat of outro ? [0] : [0, 2, 2.5]) {
			for (const buffer of [L, R]) {
				add(buffer, t0 + beat * BEAT, BEAT * 1.4, t => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.4) * Math.min(1, t / .01) * .32);
			}
		}
	}

	if (drums) {
		for (let beat = 0; beat < 4; beat++) {
			// Grosse caisse feutrée.
			for (const buffer of [L, R]) {
				add(buffer, t0 + beat * BEAT, .32, t => Math.sin(2 * Math.PI * (48 * t + 70 * (1 - Math.exp(-t * 26)) / 26)) * Math.exp(-t * 11) * .5);
			}
			// Charleston sur les contretemps, à partir de la cinquième mesure.
			if (bar >= 4) {
				let previous = 0;
				const pan = beat % 2 ? .65 : .35;
				for (const [buffer, gain] of [[L, 1 - pan], [R, pan]]) {
					add(buffer, t0 + (beat + .5) * BEAT, .07, t => {
						const noise = rand();
						const high = noise - previous;
						previous = noise;
						return high * Math.exp(-t * 60) * .11 * gain;
					});
				}
			}
		}
	}

	// Arpège : notes pincées en doubles croches, qui se promènent entre les deux oreilles.
	if (bar >= 4 && !outro) {
		for (let step = 0; step < 16; step++) {
			if (step % 4 === 3 && bar % 2 === 0) {
				continue;
			}
			const note = chord[[0, 2, 1, 3, 2, 3, 1, 2][step % 8]] + 12;
			const f = hz(note);
			const pan = .5 + .4 * Math.sin(step * 1.3 + bar);
			for (const [buffer, gain] of [[L, 1 - pan], [R, pan]]) {
				add(buffer, t0 + step * BEAT / 4, .5, t => {
					const phase = (t * f) % 1;
					const triangle = 4 * Math.abs(phase - .5) - 1;
					return triangle * Math.exp(-t * 9) * Math.min(1, t / .004) * .1 * gain;
				});
			}
		}
	}
}

// Écho croisé : chaque oreille répond à l'autre, trois croches plus tard.
const delay = Math.floor(BEAT * .75 * SR);
for (let i = delay; i < N; i++) {
	L[i] += R[i - delay] * .24;
	R[i] += L[i - delay] * .24;
}

// Fondu d'entrée et de sortie, puis mise à niveau sans saturation.
let peak = 0;
for (let i = 0; i < N; i++) {
	const t = i / SR;
	const fade = Math.min(1, t / 1.5) * Math.min(1, (DURATION - t) / 3);
	L[i] = Math.tanh(L[i] * 1.1) * fade;
	R[i] = Math.tanh(R[i] * 1.1) * fade;
	peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
	out.writeInt16LE(Math.round(L[i] / peak * .85 * 32767), 44 + i * 4);
	out.writeInt16LE(Math.round(R[i] / peak * .85 * 32767), 46 + i * 4);
}
fs.writeFileSync(path.join(import.meta.dirname, 'musique.wav'), out);
console.log('musique.wav', DURATION, 's');
