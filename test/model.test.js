// -----------------------------------------------------------------------------
// Configuration parsing and the reading of the real Netdata answers
// (test/fixtures/netdata/, Netdata v2.12.1).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAgentUrl, parseCharts } from '../src/config.js';
import { NetdataClient } from '../src/netdata/client.js';
import { clearedEntry, parseAlarms, parseNodes, parseSnapshot } from '../src/netdata/model.js';
import { CHILD_GUID, PARENT_GUID, readFixture } from './helpers/fakeNetdata.js';

test('the agent address: bare host, host:port, copied dashboard URL, reverse proxy', () => {
  assert.equal(parseAgentUrl('192.0.2.10'), 'http://192.0.2.10:19999');
  assert.equal(parseAgentUrl(' nas.lan:20000 '), 'http://nas.lan:20000');
  assert.equal(parseAgentUrl('http://nas.lan:19999/v3/'), 'http://nas.lan:19999');
  assert.equal(parseAgentUrl('http://nas.lan:19999/api/v1/info'), 'http://nas.lan:19999');
  assert.equal(parseAgentUrl('https://example.org/netdata/'), 'https://example.org/netdata');
  assert.equal(parseAgentUrl('http://user:pass@nas.lan'), null);
  assert.equal(parseAgentUrl('ftp://nas.lan'), null);
  assert.equal(parseAgentUrl(''), null);
});

test('the extra charts: separators, duplicates, garbage, five at most', () => {
  assert.deepEqual(parseCharts('system.io, disk_space./mnt/data;system.io  net.eth0'), [
    'system.io',
    'disk_space./mnt/data',
    'net.eth0',
  ]);
  assert.deepEqual(parseCharts('a b c d e f g'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(parseCharts('rm -rf "x"'), ['rm']);
});

test('the configuration: agents, tokens without "Bearer", invalid slots, defaults', () => {
  const config = normalizeConfig({
    agent_1_url: '192.0.2.10',
    agent_1_token: ' Bearer abc\n',
    agent_2_url: 'not a url at all ://',
    poll_interval: '45',
  });
  assert.deepEqual(config.agents, [{ slot: 1, url: 'http://192.0.2.10:19999', token: 'abc' }]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.language, 'fr');
});

test('the nodes of a parent: itself first, then its child', () => {
  assert.deepEqual(parseNodes(readFixture('info.json')), [
    { guid: PARENT_GUID, hostname: 'nd-parent', local: true, reachable: true },
    { guid: CHILD_GUID, hostname: 'nd-child', local: false, reachable: true },
  ]);
  // Before v1.31: names only, the agent itself by its uid.
  assert.deepEqual(parseNodes({ uid: PARENT_GUID, mirrored_hosts: ['old'] }), [
    { guid: PARENT_GUID, hostname: 'old', local: true, reachable: true },
  ]);
});

test('the snapshot of a real node', () => {
  const snapshot = parseSnapshot(readFixture('metrics-parent.json'), ['system.io']);
  assert.equal(Math.round(snapshot.cpu * 10) / 10, 36.3);
  assert.equal(Math.round(snapshot.memory * 10) / 10, 46.8);
  assert.deepEqual(snapshot.load, { min1: 1.85, min5: 1.83, min15: 1.48 });
  assert.equal(snapshot.disk.mount, '/');
  assert.equal(Math.round(snapshot.disk.percent), 79);
  assert.equal(snapshot.temperature, 82);
  assert.equal(snapshot.rx, 0);
  assert.ok(snapshot.uptime > 600_000);
  assert.deepEqual(
    snapshot.extras.map((extra) => [extra.chart, extra.dimension, extra.units]),
    [
      ['system.io', 'reads', 'KiB/s'],
      ['system.io', 'writes', 'KiB/s'],
    ],
  );
  // A node without charts: every value null, nothing invented.
  const empty = parseSnapshot({});
  assert.equal(empty.cpu, null);
  assert.equal(empty.disk, null);
  assert.equal(empty.temperature, null);
});

test('the raised alarms of a real node, and the value of a cleared one', () => {
  const { alarms, latestId } = parseAlarms(readFixture('alarms-child.json'));
  assert.deepEqual(
    alarms.map((alarm) => [alarm.name, alarm.status]),
    [
      ['gladys_test_load', 'warning'],
      ['used_swap', 'warning'],
    ],
  );
  assert.ok(latestId > 0);
  const log = readFixture('alarm-log.json');
  assert.deepEqual(clearedEntry(log, { name: 'gladys_test_flap', chart: 'system.uptime' }), {
    value: 67,
    valueText: '00:01:07',
  });
  assert.equal(clearedEntry(log, { name: 'nope', chart: 'x' }), null);
});

test('the client sends the token as a bearer header and maps the errors', async () => {
  const seen = [];
  const client = new NetdataClient({
    url: 'http://192.0.2.10:19999',
    token: 'abc',
    request: async (url, { headers }) => {
      seen.push([url, headers.authorization]);
      return { status: 503, headers: {}, body: '' };
    },
  });
  await assert.rejects(client.info(), { kind: 'unreachable' });
  assert.deepEqual(seen, [['http://192.0.2.10:19999/api/v1/info', 'Bearer abc']]);
  const tls = new NetdataClient({
    url: 'https://192.0.2.10',
    request: async () => {
      throw Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    },
  });
  await assert.rejects(tls.info(), { kind: 'tls' });
  const redirect = new NetdataClient({
    url: 'http://192.0.2.10',
    request: async () => ({ status: 301, headers: {}, body: '' }),
  });
  await assert.rejects(redirect.info(), { kind: 'redirect' });
});
