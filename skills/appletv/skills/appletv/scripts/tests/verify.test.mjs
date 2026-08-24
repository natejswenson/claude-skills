import test from 'node:test';
import assert from 'node:assert/strict';
import { VERDICTS, frozenReadback, launchTarget, playVerdict, textVerdict, verdict } from '../lib/verify.mjs';

const st = (o = {}) => ({
  power: 'on',
  app: { name: 'Netflix', id: 'com.netflix.Netflix' },
  focus: 'unfocused',
  volume: 30,
  playing: { device_state: 'playing', title: 'Severance', position: 100, total_time: 3000, repeat: 'off', shuffle: 'off', content_identifier: 'x1' },
  unsupported: {},
  ...o,
});
const play = (device_state, extra = {}) => st({ playing: { ...st().playing, device_state, ...extra } });
const cap = (command, before, after, arg = null, sent = { ok: true }) => ({ command, arg, sent, before, after });

test('only three verdicts exist', () => {
  assert.deepEqual(VERDICTS, ['verified', 'mismatch', 'unverifiable']);
});

test('pause is verified only when the read-back says paused', () => {
  assert.equal(verdict(cap('pause', play('playing'), play('paused'))).verdict, 'verified');
  // already paused before the send proves nothing — never "verified"
  const already = verdict(cap('pause', play('paused'), play('paused')));
  assert.equal(already.verdict, 'unverifiable');
  assert.match(already.why, /already paused/);
  assert.equal(verdict(cap('pause', play('playing'), play('playing'))).verdict, 'mismatch');
  assert.equal(verdict(cap('play', play('paused'), play('playing'))).verdict, 'verified');
  assert.equal(verdict(cap('play', play('paused'), play('paused'))).verdict, 'mismatch');
});

test('a state the device cannot report is unverifiable, never verified', () => {
  const blind = st({ playing: null, unsupported: { playing: 'NotSupportedError' } });
  assert.equal(verdict(cap('pause', blind, blind)).verdict, 'unverifiable');
  const noPower = st({ power: 'unknown', unsupported: { power: 'reported unknown by the device' } });
  const v = verdict(cap('turn_off', st(), noPower));
  assert.equal(v.verdict, 'unverifiable');
  assert.match(v.why, /does not report power/);
});

test('a keypress with no readable state is unverifiable — the rule the trap pins', () => {
  for (const k of ['up', 'down', 'left', 'right', 'select', 'menu', 'top_menu']) {
    assert.equal(verdict(cap(k, st(), st())).verdict, 'unverifiable', k);
  }
});

test('a refused command is a mismatch, not a quiet success', () => {
  const v = verdict(cap('pause', play('playing'), play('playing'), null, { ok: false, error: 'command_refused', detail: 'nope' }));
  assert.equal(v.verdict, 'mismatch');
  assert.match(v.why, /refused/);
});

test('power, volume and position rules read the direction, not just the send', () => {
  assert.equal(verdict(cap('turn_off', st({ power: 'on' }), st({ power: 'off' }))).verdict, 'verified');
  assert.equal(verdict(cap('turn_off', st({ power: 'on' }), st({ power: 'on' }))).verdict, 'mismatch');
  assert.equal(verdict(cap('set_volume', st({ volume: 10 }), st({ volume: 50 }), '50')).verdict, 'verified');
  assert.equal(verdict(cap('volume_up', st({ volume: 10 }), st({ volume: 12 }))).verdict, 'verified');
  assert.equal(verdict(cap('volume_up', st({ volume: 10 }), st({ volume: 10 }))).verdict, 'mismatch');
  assert.equal(verdict(cap('volume_up', st({ volume: null }), st({ volume: null }))).verdict, 'unverifiable');
  assert.equal(verdict(cap('skip_forward', play('playing', { position: 100 }), play('playing', { position: 131 }))).verdict, 'verified');
  assert.equal(verdict(cap('skip_forward', play('playing', { position: 100 }), play('playing', { position: 101 }))).verdict, 'mismatch');
  assert.equal(verdict(cap('skip_backward', play('playing', { position: 100 }), play('playing', { position: 70 }))).verdict, 'verified');
  assert.equal(verdict(cap('set_position', play('playing'), play('playing', { position: 602 }), '600')).verdict, 'verified');
});

test('launch_app verifies against the bundle id, or the app a deep link opens', () => {
  const tv = st({ app: { name: 'TV', id: 'com.apple.TVWatchList' } });
  const nf = st({ app: { name: 'Netflix', id: 'com.netflix.Netflix' } });
  assert.equal(verdict(cap('launch_app', tv, nf, 'com.netflix.Netflix')).verdict, 'verified');
  // already the now-playing owner: foreground unknown, never verified
  assert.equal(verdict(cap('launch_app', nf, nf, 'com.netflix.Netflix')).verdict, 'unverifiable');
  // unchanged = unknowable (app is the now-playing owner, not the foreground) — never "mismatch", never "verified"
  assert.equal(verdict(cap('launch_app', tv, tv, 'com.netflix.Netflix')).verdict, 'unverifiable');
  // changed to something ELSE is evidence against the launch
  const dp = st({ app: { name: 'Disney+', id: 'com.disney.disneyplus' } });
  assert.equal(verdict(cap('launch_app', tv, dp, 'com.netflix.Netflix')).verdict, 'mismatch');
  assert.equal(verdict(cap('launch_app', tv, nf, 'https://www.netflix.com/title/80234304')).verdict, 'verified');
  assert.equal(verdict(cap('launch_app', tv, tv, 'https://example.com/x')).verdict, 'unverifiable');
  assert.equal(launchTarget('https://tv.apple.com/show/severance/umc.cmc.1'), 'com.apple.TVWatchList');
  assert.equal(launchTarget('com.disney.disneyplus'), 'com.disney.disneyplus');
});

test('next verifies by a title change; play_pause by a toggle', () => {
  assert.equal(verdict(cap('next', play('playing'), play('playing', { title: 'Next ep', content_identifier: 'x2' }))).verdict, 'verified');
  assert.equal(verdict(cap('next', play('playing'), play('playing'))).verdict, 'unverifiable');
  assert.equal(verdict(cap('play_pause', play('playing'), play('paused'))).verdict, 'verified');
  assert.equal(verdict(cap('play_pause', play('playing'), play('playing'))).verdict, 'mismatch');
});

test('the keyboard verdict reads the field back', () => {
  const t = (o) => textVerdict({ op: 'set', text: 'stranger things', focus: 'focused', sent: { ok: true }, before: '', after: 'stranger things', ...o });
  assert.equal(t({}).verdict, 'verified');
  assert.equal(t({ after: 'stranger' }).verdict, 'mismatch');
  assert.equal(t({ focus: 'unfocused' }).verdict, 'mismatch');
  assert.equal(t({ after: null }).verdict, 'unverifiable');
  assert.equal(textVerdict({ op: 'append', text: ' 2', focus: 'focused', sent: { ok: true }, before: 'stranger', after: 'stranger 2' }).verdict, 'verified');
  assert.equal(textVerdict({ op: 'clear', focus: 'focused', sent: { ok: true }, before: 'x', after: '' }).verdict, 'verified');
});

test('the TV app freeze: a read-back that never moved is unverifiable, not a mismatch', () => {
  const tv = (device_state, position) => st({ app: { name: 'TV', id: 'com.apple.TVWatchList' }, playing: { ...st().playing, device_state, position, title: 'Silo' } });
  const frozenCap = { ...cap('play', tv('paused', 101), tv('paused', 101)), reads: [tv('paused', 101), tv('paused', 101), tv('paused', 101)] };
  assert.equal(frozenReadback(frozenCap), true);
  const v = verdict(frozenCap);
  assert.equal(v.verdict, 'unverifiable');
  assert.match(v.why, /never changed/);
  assert.equal(playVerdict(frozenCap, { title: 'Silo', appId: 'com.apple.TVWatchList' }).verdict, 'unverifiable');
  // the same numbers on Netflix ARE a mismatch — the freeze is a TV-app fact
  const nfFrozen = { ...cap('play', play('paused'), play('paused')), reads: [play('paused')] };
  assert.equal(verdict(nfFrozen).verdict, 'mismatch');
  // and a TV-app read-back that DID move is judged normally
  const moved = { ...cap('play', tv('paused', 101), tv('playing', 130)), reads: [tv('paused', 101), tv('playing', 130)] };
  assert.equal(verdict(moved).verdict, 'verified');
});

test('power already matching before the send is not verified', () => {
  const v = verdict(cap('turn_on', st({ power: 'on' }), st({ power: 'on' })));
  assert.equal(v.verdict, 'unverifiable');
  assert.match(v.why, /already on/);
  const unread = st({ power: null, unread: { power: 'TimeoutError' } });
  assert.match(verdict(cap('turn_off', st(), unread)).why, /not read/);
});

test('stop that closes the player is not a verified stop', () => {
  const gone = st({ app: null, playing: { ...st().playing, device_state: 'idle' } });
  assert.equal(verdict(cap('stop', play('playing'), gone)).verdict, 'unverifiable');
  assert.equal(verdict(cap('stop', play('playing'), play('stopped'))).verdict, 'verified');
});
