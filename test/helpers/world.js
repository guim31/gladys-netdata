// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Netdata agents on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers` is set: the
// tests read the agents with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { deviceIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { CHILD_GUID, FakeNetdata, PARENT_GUID, alarm, createNetwork } from './fakeNetdata.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = 'http://192.0.2.10:19999';
export const URL_2 = 'https://198.51.100.20';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 16, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, FakeNetdata>} [options.agents] by base URL
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  agents,
  config = { agent_1_url: '192.0.2.10', language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-netdata-')),
  timings = {},
  timers = false,
} = {}) {
  const netdata = agents ?? { [URL_1]: new FakeNetdata() };
  const network = createNetwork(netdata);
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    netdata: netdata[URL_1],
    network,
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

export const nodeId = (gladys, guid = PARENT_GUID) => deviceIds(gladys, guid).device;
export const featureId = (gladys, guid, feature) => deviceIds(gladys, guid).feature(feature);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { CHILD_GUID, FakeNetdata, PARENT_GUID, alarm };
