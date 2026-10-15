// -----------------------------------------------------------------------------
// The Gladys device of a Netdata node, proposed in the Discovery tab: one per
// node of every configured agent (a parent proposes each of its children).
// The user adds the ones to follow, nothing is created on their behalf.
//
// Identity: the machine GUID of the node, the id Netdata keeps for the life
// of an installation. The same node seen through two agents (directly and
// through its parent) is one device.
//
// Category/type couples come from the core table (see
// test/gladys-rules.test.js). Usage percentages are
// `level-sensor/liquid-level-percent` (a fill level, the couple Glances,
// OctoPrint and Brother already use), which gives the gauge a 0-100 range.
// Load averages and the extra charts have no category: `unknown/unknown`.
//
// Published with should_poll: false: the integration reads Netdata on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'node';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  CPU: 'cpu',
  MEMORY: 'memory',
  LOAD_1: 'load_1',
  LOAD_5: 'load_5',
  LOAD_15: 'load_15',
  DISK_USED: 'disk_used',
  DISK_FREE: 'disk_free',
  RX: 'rx',
  TX: 'tx',
  TEMPERATURE: 'temperature',
  UPTIME: 'uptime',
  ALARMS_WARNING: 'alarms_warning',
  ALARMS_CRITICAL: 'alarms_critical',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'CPU',
    [K.MEMORY]: 'Memory',
    [K.LOAD_1]: 'Load (1 min)',
    [K.LOAD_5]: 'Load (5 min)',
    [K.LOAD_15]: 'Load (15 min)',
    [K.DISK_USED]: 'Main disk used',
    [K.DISK_FREE]: 'Main disk free',
    [K.RX]: 'Download',
    [K.TX]: 'Upload',
    [K.TEMPERATURE]: 'Highest temperature',
    [K.UPTIME]: 'Uptime',
    [K.ALARMS_WARNING]: 'Warning alarms',
    [K.ALARMS_CRITICAL]: 'Critical alarms',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.CPU]: 'Processeur',
    [K.MEMORY]: 'Mémoire',
    [K.LOAD_1]: 'Charge (1 min)',
    [K.LOAD_5]: 'Charge (5 min)',
    [K.LOAD_15]: 'Charge (15 min)',
    [K.DISK_USED]: 'Disque principal utilisé',
    [K.DISK_FREE]: 'Disque principal libre',
    [K.RX]: 'Réception',
    [K.TX]: 'Émission',
    [K.TEMPERATURE]: 'Température la plus haute',
    [K.UPTIME]: 'Durée de fonctionnement',
    [K.ALARMS_WARNING]: 'Alarmes en avertissement',
    [K.ALARMS_CRITICAL]: 'Alarmes critiques',
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'Prozessor',
    [K.MEMORY]: 'Arbeitsspeicher',
    [K.LOAD_1]: 'Last (1 Min.)',
    [K.LOAD_5]: 'Last (5 Min.)',
    [K.LOAD_15]: 'Last (15 Min.)',
    [K.DISK_USED]: 'Hauptdatenträger belegt',
    [K.DISK_FREE]: 'Hauptdatenträger frei',
    [K.RX]: 'Empfang',
    [K.TX]: 'Senden',
    [K.TEMPERATURE]: 'Höchste Temperatur',
    [K.UPTIME]: 'Laufzeit',
    [K.ALARMS_WARNING]: 'Warnende Alarme',
    [K.ALARMS_CRITICAL]: 'Kritische Alarme',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.CPU]: 'Procesador',
    [K.MEMORY]: 'Memoria',
    [K.LOAD_1]: 'Carga (1 min)',
    [K.LOAD_5]: 'Carga (5 min)',
    [K.LOAD_15]: 'Carga (15 min)',
    [K.DISK_USED]: 'Disco principal usado',
    [K.DISK_FREE]: 'Disco principal libre',
    [K.RX]: 'Recepción',
    [K.TX]: 'Envío',
    [K.TEMPERATURE]: 'Temperatura más alta',
    [K.UPTIME]: 'Tiempo en marcha',
    [K.ALARMS_WARNING]: 'Alarmas de advertencia',
    [K.ALARMS_CRITICAL]: 'Alarmas críticas',
  },
};

export const MODEL = 'Netdata';

// Display bounds (the core never applies them on write). Fixed: a bound that
// moves changes the device structure ("Update" in the Discovery tab).
export const BOUNDS = Object.freeze({
  LOAD_MAX: 1000,
  UPTIME_MAX_DAYS: 36500,
  ALARMS_MAX: 1000,
  TEMPERATURE: [-40, 150],
  RATE_MAX_MBPS: 100000,
  DISK_FREE_MAX_GB: 1000000,
  // An extra chart can be anything: bytes, packets, a signed rate.
  EXTRA: 1e12,
});

/** The feature key of a dimension of an extra chart: a hash, chart ids hold any character. */
export const extraKey = (chart, dimension) =>
  `chart_${createHash('sha1').update(`${chart}\u0000${dimension}`).digest('hex').slice(0, 12)}`;

/** External ids of the device of a node. */
export const deviceIds = (gladys, guid) => gladys.externalIds(DEVICE_TYPE, guid);

/** The node GUID of a device external id, null when not ours. */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const guid = externalId.slice(prefix.length);
  return /^[0-9a-f-]{36}$/.test(guid) ? guid : null;
}

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// Feature shapes. `noisy`: moves at every read, published at most once a
// minute (src/hub.js) to stay far below the 300 states per minute of Gladys.
const percent = () => ({
  definition: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  digits: 1,
});
const load = () => ({
  definition: {
    category: CATEGORY.UNKNOWN,
    type: TYPE.UNKNOWN.UNKNOWN,
    min: 0,
    max: BOUNDS.LOAD_MAX,
  },
  digits: 2,
  noisy: true,
});
const rate = () => ({
  definition: {
    category: CATEGORY.DATARATE,
    type: TYPE.DATARATE.RATE,
    unit: UNIT.MEGABITS_PER_SECOND,
    min: 0,
    max: BOUNDS.RATE_MAX_MBPS,
  },
  digits: 2,
  noisy: true,
});
const counter = () => ({
  definition: {
    category: CATEGORY.COUNTER_SENSOR,
    type: TYPE.SENSOR.INTEGER,
    min: 0,
    max: BOUNDS.ALARMS_MAX,
  },
  digits: 0,
});

/**
 * The features of a node device. `item` is `{ snapshot, alarms, online }`
 * (src/hub.js); `when` tells whether the node has the feature at all.
 */
const BLUEPRINT = [
  {
    key: K.ONLINE,
    definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
    digits: 0,
    value: (item) => (item.online ? 1 : 0),
  },
  { key: K.CPU, ...percent(), noisy: true, value: (item) => item.snapshot?.cpu },
  { key: K.MEMORY, ...percent(), noisy: true, value: (item) => item.snapshot?.memory },
  { key: K.LOAD_1, ...load(), value: (item) => item.snapshot?.load?.min1 },
  { key: K.LOAD_5, ...load(), value: (item) => item.snapshot?.load?.min5 },
  { key: K.LOAD_15, ...load(), value: (item) => item.snapshot?.load?.min15 },
  {
    key: K.DISK_USED,
    ...percent(),
    when: (item) => Boolean(item.snapshot?.disk),
    value: (item) => item.snapshot?.disk?.percent,
  },
  {
    key: K.DISK_FREE,
    definition: {
      category: CATEGORY.DATA,
      type: TYPE.DATA.SIZE,
      unit: UNIT.GIGABYTE,
      min: 0,
      max: BOUNDS.DISK_FREE_MAX_GB,
    },
    digits: 1,
    when: (item) => Boolean(item.snapshot?.disk),
    value: (item) => item.snapshot?.disk?.freeGb,
  },
  { key: K.RX, ...rate(), value: (item) => item.snapshot?.rx },
  { key: K.TX, ...rate(), value: (item) => item.snapshot?.tx },
  {
    key: K.TEMPERATURE,
    definition: {
      category: CATEGORY.DEVICE_TEMPERATURE_SENSOR,
      type: TYPE.SENSOR.DECIMAL,
      unit: UNIT.CELSIUS,
      min: BOUNDS.TEMPERATURE[0],
      max: BOUNDS.TEMPERATURE[1],
    },
    digits: 1,
    noisy: true,
    when: (item) => item.snapshot?.temperature !== null && item.snapshot?.temperature !== undefined,
    value: (item) => item.snapshot?.temperature,
  },
  {
    key: K.UPTIME,
    definition: {
      category: CATEGORY.DURATION,
      type: TYPE.DURATION.DECIMAL,
      unit: UNIT.DAYS,
      min: 0,
      max: BOUNDS.UPTIME_MAX_DAYS,
    },
    // Hundredths of a day (about 15 minutes): it moves at that pace.
    digits: 2,
    value: (item) =>
      item.snapshot?.uptime === null || item.snapshot?.uptime === undefined
        ? null
        : item.snapshot.uptime / 86400,
  },
  {
    key: K.ALARMS_WARNING,
    ...counter(),
    value: (item) => item.alarms?.filter((alarm) => alarm.status === 'warning').length,
  },
  {
    key: K.ALARMS_CRITICAL,
    ...counter(),
    value: (item) => item.alarms?.filter((alarm) => alarm.status === 'critical').length,
  },
];

/** The features of the extra charts the node has. */
function extraFeatures(item) {
  return (item.snapshot?.extras ?? []).map((extra) => ({
    key: extraKey(extra.chart, extra.dimension),
    name: `${extra.chart} ${extra.dimension}${extra.units ? ` (${extra.units})` : ''}`.slice(
      0,
      100,
    ),
    definition: {
      category: CATEGORY.UNKNOWN,
      type: TYPE.UNKNOWN.UNKNOWN,
      min: -BOUNDS.EXTRA,
      max: BOUNDS.EXTRA,
    },
    digits: 2,
    noisy: true,
    value: () => extra.value,
  }));
}

const present = (feature, item) => !feature.when || feature.when(item);

const featuresOf = (item) => [
  ...BLUEPRINT.filter((feature) => present(feature, item)),
  ...extraFeatures(item),
];

/**
 * The discovery payload of a node device.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {string} options.guid machine GUID of the node
 * @param {string} options.name device name
 * @param {object} options.item { snapshot, alarms, online }
 * @param {string} [options.language] feature names language
 */
export function buildDevice(gladys, { guid, name, item, language = 'en' }) {
  const ids = deviceIds(gladys, guid);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    features: featuresOf(item).map((feature) => ({
      name: feature.name ?? names[feature.key],
      external_id: ids.feature(feature.key),
      ...feature.definition,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    })),
  };
}

/**
 * The value of every feature of a node (null: nothing to publish).
 * @returns {Array<{ externalId: string, value: number|null, noisy: boolean }>}
 */
export function featureValues(gladys, { guid, item }) {
  const ids = deviceIds(gladys, guid);
  return featuresOf(item).map((feature) => ({
    externalId: ids.feature(feature.key),
    value: round(feature.value(item), feature.digits),
    noisy: Boolean(feature.noisy),
  }));
}
