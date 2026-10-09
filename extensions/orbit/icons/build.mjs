/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Generates the "Orbit Icons" file icon theme: `node extensions/orbit/icons/build.mjs`.
// Languages and tools use their official logos (`logos/`, from Devicon, MIT, see logos/LICENSE).
// Everything generic (folders, plain files, images, locks...) is drawn here on a 16px grid in
// one flat style: a tinted shape with a crisp outline.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'svg');

const C = {
	yellow: '#f5c451', blue: '#5b9dff', sky: '#7cc4ff', cyan: '#22d3ee', teal: '#2dd4bf', green: '#4ade80',
	orange: '#ff9e64', red: '#ff5c7a', coral: '#ff7a59', pink: '#f472b6', violet: '#a78bfa', purple: '#c084fc',
	muted: '#8e93bd', dim: '#6b7099',
};

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">${body}</svg>\n`;
const line = (color, d, width = 1.2) => `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const shape = (color, d, opacity = 0.18) => `<path d="${d}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>`;
const text = (color, label, size, y) => `<text x="8" y="${y}" text-anchor="middle" font-family="'Segoe UI Variable Text','Segoe UI',-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="${size}" fill="${color}">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;

/** A language badge: rounded tile in the language colour with a one to three letter label. */
function badge(color, label) {
	const size = label.length >= 3 ? 6.1 : label.length === 2 ? 7.6 : 9.6;
	const y = label.length >= 3 ? 10.2 : label.length === 2 ? 10.8 : 11.5;
	return svg(`<rect x="1.5" y="1.5" width="13" height="13" rx="3.6" fill="${color}" fill-opacity=".17" stroke="${color}" stroke-opacity=".85" stroke-width="1.1"/>${text(color, label, size, y)}`);
}

const PAGE = 'M4.2 1.6h4.9l3.3 3.3v8.5a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V2.6a1 1 0 0 1 1-1z';
const page = (color, extra = '') => svg(`${shape(color, PAGE, 0.12)}${line(color, 'M9 1.8v3.2h3.2', 1.1)}${extra}`);

const FOLDER = 'M1.6 4.1a1 1 0 0 1 1-1h3.1l1.5 1.7h6.2a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1z';
const folder = (color, mark = '') => svg(`${shape(color, FOLDER, 0.22)}${mark}`);
const folderOpen = (color, mark = '') => svg(
	`${line(color, 'M1.6 12.2V4.1a1 1 0 0 1 1-1h3.1l1.5 1.7h5.7a1 1 0 0 1 1 1v1', 1.1)}${shape(color, 'M3.9 7h10.4a.6.6 0 0 1 .58.78l-1.5 4.9a1 1 0 0 1-.96.72H1.9z', 0.26)}${mark}`);
/** Small dot in the folder's corner telling special folders apart. */
const dot = color => `<circle cx="11.3" cy="10" r="1.7" fill="${color}"/>`;

const shapes = {
	file: page(C.muted),
	text: page(C.muted, line(C.muted, 'M5.6 8h4.8M5.6 10.2h4.8M5.6 12.4h2.8', 1)),
	image: svg(`<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" fill="${C.pink}" fill-opacity=".16" stroke="${C.pink}" stroke-width="1.1"/><circle cx="5.6" cy="6.2" r="1.2" fill="${C.pink}"/>${line(C.pink, 'M2.4 12l3.4-3.3 2.3 2.2 2.1-2.1 3.3 3.2')}`),
	terminal: svg(`<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2.2" fill="${C.green}" fill-opacity=".15" stroke="${C.green}" stroke-width="1.1"/>${line(C.green, 'M4.6 6.2L7 8l-2.4 1.8M8.6 10.2h2.8', 1.3)}`),
	database: svg(`<path d="M3 4.2v7.6c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1V4.2" fill="${C.sky}" fill-opacity=".16" stroke="${C.sky}" stroke-width="1.1"/><ellipse cx="8" cy="4.2" rx="5" ry="2.1" fill="${C.sky}" fill-opacity=".3" stroke="${C.sky}" stroke-width="1.1"/>${line(C.sky, 'M3 8c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1', 1.1)}`),
	lock: svg(`<rect x="3.2" y="7" width="9.6" height="6.8" rx="1.8" fill="${C.dim}" fill-opacity=".22" stroke="${C.muted}" stroke-width="1.1"/>${line(C.muted, 'M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7')}<circle cx="8" cy="10.4" r="1" fill="${C.muted}"/>`),
	settings: svg(`${line(C.muted, 'M2.4 4.4h11.2M2.4 8h11.2M2.4 11.6h11.2', 1.1)}<circle cx="6" cy="4.4" r="1.7" fill="${C.yellow}"/><circle cx="10.6" cy="8" r="1.7" fill="${C.yellow}"/><circle cx="5" cy="11.6" r="1.7" fill="${C.yellow}"/>`),
	git: svg(`${line(C.orange, 'M4.6 5.6v4.8M11.4 7.4c0 2.6-6.8 1.2-6.8 3.2')}<circle cx="4.6" cy="4" r="1.7" fill="${C.orange}"/><circle cx="4.6" cy="12" r="1.7" fill="${C.orange}"/><circle cx="11.4" cy="5.8" r="1.7" fill="${C.orange}"/>`),
	archive: svg(`<rect x="2.6" y="1.8" width="10.8" height="12.4" rx="2" fill="${C.yellow}" fill-opacity=".15" stroke="${C.yellow}" stroke-width="1.1"/>${line(C.yellow, 'M8 2.4v1.2M8 5.2v1.2M8 8v1.2', 1.4)}<rect x="6.6" y="10.4" width="2.8" height="2.2" rx=".6" fill="${C.yellow}"/>`),
	sparkle: svg(`<path d="M8 1.4l1.7 4.9 4.9 1.7-4.9 1.7L8 14.6l-1.7-4.9L1.4 8l4.9-1.7z" fill="${C.violet}" fill-opacity=".3" stroke="${C.violet}" stroke-width="1.1" stroke-linejoin="round"/><circle cx="12.8" cy="3" r="1" fill="${C.teal}"/>`),
	table: svg(`<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" fill="${C.green}" fill-opacity=".14" stroke="${C.green}" stroke-width="1.1"/>${line(C.green, 'M1.8 6.4h12.4M1.8 9.9h12.4M6 2.8v10.4', 1)}`),
	video: svg(`<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2.2" fill="${C.purple}" fill-opacity=".16" stroke="${C.purple}" stroke-width="1.1"/><path d="M6.6 5.8l3.8 2.2-3.8 2.2z" fill="${C.purple}" stroke="${C.purple}" stroke-width="1" stroke-linejoin="round"/>`),
	audio: svg(`${line(C.purple, 'M6.2 11.6V3.8l6-1.4v7.8', 1.2)}<circle cx="4.6" cy="11.6" r="1.8" fill="${C.purple}"/><circle cx="10.6" cy="10.2" r="1.8" fill="${C.purple}"/>`),
	box: svg(`${shape(C.green, 'M8 1.6l5.6 3.1v6.6L8 14.4l-5.6-3.1V4.7z', 0.16)}${line(C.green, 'M2.6 4.8L8 7.8l5.4-3M8 7.8v6.2', 1.1)}`),
	info: svg(`<circle cx="8" cy="8" r="6.2" fill="${C.blue}" fill-opacity=".17" stroke="${C.blue}" stroke-width="1.1"/>${line(C.blue, 'M8 7.4v3.6', 1.5)}<circle cx="8" cy="5" r=".95" fill="${C.blue}"/>`),
	license: svg(`<circle cx="8" cy="6.4" r="4.4" fill="${C.yellow}" fill-opacity=".18" stroke="${C.yellow}" stroke-width="1.1"/>${line(C.yellow, 'M5.8 10.2l-1 4.2L8 12.8l3.2 1.6-1-4.2', 1.1)}`),
	pdf: badge(C.red, 'PDF'),
	font: badge(C.muted, 'Aa'),

	folder: folder(C.muted),
	'folder-open': folderOpen(C.muted),
	'folder-root': folder(C.violet),
	'folder-root-open': folderOpen(C.violet),
};

/** Special folders: [colour, names...]. They keep the folder shape and gain a coloured dot. */
const folders = {
	src: [C.blue, 'src', 'source', 'app', 'lib', 'core'],
	test: [C.green, 'test', 'tests', '__tests__', 'spec', 'specs', 'e2e'],
	assets: [C.pink, 'assets', 'public', 'static', 'images', 'img', 'media', 'icons', 'resources', 'brand'],
	deps: [C.dim, 'node_modules', 'vendor', 'packages', '.venv', 'venv', '__pycache__'],
	build: [C.orange, 'dist', 'build', 'out', 'target', 'bin', '.next', '.build'],
	config: [C.yellow, 'config', 'configs', '.config', '.vscode', '.github', 'scripts', 'tools'],
	ai: [C.violet, '.claude', '.orbit', '.agents', '.cursor'],
	git: [C.coral, '.git'],
	ui: [C.cyan, 'components', 'ui', 'views', 'pages', 'layouts', 'screens', 'styles', 'themes'],
	docs: [C.sky, 'docs', 'doc', 'documentation'],
	data: [C.teal, 'data', 'db', 'database', 'models', 'migrations', 'api', 'server', 'services'],
};
for (const [id, [color]] of Object.entries(folders)) {
	shapes[`folder-${id}`] = folder(C.muted, dot(color));
	shapes[`folder-${id}-open`] = folderOpen(C.muted, dot(color));
}

/** Official logos that are black or dark grey: repainted light so they read on a dark interface. */
const DARK_LOGOS = {
	rust: s => s.replace('<svg ', `<svg fill="${C.orange}" `),
	md: s => s.replace('<svg ', '<svg fill="#dfe1f7" '),
	unity: s => s.replace(/fill="(#4d4d4d|gray)"/g, 'fill="#dfe1f7"'),
	next: s => s.replace(/stop-color="[^"]*"/g, 'stop-color="#dfe1f7"').replace(/fill="(#000|#000000|black)"/g, 'fill="#dfe1f7"'),
	json: s => s.replace(/stop-color="[^"]*"/g, `stop-color="${C.yellow}"`),
	bash: s => s.replace('#293138', '#dfe1f7'),
	astro: s => s.replace(/stop-color="#(000014|150426)"/g, 'stop-color="#dfe1f7"'),
	gradle: s => s.replace('#02303a', '#5eead4'),
	yaml: s => s.replace('<svg ', '<svg fill="#dfe1f7" '),
	pnpm: s => s.replace('#4c4c4c', '#b9bcd8'),
};

/** The official logo of a language or tool, or a lettered badge when there is none. */
function logo(id, color, label) {
	const file = path.join(here, 'logos', `${id}.svg`);
	if (!fs.existsSync(file)) {
		return badge(color, label);
	}
	const source = fs.readFileSync(file, 'utf8');
	return DARK_LOGOS[id]?.(source) ?? source;
}

/** Languages and tools: id -> [fallback colour, fallback label, extensions, languageIds, file names]. */
const languages = {
	js: [C.yellow, 'JS', ['js', 'mjs', 'cjs'], ['javascript']],
	react: [C.cyan, 'JSX', ['jsx', 'tsx'], ['javascriptreact', 'typescriptreact']],
	ts: [C.blue, 'TS', ['ts', 'mts', 'cts', 'd.ts'], ['typescript'], ['tsconfig.json', 'tsconfig.base.json']],
	json: [C.orange, '{ }', ['json', 'jsonc', 'json5', 'jsonl', 'webmanifest', 'code-workspace'], ['json', 'jsonc', 'jsonl']],
	html: [C.coral, '<>', ['html', 'htm', 'xhtml'], ['html']],
	xml: [C.orange, '</>', ['xml', 'xsd', 'xsl', 'plist', 'csproj', 'props', 'targets'], ['xml', 'xsl']],
	css: [C.violet, '#', ['css'], ['css']],
	scss: [C.pink, 'S', ['scss', 'sass'], ['scss', 'sass']],
	less: [C.blue, 'L', ['less'], ['less']],
	md: [C.sky, 'M', ['md', 'markdown', 'mdx'], ['markdown']],
	py: [C.blue, 'Py', ['py', 'pyi', 'pyw', 'pyx'], ['python']],
	ipynb: [C.orange, 'Nb', ['ipynb'], ['jupyter']],
	java: [C.coral, 'J', ['java', 'jar', 'class'], ['java']],
	kotlin: [C.purple, 'K', ['kt', 'kts'], ['kotlin']],
	scala: [C.red, 'Sc', ['scala', 'sc'], ['scala']],
	groovy: [C.teal, 'Gr', ['groovy'], ['groovy']],
	gradle: [C.teal, 'Gr', ['gradle'], [], ['build.gradle', 'settings.gradle', 'build.gradle.kts', 'settings.gradle.kts', 'gradlew']],
	c: [C.sky, 'C', ['c', 'h'], ['c']],
	cpp: [C.blue, 'C+', ['cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx'], ['cpp']],
	cs: [C.green, 'C#', ['cs', 'csx'], ['csharp']],
	go: [C.cyan, 'Go', ['go'], ['go'], ['go.mod', 'go.sum']],
	rust: [C.orange, 'Rs', ['rs'], ['rust'], ['cargo.toml']],
	ruby: [C.red, 'Rb', ['rb', 'erb', 'gemspec'], ['ruby'], ['gemfile']],
	php: [C.violet, 'Php', ['php', 'phtml'], ['php']],
	swift: [C.coral, 'Sw', ['swift'], ['swift']],
	dart: [C.teal, 'Da', ['dart'], ['dart']],
	lua: [C.blue, 'Lu', ['lua', 'luau'], ['lua', 'luau']],
	r: [C.sky, 'R', ['r', 'rmd'], ['r']],
	perl: [C.sky, 'Pl', ['pl', 'pm'], ['perl']],
	zig: [C.orange, 'Zig', ['zig'], ['zig']],
	elixir: [C.purple, 'Ex', ['ex', 'exs'], ['elixir']],
	haskell: [C.purple, 'Hs', ['hs'], ['haskell']],
	julia: [C.purple, 'Jl', ['jl'], ['julia']],
	ocaml: [C.orange, 'Ml', ['ml', 'mli'], ['ocaml']],
	vue: [C.green, 'V', ['vue'], ['vue']],
	svelte: [C.coral, 'Sv', ['svelte'], ['svelte']],
	astro: [C.purple, 'A', ['astro'], ['astro']],
	graphql: [C.pink, 'GQ', ['graphql', 'gql'], ['graphql']],
	yaml: [C.red, 'Y', ['yaml', 'yml'], ['yaml']],
	toml: [C.orange, 'T', ['toml'], ['toml']],
	bash: [C.green, 'Sh', ['sh', 'bash', 'zsh', 'fish'], ['shellscript']],
	powershell: [C.blue, 'PS', ['ps1', 'psm1', 'psd1'], ['powershell']],
	sqlite: [C.sky, 'DB', ['sqlite', 'sqlite3', 'db'], []],
	terraform: [C.purple, 'Tf', ['tf', 'tfvars'], ['terraform']],
	shader: [C.purple, 'Sh', ['glsl', 'hlsl', 'shader', 'vert', 'frag', 'wgsl'], ['glsl', 'hlsl', 'shaderlab']],
	unity: [C.muted, 'U', ['unity', 'prefab', 'asset', 'meta', 'mat'], []],
	roblox: [C.sky, 'Rbx', ['rbxl', 'rbxlx', 'rbxm', 'rbxmx'], [], ['default.project.json']],
	docker: [C.blue, 'Dk', ['dockerfile'], ['dockerfile', 'dockercompose'], ['dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', '.dockerignore']],
	make: [C.orange, 'Mk', ['mk', 'cmake'], ['makefile', 'cmake'], ['makefile', 'cmakelists.txt']],
	wasm: [C.violet, 'Wa', ['wasm', 'wat'], []],
	git: [C.orange, 'Git', [], ['ignore', 'git-commit', 'git-rebase'], ['.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', '.git-blame-ignore-revs', '.mailmap']],
	npm: [C.red, 'npm', [], [], ['package.json', '.npmrc', '.nvmrc']],
	pnpm: [C.yellow, 'pn', [], [], ['pnpm-lock.yaml', 'pnpm-workspace.yaml']],
	yarn: [C.sky, 'Y', [], [], ['yarn.lock', '.yarnrc', '.yarnrc.yml']],
	bun: [C.yellow, 'Bun', [], [], ['bun.lockb', 'bun.lock', 'bunfig.toml']],
	eslint: [C.violet, 'ES', [], [], ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', '.eslintignore']],
	vite: [C.purple, 'Vi', [], [], ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts']],
	vitest: [C.green, 'Vt', [], [], ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mts']],
	jest: [C.red, 'Je', [], [], ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.json']],
	tailwind: [C.cyan, 'Tw', [], [], ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs']],
	next: [C.muted, 'N', [], [], ['next.config.js', 'next.config.mjs', 'next.config.ts']],
	webpack: [C.sky, 'Wp', [], [], ['webpack.config.js', 'webpack.config.ts']],
	babel: [C.yellow, 'Bb', [], [], ['babel.config.js', 'babel.config.json', '.babelrc']],
	firebase: [C.orange, 'Fb', [], [], ['firebase.json', '.firebaserc']],
	nginx: [C.green, 'Nx', [], ['nginx'], ['nginx.conf']],
	kubernetes: [C.blue, 'K8', [], [], ['kustomization.yaml', 'kustomization.yml']],
};
for (const [id, [color, label]] of Object.entries(languages)) {
	shapes[id] = logo(id, color, label);
}

/** Files drawn as a shape rather than a badge: id -> [extensions, file names, languageIds]. */
const kinds = {
	text: [['txt', 'log', 'rtf'], [], ['plaintext', 'log']],
	image: [['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'avif', 'tif', 'tiff', 'psd'], [], []],
	video: [['mp4', 'mov', 'webm', 'mkv', 'avi'], [], []],
	audio: [['mp3', 'wav', 'ogg', 'flac', 'm4a'], [], []],
	terminal: [['bat', 'cmd'], [], ['bat']],
	database: [['sql', 'prisma'], [], ['sql']],
	box: [[], ['pyproject.toml', 'composer.json', 'requirements.txt'], []],
	table: [['csv', 'tsv', 'xlsx', 'xls'], [], ['csv', 'tsv']],
	archive: [['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'vsix'], [], []],
	font: [['ttf', 'otf', 'woff', 'woff2', 'eot'], [], []],
	pdf: [['pdf'], [], []],
	lock: [['lock'], ['package-lock.json', 'cargo.lock', 'composer.lock', 'poetry.lock'], []],
	settings: [['env', 'ini', 'conf', 'cfg', 'properties', 'editorconfig'], ['.env', '.env.local', '.env.development', '.env.production', '.env.example', '.editorconfig', '.prettierrc', 'jsconfig.json'], ['dotenv', 'ini', 'properties']],
	info: [[], ['readme.md', 'readme', 'readme.txt', 'changelog.md', 'contributing.md'], []],
	license: [[], ['license', 'license.md', 'license.txt', 'licence', 'thirdpartynotices.txt'], []],
	// The instructions agents read: they are what Orbit is built around.
	sparkle: [[], ['claude.md', 'agents.md', 'orbit.md', '.mcp.json', 'skill.md'], []],
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const iconDefinitions = {};
for (const [id, source] of Object.entries(shapes)) {
	fs.writeFileSync(path.join(out, `${id}.svg`), source);
	iconDefinitions[id] = { iconPath: `./svg/${id}.svg` };
}

const theme = {
	iconDefinitions,
	file: 'file',
	folder: 'folder',
	folderExpanded: 'folder-open',
	rootFolder: 'folder-root',
	rootFolderExpanded: 'folder-root-open',
	fileExtensions: {},
	fileNames: {},
	languageIds: {},
	folderNames: {},
	folderNamesExpanded: {},
	hidesExplorerArrows: false,
};
for (const [id, [, , extensions, languageIds, fileNames = []]] of Object.entries(languages)) {
	extensions.forEach(e => theme.fileExtensions[e] = id);
	languageIds.forEach(l => theme.languageIds[l] = id);
	fileNames.forEach(n => theme.fileNames[n] = id);
}
for (const [id, [extensions, fileNames, languageIds]] of Object.entries(kinds)) {
	extensions.forEach(e => theme.fileExtensions[e] = id);
	fileNames.forEach(n => theme.fileNames[n] = id);
	languageIds.forEach(l => theme.languageIds[l] = id);
}
for (const [id, [, ...names]] of Object.entries(folders)) {
	for (const name of names) {
		theme.folderNames[name] = `folder-${id}`;
		theme.folderNamesExpanded[name] = `folder-${id}-open`;
	}
}
fs.writeFileSync(path.join(here, 'orbit-icon-theme.json'), JSON.stringify(theme, null, '\t') + '\n');
console.log(`${Object.keys(shapes).length} icons`);
