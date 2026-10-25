import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=await mkdtemp(join(root,'.pdf-output-test-'));after(()=>rm(scratch,{recursive:true,force:true}));
const source=await readFile(new URL('../src/PdfOutput.tsx',import.meta.url),'utf8');const entry=join(scratch,'PdfOutput.mjs');
await writeFile(entry,transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,jsx:JsxEmit.ReactJSX}}).outputText);
const {PdfOutput}=await import(pathToFileURL(entry).href);
const render=props=>renderToStaticMarkup(React.createElement(PdfOutput,{url:'/api/runs/run/artifacts/pdf',name:'study.pdf',...props}));
test('PDF without a companion gives a clear download action instead of a blank iframe',()=>{
 const html=render();assert.match(html,/Your PDF is ready/);assert.match(html,/Download PDF/);assert.match(html,/href="\/api\/runs\/run\/artifacts\/pdf\?download=1"/);assert.doesNotMatch(html,/<iframe|<img/);
});
test('a companion is explicitly identified as an image while the action still downloads the PDF',()=>{
 const html=render({imageUrl:'/api/runs/run/artifacts/png'});assert.match(html,/Companion image preview/);assert.match(html,/src="\/api\/runs\/run\/artifacts\/png"/);assert.match(html,/alt="Companion preview for study.pdf"/);assert.match(html,/href="\/api\/runs\/run\/artifacts\/pdf\?download=1"/);assert.doesNotMatch(html,/<iframe/);
});
