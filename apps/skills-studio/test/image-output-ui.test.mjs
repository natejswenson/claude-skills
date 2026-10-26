import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/ImageOutput.tsx', import.meta.url), 'utf8');
const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText;
function mount() {
 const values = [], effects = [], cleanups = []; let index = 0, resize, disconnected = false;
 const hooks = {
  useState(initial) { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], value => { values[slot] = typeof value === 'function' ? value(values[slot]) : value; }]; },
  useRef(initial) { const slot = index++; return values[slot] ||= { current: initial }; },
  useLayoutEffect(effect, deps) { const slot = index++; if (!values[slot] || deps.some((d, i) => d !== values[slot][i])) { values[slot] = deps; effects.push(effect); } },
 };
 const exports = {};
 runInNewContext(code, { exports, require: name => name === 'react' ? hooks : name.endsWith('.css') ? {} : require(name), ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected = true; } } });
 const viewport = { clientWidth: 500, clientHeight: 300, scrollLeft: 0, scrollTop: 0 };
 const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
 return { exports, viewport,
  render() { index = 0; const tree = exports.ImageOutput({ url: '/image/1', name: 'poster.png' }); const image = nodes(tree).find(n => n.type === 'img'); if (image) { viewport.scrollLeft = Math.min(viewport.scrollLeft, Math.max(0, image.props.style.width - viewport.clientWidth)); viewport.scrollTop = Math.min(viewport.scrollTop, Math.max(0, image.props.style.height - viewport.clientHeight)); } nodes(tree).filter(n => n.props?.ref).forEach(n => { n.props.ref.current = viewport; }); while (effects.length) cleanups.push(effects.shift()()); return tree; },
  find(predicate) { return nodes(this.render()).find(predicate); },
  click(label) { const button = this.find(n => n.type === 'button' && (n.props['aria-label'] || n.props.children) === label); assert.ok(button, label); button.props.onClick(); this.render(); },
  load(width, height) { this.find(n => n.type === 'img').props.onLoad({ currentTarget: { naturalWidth: width, naturalHeight: height } }); this.render(); },
  resize(width, height) { viewport.clientWidth = width; viewport.clientHeight = height; resize(); this.render(); },
  unmount() { cleanups.forEach(cleanup => cleanup?.()); return disconnected; },
 };
}
const html = app => renderToStaticMarkup(app.render());
test('fit respects both viewport axes and never enlarges small images', () => {
 const { fitImage } = mount().exports; assert.equal(typeof fitImage, 'function');
 assert.equal(fitImage(2000,1000,500,300),.25); assert.equal(fitImage(1000,2000,500,300),.15); assert.equal(fitImage(100,50,500,300),1);
});
test('zoom escapes tiny fit, stays in range, and preserves the center image point', () => {
 const { stepImageZoom, imageScrollCenter } = mount().exports; assert.equal(typeof stepImageZoom,'function');
 assert.equal(stepImageZoom(.08,1),.25); assert.equal(stepImageZoom(.25,-1),.25); assert.equal(stepImageZoom(4,1),4); assert.equal(stepImageZoom(1,-1),.75);
 const center = opts => JSON.parse(JSON.stringify(imageScrollCenter(opts)));
 assert.deepEqual(center({width:2000,height:1000,viewportWidth:500,viewportHeight:300,left:300,top:100,from:1,to:2}),{left:850,top:350});
 assert.deepEqual(center({width:200,height:100,viewportWidth:500,viewportHeight:300,left:0,top:0,from:1,to:4}),{left:150,top:50});
});
test('loading and failed images keep controls disabled and expose a focusable viewport', () => {
 const app=mount(); assert.match(html(app),/Loading image/); assert.match(html(app),/tabindex="0"/); assert.match(html(app),/aria-label="poster.png image viewport"/);
 assert.equal(app.find(n=>n.type==='button').props.disabled,true); app.find(n=>n.type==='img').props.onError(); assert.match(html(app),/role="alert"/); assert.match(html(app),/Could not load/); assert.equal(app.find(n=>n.type==='button').props.disabled,true);
});
test('dimensions, fit resizing, actual pixels, fixed custom zoom, limits and cleanup work together', () => {
 const app=mount(); app.render(); app.load(2000,1000); assert.match(html(app),/2000 × 1000/); assert.equal(app.find(n=>n.type==='img').props.style.width,500);
 app.resize(400,100); assert.equal(app.find(n=>n.type==='img').props.style.width,200); app.click('Zoom in'); assert.equal(app.find(n=>n.type==='img').props.style.width,500);
 app.resize(600,300); assert.equal(app.find(n=>n.type==='img').props.style.width,500); app.click('Actual size'); assert.equal(app.find(n=>n.type==='img').props.style.width,2000); assert.match(html(app),/100%/); assert.match(html(app),/Scroll to pan/);
 for(let i=0;i<15;i++)app.click('Zoom in'); assert.equal(app.find(n=>n.type==='button'&&n.props['aria-label']==='Zoom in').props.disabled,true);
 app.click('Fit'); assert.equal(app.find(n=>n.type==='img').props.style.width,600); assert.equal(app.unmount(),true);
});

test('zoom-out keeps the previously visible center even when layout clamps old scroll offsets', () => {
 const app=mount(); app.render(); app.load(2000,1000); app.click('Actual size');
 app.viewport.scrollLeft=1400; app.viewport.scrollTop=600;
 app.click('Zoom out');
 assert.equal(app.viewport.scrollLeft,987.5); assert.equal(app.viewport.scrollTop,412.5);
});

test('fit rounding does not suggest panning when the whole image fits', () => {
 const app=mount(); app.render(); app.resize(569,218); app.load(2400,1600);
 assert.doesNotMatch(html(app),/Scroll to pan/);
 app.click('Actual size'); assert.match(html(app),/Scroll to pan/);
});
