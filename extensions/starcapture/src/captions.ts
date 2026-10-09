/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Clip, Project, TextStyle, duration } from './project';

/**
 * Text clips as an ASS subtitle script, burnt in by libass at export: crisp outlines,
 * shadows, boxes, karaoke highlight and entrance animations, whatever the number of clips.
 */
export function assScript(project: Project, clips: Clip[], offset: number): string {
	const head = [
		'[Script Info]',
		'ScriptType: v4.00+',
		`PlayResX: ${project.width}`,
		`PlayResY: ${project.height}`,
		'ScaledBorderAndShadow: yes',
		'WrapStyle: 0',
		'',
		'[V4+ Styles]',
		'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
		'Style: Default,Arial,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1',
		'',
		'[Events]',
		'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
	];
	const events: string[] = [];
	// Text tracks: the first one listed is on top.
	const order = project.tracks.filter(t => t.kind === 'text').map(t => t.id).reverse();
	for (const clip of clips) {
		if (!clip.text) {
			continue;
		}
		const layer = Math.max(0, order.indexOf(clip.track));
		const from = clip.start - offset;
		const to = from + duration(clip);
		if (to <= 0) {
			continue;
		}
		events.push(`Dialogue: ${layer},${time(Math.max(0, from))},${time(to)},Default,,0,0,0,,${dialogue(project, clip, clip.text, Math.max(0, -from))}`);
	}
	return [...head, ...events, ''].join('\n');
}

function dialogue(project: Project, clip: Clip, t: TextStyle, skipped: number): string {
	const cx = project.width / 2 + clip.x;
	const cy = project.height / 2 + clip.y;
	// libass sizes a font by its full height (ascent + descent), the preview by its em: convert.
	const size = Math.round(t.size * clip.scale * (FONT_HEIGHT[t.font.toLowerCase()] ?? 1.25));
	const align = t.align === 'left' ? 4 : t.align === 'right' ? 6 : 5;
	const box = !!t.background && alpha(t.background) > 0;
	const tags = [
		`\\an${align}`,
		`\\pos(${round(cx)},${round(cy)})`,
		`\\fn${t.font.replace(/[{}\\,]/g, '')}`,
		`\\fs${size}`,
		`\\b${t.weight >= 600 ? 1 : 0}`,
		`\\1c${color(t.color)}\\1a${alphaTag(t.color, clip.opacity)}`,
		box ? `\\3c${color(t.background)}\\3a${alphaTag(t.background, clip.opacity)}\\bord${Math.round(t.size * clip.scale * .28)}` : `\\3c${color(t.stroke)}\\3a${alphaTag(t.stroke, clip.opacity)}\\bord${round(t.strokeWidth * clip.scale)}`,
		`\\4c&H000000&\\4a${alphaTag('#000000', clip.opacity * .6)}\\shad${round(t.shadow * clip.scale)}`,
		clip.rotation ? `\\frz${round(-clip.rotation)}` : '',
		box ? '\\xbord0\\ybord0' : '',
	];
	const fadeIn = Math.max(clip.fadeIn, t.animation === 'fade' ? .25 : 0);
	if (fadeIn || clip.fadeOut) {
		tags.push(`\\fad(${Math.round(fadeIn * 1000)},${Math.round(clip.fadeOut * 1000)})`);
	}
	const ms = (s: number) => Math.max(0, Math.round((s - skipped) * 1000));
	switch (t.animation) {
		case 'pop':
			tags.push(`\\fscx40\\fscy40\\t(${ms(0)},${ms(.12)},\\fscx112\\fscy112)\\t(${ms(.12)},${ms(.2)},\\fscx100\\fscy100)`);
			break;
		case 'bounce':
			tags.push(`\\fscx70\\fscy70\\t(${ms(0)},${ms(.1)},\\fscx120\\fscy120)\\t(${ms(.1)},${ms(.18)},\\fscx92\\fscy92)\\t(${ms(.18)},${ms(.26)},\\fscx100\\fscy100)`);
			break;
		case 'slide-up':
			tags[1] = `\\move(${round(cx)},${round(cy + size * .8)},${round(cx)},${round(cy)},${ms(0)},${ms(.25)})`;
			tags.push(`\\fad(${Math.round(Math.max(fadeIn, .2) * 1000)},${Math.round(clip.fadeOut * 1000)})`);
			break;
	}
	const content = t.uppercase ? t.content.toUpperCase() : t.content;
	let body: string;
	if (t.wordTimes?.length && t.highlight) {
		// Karaoke: each word switches to the highlight colour when it is spoken.
		const words = content.split(/(\s+)/);
		let w = 0;
		body = words.map(part => {
			if (!part.trim()) {
				return part;
			}
			const at = t.wordTimes![Math.min(w++, t.wordTimes!.length - 1)];
			const lit = ms(at);
			return lit > 0 ? `{\\1c${color(t.color)}\\t(${lit},${lit + 1},\\1c${color(t.highlight!)})}${escape(part)}` : `{\\1c${color(t.highlight!)}}${escape(part)}`;
		}).join('');
	} else if (t.animation === 'typewriter') {
		// Characters appear one after the other over the first 40% of the clip (max 1.5 s).
		const chars = [...content];
		const step = Math.min(1.5, duration(clip) * .4) / Math.max(1, chars.length);
		body = chars.map((c, i) => {
			const at = ms(i * step);
			return at > 0 ? `{\\alpha&HFF&\\t(${at},${at + 1},\\alpha&H00&)}${escape(c)}` : escape(c);
		}).join('');
	} else {
		body = escape(content);
	}
	return `{${tags.filter(Boolean).join('')}}${body.replace(/\r?\n/g, '\\N')}`;
}

/** (ascent + descent) / em of common fonts, from their OS/2 tables. */
const FONT_HEIGHT: Record<string, number> = {
	'arial black': 1.41,
	'arial': 1.15,
	'impact': 1.22,
	'segoe ui': 1.33,
	'segoe ui black': 1.33,
	'bahnschrift': 1.2,
	'verdana': 1.215,
	'georgia': 1.136,
	'consolas': 1.17,
	'comic sans ms': 1.394,
	'trebuchet ms': 1.16,
};

function escape(text: string): string {
	return text.replace(/\\/g, '\\​').replace(/[{}]/g, c => c === '{' ? '(' : ')');
}

function time(s: number): string {
	const cs = Math.round(s * 100);
	const h = Math.floor(cs / 360000);
	const m = Math.floor(cs / 6000) % 60;
	const sec = Math.floor(cs / 100) % 60;
	return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function round(n: number): number {
	return Math.round(n * 10) / 10;
}

/** #rrggbb or #rrggbbaa → ASS &HBBGGRR&. */
function color(hex: string): string {
	const h = hex.replace('#', '').padEnd(6, '0');
	return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

function alpha(hex: string): number {
	const h = hex.replace('#', '');
	return h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
}

/** ASS alpha is transparency: 00 opaque, FF invisible. */
function alphaTag(hex: string, opacity: number): string {
	const a = Math.round((1 - alpha(hex) * Math.max(0, Math.min(1, opacity))) * 255);
	return `&H${a.toString(16).padStart(2, '0').toUpperCase()}&`;
}
