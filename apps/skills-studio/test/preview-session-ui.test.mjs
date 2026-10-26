import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/PreviewSession.tsx', import.meta.url), 'utf8');
const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
function mount(fetch) {
  const values = [], effects = [], cleanups = [];
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], value => { values[slot] = value; }]; },
    useRef(initial) { const slot = index++; return values[slot] ||= { current: initial }; },
    useEffect(effect) { const slot = index++; if (!(slot in values)) { values[slot] = true; effects.push(effect); } },
  };
  const exports = {};
  const redirected = [];
  runInNewContext(code, { exports, require: name => name === 'react' ? hooks : name.endsWith('.css') ? {} : require(name), fetch, location: { replace: url => redirected.push(url) } });
  return {
    redirected,
    render() { index = 0; const tree = exports.PreviewSession(); while (effects.length) cleanups.push(effects.shift()()); return tree; },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}
function findButton(tree) {
  if (!tree) return undefined;
  if (tree.type === 'button') return tree;
  return React.Children.toArray(tree.props?.children).map(findButton).find(Boolean);
}
function html(app) { return renderToStaticMarkup(app.render()); }

test('session capability reveals an accessible sign-out action with current-browser scope', async () => {
  const requests = [];
  const app = mount(async (url, options) => { requests.push({ url, options }); return new Response('{"signOut":true}'); });
  assert.equal(html(app), '');
  await settle();
  assert.match(html(app), /<button[^>]*>Sign out<\/button>/);
  assert.match(html(app), /this browser/i);
  assert.equal(requests[0].url, '/api/session');
  assert.equal(requests[0].options.credentials, 'same-origin');
});

test('unsupported, unauthorized, malformed and unreachable session probes leave the local app unchanged', async () => {
  for (const response of [() => new Response('missing', { status: 404 }), () => new Response('{}', { status: 401 }), () => new Response('{"signOut":false}'), () => new Response('{"signOut":"true"}'), () => new Response('not JSON'), () => { throw new TypeError('offline'); }]) {
    const app = mount(async () => response());
    app.render(); await settle();
    assert.equal(html(app), '');
  }
});

test('sign-out uses a single credentialed DELETE and replaces the page only after success', async () => {
  let complete;
  const requests = [];
  const app = mount(async (url, options) => {
    requests.push({ url, options });
    if (options.method !== 'DELETE') return new Response('{"signOut":true}');
    return new Promise(resolve => { complete = resolve; });
  });
  app.render(); await settle();
  const button = findButton(app.render());
  assert.ok(button, 'sign-out action is visible after capability probe');
  const pending = button.props.onClick();
  await button.props.onClick();
  assert.equal(findButton(app.render()).props.disabled, true);
  assert.deepEqual(app.redirected, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/session');
  assert.equal(requests[1].options.method, 'DELETE');
  assert.equal(requests[1].options.credentials, 'same-origin');
  complete(new Response('{"ok":true}'));
  await pending;
  assert.deepEqual(app.redirected, ['/']);
});

test('failed sign-out exposes an announced error and a working retry without navigating', async () => {
  for (const failure of [() => new Response('{}', { status: 503 }), () => { throw new TypeError('offline'); }]) {
    let attempts = 0;
    const app = mount(async (_url, options) => {
      if (options.method !== 'DELETE') return new Response('{"signOut":true}');
      if (++attempts === 1) return failure();
      return new Response('{"ok":true}');
    });
    app.render(); await settle();
    assert.ok(findButton(app.render()), 'sign-out action is visible after capability probe');
    await findButton(app.render()).props.onClick();
    assert.deepEqual(app.redirected, []);
    assert.match(html(app), /role="alert"/);
    assert.match(html(app), /try again|retry/i);
    assert.equal(findButton(app.render()).props.disabled, false);
    assert.ok(findButton(app.render()), 'sign-out action is visible after capability probe');
    await findButton(app.render()).props.onClick();
    assert.deepEqual(app.redirected, ['/']);
  }
});
