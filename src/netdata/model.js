// -----------------------------------------------------------------------------
// From the raw answers of the Netdata API to plain values: the nodes of an
// agent (/api/v1/info), the snapshot of a node (/api/v1/allmetrics), its
// raised alarms (/api/v1/alarms) and the value of an alarm that cleared
// (alarm_log).
// Every value is a finite number or null: a chart a node does not have
// (no sensors in a VM, no swap) is simply absent.
//
// Real answers of Netdata v2.12.1 (parent and child) are in
// test/fixtures/netdata/.
// -----------------------------------------------------------------------------

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Temperatures outside this range are sensor glitches (0, -273, 255…).
const TEMPERATURE_RANGE = [-40, 150];

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * The nodes an agent holds: itself first, then its children (a parent).
 * @returns {Array<{ guid: string, hostname: string, local: boolean, reachable: boolean }>}
 */
export function parseNodes(info) {
  const nodes = [];
  const seen = new Set();
  const add = (guid, hostname, local, reachable) => {
    if (typeof guid !== 'string' || !GUID.test(guid) || seen.has(guid.toLowerCase())) {
      return;
    }
    seen.add(guid.toLowerCase());
    nodes.push({
      guid: guid.toLowerCase(),
      hostname: typeof hostname === 'string' && hostname ? hostname.slice(0, 100) : guid,
      local,
      reachable,
    });
  };
  if (Array.isArray(info?.mirrored_hosts_status)) {
    for (const host of info.mirrored_hosts_status) {
      const local = host?.hops === 0 || host?.guid === info.uid;
      add(host?.guid, host?.hostname, local, local || host?.reachable === true);
    }
  } else {
    // Agents before v1.31 list names only: the agent itself, by its uid.
    add(info?.uid, info?.mirrored_hosts?.[0], true, true);
  }
  return nodes.sort((a, b) => Number(b.local) - Number(a.local));
}

/** The values of a chart by dimension name (and id, when they differ). */
function dimensions(chart) {
  const values = new Map();
  for (const [id, dimension] of Object.entries(chart?.dimensions ?? {})) {
    const value = finite(dimension?.value);
    values.set(typeof dimension?.name === 'string' ? dimension.name : id, value);
  }
  return values;
}

const sum = (values) => {
  const list = values.filter((value) => value !== null);
  return list.length ? list.reduce((a, b) => a + b, 0) : null;
};

const clampPercent = (value) => (value === null ? null : Math.min(100, Math.max(0, value)));

function parseCpu(chart) {
  if (!chart) {
    return null;
  }
  const values = dimensions(chart);
  // allmetrics includes the hidden `idle` dimension: busy is everything else.
  return clampPercent(sum([...values].filter(([name]) => name !== 'idle').map(([, v]) => v)));
}

function parseMemory(chart) {
  const values = dimensions(chart);
  const total = sum([...values.values()]);
  const used = values.get('used') ?? null;
  if (!total || used === null) {
    return null;
  }
  // `used` excludes cache and buffers: what `free` calls used.
  return clampPercent((used / total) * 100);
}

function parseDisks(all) {
  const disks = [];
  for (const [id, chart] of Object.entries(all)) {
    if (!id.startsWith('disk_space.') && chart?.context !== 'disk.space') {
      continue;
    }
    const values = dimensions(chart);
    const used = values.get('used') ?? null;
    const avail = values.get('avail') ?? null;
    if (used === null || avail === null || used + avail <= 0) {
      continue;
    }
    const reserved = values.get('reserved_for_root') ?? 0;
    disks.push({
      mount: typeof chart.family === 'string' && chart.family ? chart.family : id.slice(11),
      // As `df` counts it: the space reserved for root is neither used nor free.
      percent: (used / (used + avail)) * 100,
      freeGb: avail,
      totalGb: used + avail + reserved,
    });
  }
  return disks;
}

/** The root file system, else the largest one. */
export function mainDisk(disks) {
  return (
    disks.find((disk) => disk.mount === '/') ??
    [...disks].sort((a, b) => b.totalGb - a.totalGb)[0] ??
    null
  );
}

function parseTemperature(all) {
  let hottest = null;
  for (const [id, chart] of Object.entries(all)) {
    const units = typeof chart?.units === 'string' ? chart.units : '';
    if (!/celsius|°c/i.test(units) || /histogram|alarm/.test(id)) {
      continue;
    }
    for (const value of dimensions(chart).values()) {
      if (value !== null && value >= TEMPERATURE_RANGE[0] && value <= TEMPERATURE_RANGE[1]) {
        hottest = hottest === null ? value : Math.max(hottest, value);
      }
    }
  }
  return hottest;
}

/**
 * The snapshot of a node.
 * @param {object} all the answer of /api/v1/allmetrics?format=json
 * @param {string[]} extraCharts the chart ids of the configuration
 * @param {number} maxDimensions dimensions kept per extra chart
 */
export function parseSnapshot(all, extraCharts = [], maxDimensions = 8) {
  const load = dimensions(all['system.load']);
  const net = dimensions(all['system.net']);
  const ram = all['system.ram'];
  const uptime = dimensions(all['system.uptime']).get('uptime') ?? null;
  const disks = parseDisks(all);
  const mbps = (name) => {
    const value = net.get(name) ?? null;
    // kilobits/s; `sent` is stored negative (drawn below the axis).
    return value === null ? null : Math.abs(value) / 1000;
  };
  const extras = [];
  for (const chartId of extraCharts) {
    const chart = all[chartId];
    if (!chart) {
      continue;
    }
    const units = typeof chart.units === 'string' ? chart.units.slice(0, 30) : '';
    for (const [name, value] of [...dimensions(chart)].slice(0, maxDimensions)) {
      extras.push({ chart: chartId, dimension: name, units, value });
    }
  }
  return {
    cpu: parseCpu(all['system.cpu']),
    memory: ram ? parseMemory(ram) : null,
    load: all['system.load']
      ? {
          min1: load.get('load1') ?? null,
          min5: load.get('load5') ?? null,
          min15: load.get('load15') ?? null,
        }
      : null,
    uptime: uptime !== null && uptime >= 0 ? uptime : null,
    rx: all['system.net'] ? mbps('received') : null,
    tx: all['system.net'] ? mbps('sent') : null,
    disks,
    disk: mainDisk(disks),
    temperature: parseTemperature(all),
    extras,
  };
}

const STATUSES = { WARNING: 'warning', CRITICAL: 'critical' };

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * The alarms raised on a node, critical first.
 * @returns {{ alarms: Array<object>, latestId: number|null, now: number|null }}
 */
export function parseAlarms(data) {
  const alarms = [];
  for (const [key, alarm] of Object.entries(data?.alarms ?? {})) {
    const status = STATUSES[alarm?.status];
    if (status !== 'warning' && status !== 'critical') {
      continue;
    }
    alarms.push({
      key,
      name: text(alarm.name, 200) || key,
      chart: text(alarm.chart, 200),
      status,
      value: finite(alarm.value),
      valueText: text(alarm.value_string, 100),
      info: text(alarm.summary, 300) || text(alarm.info, 300),
      since: finite(alarm.last_status_change),
    });
  }
  alarms.sort(
    (a, b) =>
      Number(b.status === 'critical') - Number(a.status === 'critical') ||
      a.name.localeCompare(b.name),
  );
  return {
    alarms,
    latestId: finite(data?.latest_alarm_log_unique_id),
    now: finite(data?.now),
  };
}

/**
 * The log entry of an alarm that went back to normal, newest first: the
 * value it had then. Null when it was removed instead (Netdata restarted or
 * reloaded its health configuration, the chart disappeared).
 * @param {Array<object>} entries the alarm_log answer
 * @param {{ name: string, chart: string }} alarm
 */
export function clearedEntry(entries, alarm) {
  let found = null;
  for (const entry of entries) {
    if (
      entry?.name === alarm.name &&
      entry?.chart === alarm.chart &&
      entry?.status === 'CLEAR' &&
      (found === null || finite(entry.unique_id) > finite(found.unique_id))
    ) {
      found = entry;
    }
  }
  return found ? { value: finite(found.value), valueText: text(found.value_string, 100) } : null;
}
