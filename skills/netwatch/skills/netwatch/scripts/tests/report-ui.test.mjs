import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Optional real-browser check: NETWATCH_UI_BROWSER=/path/to/chrome node --test
// scripts/tests/report-ui.test.mjs. Uses a private profile and offline fixture.
test('browser search, filters, reset, sorting and expandable evidence work', { skip: !process.env.NETWATCH_UI_BROWSER }, (t) => {
  const out = mkdtempSync(join(tmpdir(), 'netwatch-ui-'));
  const original = readFileSync(new URL('../../evals/baseline/report.html', import.meta.url), 'utf8');
  const checks = `<script>
  try {
    const rows = [...document.querySelectorAll('[data-flow]')];
    const visible = () => rows.filter(r => !r.hidden);
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    assert(rows.length >= 10, 'fixture floor');
    const search = document.querySelector('#search');
    search.value = 'not-a-process-999999'; search.dispatchEvent(new Event('input'));
    assert(visible().length === 0, 'search must hide all nonmatches');
    assert(document.querySelector('#visible').textContent.includes('no matching rows'), 'empty view explained');
    document.querySelector('#reset').click(); assert(visible().length === rows.length, 'reset restores rows');
    const kind = document.querySelector('#kind'); kind.value = 'bound'; kind.dispatchEvent(new Event('change'));
    assert(visible().length > 0 && visible().every(r => r.dataset.kind === 'bound'), 'socket-kind filter');
    document.querySelector('#reset').click();
    const status = document.querySelector('#status'); status.value = 'known'; status.dispatchEvent(new Event('change'));
    assert(visible().length > 0 && visible().every(r => r.dataset.status === 'known'), 'baseline-status filter');
    document.querySelector('#reset').click();
    const header = document.querySelector('th'); header.querySelector('button').click();
    assert(header.getAttribute('aria-sort') === 'ascending', 'sort ascending');
    header.querySelector('button').click(); assert(header.getAttribute('aria-sort') === 'descending', 'sort descending');
    const detail = document.querySelector('details'); detail.querySelector('summary').click();
    assert(detail.open && detail.querySelector('pre').textContent.includes('p'), 'expand observed source');
    detail.open = false;
    document.documentElement.dataset.uiResult = 'passed';
  } catch (error) { document.documentElement.dataset.uiResult = error.message; }
  </script>`;
  const input = join(out, 'report.html');
  writeFileSync(input, original.replace('</body>', `${checks}</body>`));
  const result = spawnSync(process.env.NETWATCH_UI_BROWSER, ['--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(out, 'profile')}`, '--window-size=1200,1000', '--virtual-time-budget=1000', `--screenshot=${join(out, 'report.png')}`, '--dump-dom', pathToFileURL(input).href], { encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.match(result.stdout, /data-ui-result="passed"/);
  t.diagnostic(`Browser-verified report and screenshot: ${out}`);
});
