import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.markdown-test-'));
after(() => rm(scratch, { recursive: true, force: true }));
const source = await readFile(new URL('../src/Markdown.tsx', import.meta.url), 'utf8');
const entry = join(scratch, 'Markdown.mjs');
await writeFile(entry, transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText);
const { Markdown } = await import(pathToFileURL(entry).href);
const render = text => renderToStaticMarkup(React.createElement(Markdown, {children:text}));
test('generated comparison tables render semantic headings and cells in a scrollable wrapper', () => {
 const html = render('| Skill | Purpose |\n| --- | --- |\n| city-report | Research |');
 assert.match(html, /class="markdown-table"/);
 assert.match(html, /tabindex="0" role="region" aria-label="Scrollable table"/);
 assert.match(html, /<th>Skill<\/th>/);
 assert.match(html, /<td>city-report<\/td>/);
 assert.doesNotMatch(html, /\| Skill/);
});
test('task lists render as read-only checkboxes and unsafe HTML and links remain inert', () => {
 const html = render('- [x] Done\n- [ ] Next\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert)');
 assert.match(html, /type="checkbox" disabled="" checked=""/);
 assert.match(html, /type="checkbox" disabled=""/);
 assert.doesNotMatch(html, /<script>|href="javascript:/);
});


test('known report links open captured output while unrelated links retain normal behavior', () => {
 const props = {children:'[report](./report%20one.md) and [source](https://example.com)',files:['report one.md'],workspace:'/trusted/work',onOpenFile(){}};
 const html = renderToStaticMarkup(React.createElement(Markdown,props));
 assert.match(html, /<button class="inline-file" type="button">report<\/button>/);
 assert.match(html, /<a href="https:\/\/example.com">source<\/a>/);
 assert.doesNotMatch(html, /href=".\/report/);
 const absolute = renderToStaticMarkup(React.createElement(Markdown,{...props,children:'[report](/trusted/work/report%20one.md)'}));
 assert.match(absolute, /class="inline-file"/);
 const unknown = renderToStaticMarkup(React.createElement(Markdown,{...props,children:'[unknown](/other/report%20one.md)'}));
 assert.doesNotMatch(unknown, /class="inline-file"/);
 let opened;
 const element = Markdown({...props,onOpenFile:name=>{opened=name}});
 const anchor = element.props.components.a({href:'./report%20one.md',children:'report'});
 anchor.props.onClick();
 assert.equal(opened,'report one.md');
});

test('footnote attributes survive and in-document anchors scroll without replacing the run route', () => {
 const html = render('A note[^1].\n\n[^1]: Supporting detail.');
 assert.match(html, /id="user-content-fnref-1"/);
 assert.match(html, /data-footnote-ref="true"/);
 assert.match(html, /href="#user-content-fnref-1"/);
 let prevented=false, scrolled=false;
 const element=Markdown({children:'note'});
 const anchor=element.props.components.a({href:'#user-content-fn-1',children:'1','data-footnote-ref':true});
 anchor.props.onClick({preventDefault(){prevented=true},currentTarget:{closest(){return {querySelectorAll(){return [{id:'user-content-fn-1',scrollIntoView(){scrolled=true}}]}}}}});
 assert.equal(prevented,true);
 assert.equal(scrolled,true);
});
