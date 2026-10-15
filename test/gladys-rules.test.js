// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of a Netdata v2.12.1 parent and its child (with and without the
// extra charts, with and without temperature sensors), in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHILD_GUID, FakeNetdata, URL_1, URL_2, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

// A parent with its child, and a second standalone agent whose node has no
// temperature sensor (a VM) and another identity.
function agents() {
  const vm = new FakeNetdata({ withChild: false });
  const host = vm.info.mirrored_hosts_status[0];
  host.guid = '0c3a6f1e-5b2d-4c8a-9e7f-1a2b3c4d5e03';
  host.hostname = 'vm';
  const metrics = vm.metrics['0c3a6f1e-5b2d-4c8a-9e7f-1a2b3c4d5e01'];
  for (const id of Object.keys(metrics).filter((key) => key.startsWith('sensors.'))) {
    delete metrics[id];
  }
  vm.metrics[host.guid] = metrics;
  vm.alarmAnswers[host.guid] = vm.alarmAnswers['0c3a6f1e-5b2d-4c8a-9e7f-1a2b3c4d5e01'];
  return { [URL_1]: new FakeNetdata(), [URL_2]: vm };
}

async function discover(language, extraCharts) {
  const world = await createWorld({
    agents: agents(),
    config: {
      agent_1_url: URL_1,
      agent_2_url: URL_2,
      extra_charts: extraCharts,
      language,
    },
  });
  await world.app.stop();
  return world.fake.discoveredDevices;
}

const scenarios = [
  {
    label: 'English names, extra charts',
    language: 'en',
    extra: 'system.io, sensors.temperature_histogram',
  },
  { label: 'French names', language: 'fr', extra: '' },
  { label: 'German names, extra charts', language: 'de', extra: 'system.io' },
  { label: 'Spanish names', language: 'es', extra: '' },
];

test('the fixtures cover a parent, its child and a node without sensors', async () => {
  const devices = await discover('en', 'system.io');
  assert.deepEqual(
    devices.map((device) => device.name),
    ['nd-parent', 'nd-child', 'vm'],
  );
  assert.ok(devices[1].external_id.endsWith(CHILD_GUID));
  assert.ok(devices[0].features.some((feature) => feature.external_id.endsWith(':temperature')));
  assert.ok(!devices[2].features.some((feature) => feature.external_id.endsWith(':temperature')));
  assert.ok(devices[0].features.some((feature) => feature.name.startsWith('system.io ')));
});

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const devices = await discover(scenario.language, scenario.extra);
    assert.equal(devices.length, 3, `expected the fixture devices, got ${devices.length}`);
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
