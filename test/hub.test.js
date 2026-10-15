// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the fake
// Netdata agent served from real answers: discovery, states, alarm
// transitions, unreachable nodes, tokens, the widget and the scene actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS } from '../src/hub.js';
import {
  CHILD_GUID,
  FakeNetdata,
  PARENT_GUID,
  URL_1,
  URL_2,
  alarm,
  createClock,
  createDevices,
  createWorld,
  featureId,
  nodeId,
} from './helpers/world.js';
import { TOKEN, readFixture } from './helpers/fakeNetdata.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const lastState = (world, guid, feature) =>
  world.fake.lastState(featureId(world.gladys, guid, feature));

async function started(t, options = {}) {
  const world = await createWorld({ clock: createClock(), ...options });
  t.after(() => world.app.stop());
  return world;
}

test('a parent proposes itself and its child, read with one metrics request each', async (t) => {
  const world = await started(t);
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.external_id),
    [nodeId(world.gladys, PARENT_GUID), nodeId(world.gladys, CHILD_GUID)],
  );
  assert.equal(world.fake.connectionStatus.connected, true);
  const paths = world.netdata.requests.map((path) => path.split('?')[0]);
  assert.deepEqual(paths.sort(), [
    '/api/v1/alarms',
    '/api/v1/allmetrics',
    '/api/v1/info',
    `/host/${CHILD_GUID}/api/v1/alarms`,
    `/host/${CHILD_GUID}/api/v1/allmetrics`,
  ]);
});

test('only the added nodes receive states, all of them once added', async (t) => {
  const world = await started(t);
  assert.equal(world.fake.states.length, 0);
  await createDevices(world, (device) => device.external_id.endsWith(PARENT_GUID));
  assert.equal(lastState(world, PARENT_GUID, 'online'), 1);
  assert.equal(lastState(world, PARENT_GUID, 'temperature'), 82);
  assert.equal(lastState(world, PARENT_GUID, 'alarms_warning'), 2);
  assert.equal(lastState(world, PARENT_GUID, 'disk_free'), 93.4);
  assert.equal(lastState(world, CHILD_GUID, 'online'), undefined);
  // Unchanged values are not sent again; CPU moves, but at most once a minute.
  const count = world.fake.states.length;
  world.netdata.setValue(PARENT_GUID, 'system.cpu', 'user', 80);
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, count);
  world.clock.advance(61_000);
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, count + 1);
  assert.equal(lastState(world, PARENT_GUID, 'cpu'), 87.6);
});

test('the container reads Netdata on its own timer, without onPoll (Gladys 5.2.0)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await started(t, { timers: true });
  const before = world.netdata.requests.length;
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(world.netdata.requests.length > before, 'read again after 30 s');
  assert.equal(world.fake.discoveredDevices[0].should_poll, false);
});

test('an alarm raised, made worse, then back to normal: three scene events', async (t) => {
  const world = await started(t);
  // The alarms found at the first read are the starting point, not events.
  assert.equal(events(world, TRIGGERS.ALARM).length, 0);
  world.netdata.setAlarms(PARENT_GUID, [
    ...Object.values(world.netdata.alarmAnswers[PARENT_GUID].alarms),
    alarm('ram_in_use', 'system.ram', 'warning', 82, '82%'),
  ]);
  await world.hub.pollAll();
  world.netdata.setAlarms(PARENT_GUID, [
    ...Object.values(world.netdata.alarmAnswers[PARENT_GUID].alarms).filter(
      (a) => a.name !== 'ram_in_use',
    ),
    alarm('ram_in_use', 'system.ram', 'critical', 96, '96%'),
  ]);
  await world.hub.pollAll();
  // Back to normal: the value comes from the alarm log.
  world.netdata.alarmLog[PARENT_GUID] = [
    {
      unique_id: 1792108500,
      name: 'ram_in_use',
      chart: 'system.ram',
      status: 'CLEAR',
      old_status: 'CRITICAL',
      value: 61.2,
      value_string: '61.2%',
    },
  ];
  world.netdata.setAlarms(
    PARENT_GUID,
    Object.values(world.netdata.alarmAnswers[PARENT_GUID].alarms).filter(
      (a) => a.name !== 'ram_in_use',
    ),
    1792108500,
  );
  await world.hub.pollAll();
  const fired = events(world, TRIGGERS.ALARM).map((event) => event.data);
  assert.deepEqual(
    fired.map((data) => [data.alarm, data.status, data.value, data.value_text]),
    [
      ['ram_in_use', 'warning', 82, '82%'],
      ['ram_in_use', 'critical', 96, '96%'],
      ['ram_in_use', 'clear', 61.2, '61.2%'],
    ],
  );
  assert.equal(fired[0].node, nodeId(world.gladys, PARENT_GUID));
  assert.equal(fired[0].node_name, 'nd-parent');
  assert.equal(fired[0].status_label, 'Warning');
  assert.equal(fired[2].status_label, 'Back to normal');
});

test('the value of a real alarm log entry is found for a cleared alarm', async (t) => {
  const world = await started(t);
  const log = readFixture('alarm-log.json');
  const flap = log.find((entry) => entry.status === 'WARNING' && entry.name === 'gladys_test_flap');
  world.netdata.setAlarms(PARENT_GUID, [
    alarm('gladys_test_flap', 'system.uptime', 'warning', flap.value, flap.value_string),
  ]);
  await world.hub.pollAll();
  world.netdata.alarmLog[PARENT_GUID] = log;
  world.netdata.setAlarms(PARENT_GUID, [], log[0].unique_id);
  await world.hub.pollAll();
  const cleared = events(world, TRIGGERS.ALARM).filter((event) => event.data.status === 'clear');
  const flapCleared = cleared.find((event) => event.data.alarm === 'gladys_test_flap');
  assert.equal(flapCleared.data.value, 67);
  assert.equal(flapCleared.data.value_text, '00:01:07');
  // No CLEAR entry (Netdata restarting): pending, then back to normal without
  // a value if it stays away ten minutes.
  assert.equal(cleared.length, 1);
  world.clock.advance(5 * 60_000);
  await world.hub.pollAll();
  assert.equal(events(world, TRIGGERS.ALARM).length, 2); // flap raised, then cleared
  world.clock.advance(5 * 60_000);
  await world.hub.pollAll();
  const late = events(world, TRIGGERS.ALARM).map((event) => [event.data.alarm, event.data.value]);
  assert.deepEqual(late.slice(2).sort(), [
    ['gladys_test_load', null],
    ['used_swap', null],
  ]);
});

test('Netdata restarting: its alarms vanish then come back, without any event', async (t) => {
  const world = await started(t);
  const raised = Object.values(world.netdata.alarmAnswers[PARENT_GUID].alarms);
  world.netdata.setAlarms(PARENT_GUID, [], 1792200000); // REMOVED, UNINITIALIZED in the log
  await world.hub.pollAll();
  world.clock.advance(30_000);
  world.netdata.setAlarms(PARENT_GUID, raised);
  await world.hub.pollAll();
  assert.deepEqual(events(world, TRIGGERS.ALARM), []);
});

test('a restart neither misses nor repeats an alarm transition', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  first.netdata.setAlarms(PARENT_GUID, [alarm('ram_in_use', 'system.ram', 'warning', 82)]);
  await first.hub.pollAll();
  // ram raised; the two others vanished without a CLEAR: pending, silent.
  assert.equal(events(first, TRIGGERS.ALARM).length, 1);
  await first.app.stop();

  const netdata = first.netdata;
  netdata.setAlarms(PARENT_GUID, [
    alarm('ram_in_use', 'system.ram', 'warning', 83),
    alarm('disk_space_usage', 'disk_space./', 'critical', 97),
  ]);
  const second = await createWorld({ clock, agents: { [URL_1]: netdata }, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    events(second, TRIGGERS.ALARM).map((event) => [event.data.alarm, event.data.status]),
    [['disk_space_usage', 'critical']],
  );
});

test('an agent down: its nodes go offline, then unreachable after two reads', async (t) => {
  const world = await started(t);
  await createDevices(world);
  world.netdata.failure = 'down';
  await world.hub.pollAll();
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 0);
  assert.equal(lastState(world, PARENT_GUID, 'online'), 1);
  await world.hub.pollAll();
  assert.deepEqual(
    events(world, TRIGGERS.UNREACHABLE).map((event) => event.data.node_name),
    ['nd-parent', 'nd-child'],
  );
  assert.equal(
    events(world, TRIGGERS.UNREACHABLE)[0].data.error,
    'does not answer (is Netdata running?)',
  );
  assert.equal(lastState(world, PARENT_GUID, 'online'), 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: nodeId(world.gladys, CHILD_GUID),
    transport: 'unreachable',
  });
  // Once only, and back online when it answers.
  await world.hub.pollAll();
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 2);
  world.netdata.failure = null;
  await world.hub.pollAll();
  assert.equal(lastState(world, PARENT_GUID, 'online'), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('a child that stops streaming to its parent is unreachable on its own', async (t) => {
  const world = await started(t);
  world.netdata.setReachable(CHILD_GUID, false);
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.deepEqual(
    events(world, TRIGGERS.UNREACHABLE).map((event) => [event.data.node, event.data.error]),
    [[nodeId(world.gladys, CHILD_GUID), 'no longer streams to its Netdata parent']],
  );
  // No request to a child the parent says is gone.
  assert.ok(world.netdata.requests.slice(-3).every((path) => !path.includes(CHILD_GUID)));
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('a token: asked for, refused, accepted', async (t) => {
  const locked = new FakeNetdata({ token: TOKEN });
  const world = await started(t, { agents: { [URL_1]: locked } });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /asks for a token/);
  await world.fake.configUpdated({ agent_1_url: URL_1, agent_1_token: 'wrong', language: 'en' });
  assert.match(world.fake.connectionStatus.message.en, /token refused/);
  await world.fake.configUpdated({
    agent_1_url: URL_1,
    agent_1_token: `Bearer ${TOKEN}`,
    language: 'en',
  });
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.discoveredDevices.length, 2);
});

test('the same node seen through two agents is one device, read once', async (t) => {
  // The child, also configured directly as the second agent.
  const direct = new FakeNetdata({ withChild: false });
  direct.info.mirrored_hosts_status = [{ hostname: 'nd-child', hops: 0, guid: CHILD_GUID }];
  const world = await started(t, {
    agents: { [URL_1]: new FakeNetdata(), [URL_2]: direct },
    config: { agent_1_url: URL_1, agent_2_url: URL_2, language: 'en' },
  });
  assert.equal(world.fake.discoveredDevices.length, 2);
  assert.ok(direct.requests.every((path) => path === '/api/v1/info'));
});

test('an address that is not Netdata says so', async (t) => {
  const world = await started(t);
  world.netdata.failure = 'html';
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.data.message.en, '192.0.2.10: no Netdata agent at this address');
  assert.equal(ack.data.message.fr, '192.0.2.10 : aucun agent Netdata à cette adresse');
});

test('the widget: every node, then one node with its alarms', async (t) => {
  const world = await started(t);
  world.netdata.setAlarms(CHILD_GUID, [alarm('ram_in_use', 'system.ram', 'critical', 96, '96%')]);
  await world.hub.pollAll();
  const all = await world.fake.widgetGet('nodes', { settings: {}, language: 'fr' });
  const status = all.data.content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((row) => [row.label, row.color]),
    [
      ['nd-child', 'danger'],
      ['nd-parent', 'warning'],
    ],
  );
  const one = await world.fake.widgetGet('nodes', {
    settings: { node: nodeId(world.gladys, CHILD_GUID) },
    language: 'en',
  });
  const components = one.data.content.components;
  assert.ok(components.length <= 8);
  assert.deepEqual(
    components.filter((c) => c.type === 'gauge').map((c) => c.label),
    ['CPU', 'Memory', 'Disk'],
  );
  assert.deepEqual(components.find((c) => c.type === 'status').items[0], {
    label: 'ram_in_use',
    value: '96%',
    icon: 'alert-octagon',
    color: 'danger',
  });
  world.netdata.failure = 'down';
  await world.hub.pollAll();
  const offline = await world.fake.widgetGet('nodes', {
    settings: { node: nodeId(world.gladys, CHILD_GUID) },
    language: 'en',
  });
  assert.match(offline.data.content.components[1].text, /does not answer/);
  const refreshed = await world.fake.widgetAction('nodes', 'refresh', {}, { settings: {} });
  assert.equal(refreshed.success, true);
});

test('the scene actions: state of a node, raised alarms, an unknown node', async (t) => {
  const world = await started(t, { config: { agent_1_url: URL_1, language: 'fr' } });
  const state = await world.fake.sceneAction('get_node_status', {
    node: nodeId(world.gladys, PARENT_GUID),
  });
  assert.equal(
    state.data.outputs.summary,
    'nd-parent : processeur 36 %, mémoire 47 %, disque 79 % (93 Go libres), 82 °C, 2 alarme(s)',
  );
  const alarms = await world.fake.sceneAction('get_active_alarms', {});
  assert.equal(alarms.data.outputs.count, 4);
  assert.match(alarms.data.outputs.summary, /^nd-parent : gladys_test_load \(Avertissement, /);
  const unknown = await world.fake.sceneAction('get_node_status', { node: 'ext:other:node:x' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /n'est pas un nœud/);
  world.netdata.setAlarms(PARENT_GUID, []);
  world.netdata.setAlarms(CHILD_GUID, []);
  world.clock.advance(20_000);
  const none = await world.fake.sceneAction('get_active_alarms', {});
  assert.equal(none.data.outputs.summary, 'Aucune alarme levée');
});
