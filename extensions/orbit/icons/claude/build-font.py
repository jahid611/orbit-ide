"""Builds the product icons of the assistants Orbit can run (status bar, menus, trees):
`$(orbit-claude)`, `$(orbit-openai)`, and the marks of Vercel and GitLab, `$(orbit-vercel)`, `$(orbit-gitlab)`.

Sources: the Claude and OpenAI marks from Simple Icons (CC0, https://simpleicons.org), kept in
claude.svg and ../openai/openai.svg.
Run: python extensions/orbit/icons/claude/build-font.py  (needs `pip install fonttools`).
"""
import os
import re
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(HERE, '..', '..', 'media')
UNITS = 1000
# name, source file, code point, coloured images written for places that take a picture (terminal tabs, pages)
MARKS = [
	('claude', os.path.join(HERE, 'claude.svg'), 0xE001, (('claude.svg', '#D97757'), ('claude-light.svg', '#F3EDE7'))),
	('openai', os.path.join(HERE, '..', 'openai', 'openai.svg'), 0xE002, (('openai.svg', '#ECECF1'), ('openai-light.svg', '#202123'))),
	('vercel', os.path.join(HERE, '..', 'vercel', 'vercel.svg'), 0xE003, (('vercel.svg', '#FFFFFF'), ('vercel-light.svg', '#000000'))),
	('gitlab', os.path.join(HERE, '..', 'gitlab', 'gitlab.svg'), 0xE004, (('gitlab.svg', '#FC6D26'),)),
]

# SVG is 24 units, y down; the glyph is 1000 units, y up, with a small margin.
scale = UNITS / 24 * 0.92
offset = UNITS * 0.04
glyphs = {'.notdef': TTGlyphPen(None).glyph()}
for name, source, _code, images in MARKS:
	path = re.search(r' d="([^"]+)"', open(source, encoding='utf8').read()).group(1)
	pen = TTGlyphPen(None)
	# TrueType wants quadratic curves; the y flip also reverses contour direction, so undo it.
	parse_path(path, TransformPen(Cu2QuPen(pen, max_err=1.0, reverse_direction=True), (scale, 0, 0, -scale, offset, UNITS - offset)))
	glyphs[name] = pen.glyph()
	for file, color in images:
		open(os.path.join(MEDIA, file), 'w', encoding='utf8').write(
			f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="{color}" d="{path}"/></svg>\n')

fb = FontBuilder(UNITS, isTTF=True)
fb.setupGlyphOrder(list(glyphs))
fb.setupCharacterMap({code: name for name, _source, code, _images in MARKS})
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({name: (UNITS, 0) for name in glyphs})
fb.setupHorizontalHeader(ascent=UNITS, descent=0)
fb.setupNameTable({'familyName': 'OrbitIcons', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=UNITS, sTypoDescender=0, usWinAscent=UNITS, usWinDescent=0)
fb.setupPost()
fb.font.flavor = 'woff'
fb.save(os.path.join(MEDIA, 'orbit-icons.woff'))
print('ok')
