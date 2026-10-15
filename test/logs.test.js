// -----------------------------------------------------------------------------
// The logs the Gladys supervisor keeps: at the info level, only the life
// cycle. A normal reading cycle (reads, states, scene events) writes nothing;
// a failure that repeats at every read writes one line, then one when it heals.
// The SDK logger writes debug/info with console.log, warn/error with
// console.error, at the level of LOG_LEVEL read on every line.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import {
  CHILD_GUID,
  PARENT_GUID,
  alarm,
  createClock,
  createDevices,
  createWorld,
} from './helpers/world.js';

/** The lines written at `LOG_LEVEL=info` from now on, by level. */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function parentWorld(t) {
  const world = await createWorld({ clock: createClock() });
  t.after(() => world.app.stop());
  return world;
}

test('a normal cycle writes nothing: reads, states, scene events', async (t) => {
  const world = await parentWorld(t);
  const lines = captureLogs(t);
  await createDevices(world);
  for (let read = 0; read < 6; read += 1) {
    world.clock.advance(61_000);
    world.netdata.setValue(PARENT_GUID, 'system.cpu', 'user', 10 + read * 7);
    // Raised at odd reads, cleared (with its CLEAR log entry) at even ones.
    const id = 1792200000 + read;
    world.netdata.alarmLog[PARENT_GUID].push({
      unique_id: id,
      name: 'ram_in_use',
      chart: 'system.ram',
      status: read % 2 ? 'WARNING' : 'CLEAR',
      value: 70 + read,
      value_string: `${70 + read}%`,
    });
    world.netdata.setAlarms(
      PARENT_GUID,
      read % 2 ? [alarm('ram_in_use', 'system.ram', 'warning', 85 + read, `${85 + read}%`)] : [],
      id,
    );
    await world.hub.pollAll();
  }
  await world.hub.rediscover();
  assert.ok(world.fake.states.length > 30, 'states published');
  assert.ok(world.fake.sceneEvents.length >= 5, 'scene events fired');
  assert.deepEqual(lines, []);
});

test('Netdata down for several reads: one line, then one when it answers again', async (t) => {
  const world = await parentWorld(t);
  await createDevices(world);
  const lines = captureLogs(t);
  world.netdata.failure = 'down';
  for (let read = 0; read < 5; read += 1) {
    world.clock.advance(61_000);
    await world.hub.pollAll();
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Agent 1 \(192\.0\.2\.10\)/);
  world.netdata.failure = null;
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*Agent 1 \(192\.0\.2\.10\) answers again/);
});

test('a child disconnected from its parent: one line, then one when it is back', async (t) => {
  const world = await parentWorld(t);
  const lines = captureLogs(t);
  world.netdata.setReachable(CHILD_GUID, false);
  for (let read = 0; read < 4; read += 1) {
    world.clock.advance(61_000);
    await world.hub.pollAll();
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*nd-child: no longer streams/);
  world.netdata.setReachable(CHILD_GUID, true);
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*nd-child answers again/);
});

test('Gladys refusing the states for several reads: one line, then one', async (t) => {
  const world = await parentWorld(t);
  await createDevices(world);
  const lines = captureLogs(t);
  const publishStates = world.gladys.publishStates.bind(world.gladys);
  let refuse = true;
  t.mock.method(world.gladys, 'publishStates', async (states) => {
    if (refuse) {
      throw new Error('Gladys is away');
    }
    return publishStates(states);
  });
  for (let read = 0; read < 5; read += 1) {
    world.clock.advance(61_000);
    world.netdata.setValue(PARENT_GUID, 'disk_space./', 'used', 300 + read); // a value to send at every read
    await world.hub.pollAll();
  }
  assert.ok(world.gladys.publishStates.mock.callCount() >= 5);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*States refused: Gladys is away/);
  refuse = false;
  world.clock.advance(61_000);
  await world.hub.pollAll();
  world.clock.advance(61_000);
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*States accepted again/);
});

test('a /data that refuses every write: one line, then one when it works again', async (t) => {
  const lines = captureLogs(t);
  const parent = mkdtempSync(join(tmpdir(), 'gladys-netdata-'));
  const directory = join(parent, 'data');
  writeFileSync(directory, 'a file where the directory should be');
  const store = new Store(directory);
  for (let write = 0; write < 4; write += 1) {
    await store.save({ write });
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Cannot write/);
  unlinkSync(directory);
  await store.save({ write: 4 });
  await store.save({ write: 5 });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*written again/);
});
