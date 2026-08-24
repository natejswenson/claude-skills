import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aliasesFor, appIdFor, loadConfig, memberFor, pickerFor, rememberDevices, resolveDevice, saveConfig } from '../lib/config.mjs';

const dev = (name, identifier, address) => ({
  name, identifier, address, model: 'Apple TV 4K', version: '18.5', all_identifiers: [identifier, `${identifier}-mac`],
  services: [{ protocol: 'airplay', paired: true }, { protocol: 'companion', paired: false }],
});

test('a scan is remembered and survives a round trip', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'appletv-cfg-')), 'config.json');
  const cfg = rememberDevices(loadConfig(path), [dev('Living Room', 'AAA', '10.0.0.5')], '2026-08-24T00:00:00Z');
  saveConfig(cfg, path);
  const back = loadConfig(path);
  assert.deepEqual(back.devices.AAA.paired, ['airplay']);
  assert.equal(back.devices.AAA.address, '10.0.0.5');
});

test('resolution: alias, name, identifier, address, partial name — then the default', () => {
  const cfg = rememberDevices(loadConfig('/nonexistent'), [dev('Living Room', 'AAA', '10.0.0.5'), dev('Bedroom TV', 'BBB', '10.0.0.6')], 't');
  cfg.aliases['den'] = 'AAA';
  assert.equal(resolveDevice(cfg, 'den').id, 'AAA');
  assert.equal(resolveDevice(cfg, 'bedroom tv').id, 'BBB');
  assert.equal(resolveDevice(cfg, 'BBB-mac').id, 'BBB');
  assert.equal(resolveDevice(cfg, '10.0.0.6').id, 'BBB');
  assert.equal(resolveDevice(cfg, 'living').id, 'AAA');
  assert.equal(resolveDevice(cfg, null).error, 'multiple_devices');
  cfg.default = 'BBB';
  assert.equal(resolveDevice(cfg, null).id, 'BBB');
  assert.equal(resolveDevice(cfg, 'kitchen').error, 'device_not_found');
  assert.deepEqual(aliasesFor(cfg, 'AAA'), ['den']);
});

test('a single remembered device is the implicit default', () => {
  const cfg = rememberDevices(loadConfig('/nonexistent'), [dev('Only', 'AAA', '10.0.0.5')], 't');
  assert.equal(resolveDevice(cfg, null).via, 'only device');
  assert.equal(resolveDevice({ default: null, aliases: {}, devices: {} }, null).error, 'no_device');
});

test('app words resolve to bundle ids and services survive a round trip', () => {
  assert.equal(appIdFor('Netflix'), 'com.netflix.Netflix');
  assert.equal(appIdFor('disney+'), 'com.disney.disneyplus');
  assert.equal(appIdFor('apple tv'), 'com.apple.TVWatchList');
  assert.equal(appIdFor('paramount+'), 'com.cbsvideo.app');
  assert.equal(appIdFor('com.example.app'), 'com.example.app');
  assert.equal(appIdFor('no such thing'), null);
  const path = join(mkdtempSync(join(tmpdir(), 'appletv-cfg-')), 'config.json');
  const cfg = loadConfig(path);
  cfg.services = [{ word: 'netflix', id: 'com.netflix.Netflix' }];
  saveConfig(cfg, path);
  assert.deepEqual(loadConfig(path).services, [{ word: 'netflix', id: 'com.netflix.Netflix' }]);
  assert.deepEqual(loadConfig('/nonexistent').services, []);
});

test('pickers: the household and an app profile list resolve names to tiles', () => {
  const cfg = loadConfig('/nonexistent');
  cfg.users = { layout: 'horizontal', members: [{ name: 'Nathaniel', position: 1 }, { name: 'McKenzie', position: 2 }], default: 'Nathaniel' };
  cfg.prefs['com.netflix.Netflix'] = { profile: { name: 'Nathaniel', position: 1 }, profiles: { layout: 'vertical', members: [{ name: 'Nathaniel', position: 1 }, { name: 'Kids', position: 3 }] } };
  assert.equal(memberFor(pickerFor(cfg), 'mckenzie').position, 2);
  assert.equal(memberFor(pickerFor(cfg), 'nath').name, 'Nathaniel');
  assert.equal(memberFor(pickerFor(cfg), 'nobody'), null);
  const nf = pickerFor(cfg, 'com.netflix.Netflix');
  assert.equal(nf.layout, 'vertical');
  assert.equal(memberFor(nf, 'kids').position, 3);
  assert.deepEqual(pickerFor(cfg, 'com.unknown').members, []);
});
