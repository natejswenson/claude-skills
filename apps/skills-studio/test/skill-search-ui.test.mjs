import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readCatalog } from '../server/catalog.mjs';
const scratch = await mkdtemp(join(fileURLToPath(new URL('../', import.meta.url)), '.search-ui-'));
after(() => rm(scratch, { recursive: true, force: true }));
const source = await readFile(new URL('../src/SkillSearchResults.tsx', import.meta.url), 'utf8');
const entry = join(scratch, 'SkillSearchResults.mjs');
await writeFile(entry, transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText);
const { SkillSearchResults } = await import(pathToFileURL(entry).href);
const skills = await readCatalog(fileURLToPath(new URL('../../../', import.meta.url)));
const render = query => renderToStaticMarkup(React.createElement(SkillSearchResults, { skills, query, onChoose() {}, onClear() {} }));
test('empty global search exposes the complete real catalog including matches after twelve', () => {
 const html = render('');
 assert.match(html, new RegExp(`${skills.length} skills`));
 assert.equal((html.match(/<button/g) || []).length, skills.length);
 for (const skill of skills) assert.ok(html.includes(`<strong>${skill.name}</strong>`), skill.name);
 assert.match(html, /role="status"/);
});
test('search matches names and descriptions case-insensitively with an accurate singular count', () => {
 const html = render('BRAND-IMAGES');
 assert.match(html, /1 skill/);
 assert.match(html, /<strong>brand-images<\/strong>/);
 assert.equal((html.match(/<button/g) || []).length, 1);
 const phrase = skills[0].description.slice(0, 30).toUpperCase();
 assert.ok(render(phrase).includes(`<strong>${skills[0].name}</strong>`));
});
test('no match gives useful feedback and a clear action without a choose prompt', () => {
 const html = render('no-such-skill-123');
 assert.match(html, /0 skills/);
 assert.match(html, /No skills found/);
 assert.match(html, /Try another name or describe/);
 assert.match(html, />Clear search<\/button>/);
 assert.doesNotMatch(html, /CHOOSE A SKILL/);
});
test('result selection prepares the selected skill and clearing invokes the caller focus action', () => {
 let selected, cleared = false;
 const tree = SkillSearchResults({ skills, query: 'brand-images', onChoose: skill => { selected = skill; }, onClear: () => { cleared = true; } });
 const buttons = [];
 function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); if (node.type === 'button') buttons.push(node); walk(node.props?.children); }
 walk(tree); buttons[0].props.onClick(); assert.equal(selected.id, 'brand-images');
 buttons.length = 0;
 walk(SkillSearchResults({ skills, query: 'no-such-skill-123', onChoose() {}, onClear: () => { cleared = true; } }));
 buttons[0].props.onClick(); assert.equal(cleared, true);
});
