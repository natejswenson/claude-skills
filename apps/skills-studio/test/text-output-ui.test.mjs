import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.text-output-test-'));
after(() => rm(scratch, {recursive:true,force:true}));
const source = await readFile(new URL('../src/TextOutput.tsx', import.meta.url),'utf8');
const entry = join(scratch,'TextOutput.mjs');
await writeFile(entry,transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,jsx:JsxEmit.ReactJSX}}).outputText);
const {TextContent,formatTextOutput,isTextOutput}=await import(pathToFileURL(entry).href);
test('JSON data is formatted and malformed JSON remains inspectable',()=>{
 assert.equal(formatTextOutput('{"city":"Madison","rows":[1,2]}','data.json').text,JSON.stringify({city:'Madison',rows:[1,2]},null,2));
 assert.equal(formatTextOutput('{broken','data.json').text,'{broken');
});
test('source output is inert escaped text with a keyboard-accessible preview',()=>{
 const html=renderToStaticMarkup(React.createElement(TextContent,{source:'<script>alert(1)</script>',name:'example.txt'}));
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/i);
 assert.match(html,/tabindex="0" aria-label="example.txt content"/);
 assert.equal(isTextOutput('reports/REPORT.JSON'),true);
 assert.equal(isTextOutput('report.html'),false);
 assert.equal(isTextOutput('report.pdf'),false);
});
test('large text previews disclose truncation and preserve complete source input',()=>{
 const source='x'.repeat(200001);
 const result=formatTextOutput(source,'notes.txt');
 assert.equal(result.text.length,200000);assert.equal(result.truncated,true);assert.equal(source.length,200001);
 assert.match(renderToStaticMarkup(React.createElement(TextContent,{source,name:'notes.txt'})),/Download the file for the complete content/);
});
