// -----------------------------------------------------------------------------
// The Netdata hub: one record per configured agent, one state per node the
// agents hold (a parent holds its children), read on a timer of the
// container (the interval chosen in the configuration). Per read: one
// /api/v1/info per agent, then per node one /api/v1/allmetrics (every chart
// at once) and one /api/v1/alarms; the alarm log only when an alarm cleared,
// for the value it cleared at.
//
// Gladys never polls these devices (should_poll: false): the interval goes
// up to 5 minutes, beyond the fixed list of the core scheduler, and the
// scene events must fire for every node, added to Gladys or not.
//
// The 300 states per minute of Gladys: only the devices added are published,
// only what changed (rounded), the values that move at every read at most
// once a minute, and a budget of 240 states per minute on top. Every value
// is sent again after 6 hours unchanged, before the core marks it outdated.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { BASE_CHARTS, ERROR_KINDS, NetdataClient } from './netdata/client.js';
import { clearedEntry, parseAlarms, parseNodes, parseSnapshot } from './netdata/model.js';
import { MAX_EXTRA_DIMENSIONS, hostOf } from './config.js';
import { buildDevice, deviceIds, featureValues, parseDeviceId } from './devices.js';
import { createIssueLog } from './logs.js';
import {
  ACTION_TEXT,
  ALARM_STATUS_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  NODE_ERRORS,
  REPORT_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'netdata-hub' });

export const WIDGET_KEY = 'nodes';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  ALARM: 'alarm_status_changed',
  UNREACHABLE: 'node_unreachable',
});

export const HUB_TIMINGS = {
  // An agent that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failed reads in a row before a node counts as unreachable (scene event).
  downAfterFailures: 2,
  // The values that move at every read (CPU, load, rates…): at most this often.
  noisyEveryMs: 60_000,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
  // A scene action reads Netdata again when the last read is older.
  freshMs: 15_000,
  // An alarm gone without a CLEAR in the log (Netdata restarting) is back to
  // normal only after this long.
  pendingMs: 10 * 60_000,
  // The alarms remembered for a node not seen for a week are forgotten.
  forgetAfterMs: 7 * 24 * 3600_000,
  // States sent per minute at most, below the 300 of Gladys.
  statesPerMinute: 240,
};

// Nodes read per agent, at most: a parent of a large fleet is out of scope.
export const MAX_NODES_PER_AGENT = 30;

const MAX_STATES_PER_REQUEST = 100;
const MAX_TRANSPORTS_PER_REQUEST = 100;

// Errors that make a node unreachable (scene event); a refused token or an
// unexpected answer is a configuration problem, told by the connection status.
const UNREACHABLE_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  NODE_ERRORS.DISCONNECTED,
  NODE_ERRORS.GONE,
]);

// Failures of a node itself, not of its agent.
const NODE_KINDS = new Set(Object.values(NODE_ERRORS));

const signature = (agent, config) =>
  JSON.stringify([agent.url, agent.token, config.allowSelfSigned]);

export class NetdataHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/netdata/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} agent records, by slot */
    this.records = new Map();
    /** @type {Map<string, object>} node states, by machine GUID */
    this.nodes = new Map();
    /** Alarms raised per node at the last read, persisted: { guid: { alarms, seenAt } }. */
    this.saved = {};
    this.published = new Map();
    this.publishedAt = new Map();
    this.sentTimes = [];
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.stopped = false;
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = saved?.nodes && typeof saved.nodes === 'object' ? saved.nodes : {};
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    const chartsChanged =
      JSON.stringify(this.config?.extraCharts) !== JSON.stringify(config.extraCharts);
    this.config = config;
    const wanted = new Map(config.agents.map((agent) => [agent.slot, agent]));
    for (const [slot, record] of this.records) {
      const agent = wanted.get(slot);
      if (!agent || record.signature !== signature(agent, config)) {
        record.dropped = true;
        clearTimeout(record.retryTimer);
        this.records.delete(slot);
      }
    }
    for (const agent of config.agents) {
      if (!this.records.has(agent.slot)) {
        this.records.set(agent.slot, this.newRecord(agent, config));
      }
    }
    // Nodes of an agent removed or changed: read again from scratch.
    for (const [guid, node] of this.nodes) {
      if (!this.records.has(node.slot)) {
        this.nodes.delete(guid);
      }
    }
    if (languageChanged || chartsChanged) {
      this.discovered = null;
    }
    await this.pollAll({ publish: true });
    this.schedulePoll();
  }

  newRecord(agent, config) {
    return {
      agent,
      signature: signature(agent, config),
      client: new NetdataClient({
        url: agent.url,
        token: agent.token,
        insecure: config.allowSelfSigned,
        request: this.request,
      }),
      version: null,
      nodeCount: 0,
      readAt: 0,
      error: null,
      polling: null,
      retryTimer: null,
      dropped: false,
    };
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Names and identities ----------------------------------------------------

  agentLabel(record) {
    return `Agent ${record.agent.slot} (${hostOf(record.agent.url)})`;
  }

  nodeId(guid) {
    return deviceIds(this.gladys, guid).device;
  }

  /** The GUIDs of the nodes the user added. */
  createdGuids() {
    const guids = new Set();
    for (const device of this.gladys.devices ?? []) {
      const guid = parseDeviceId(this.gladys, device.external_id);
      if (guid) {
        guids.add(guid);
      }
    }
    return guids;
  }

  /** The node of a device external id, null when unknown. */
  find(externalId) {
    const guid = parseDeviceId(this.gladys, externalId);
    return guid ? (this.nodes.get(guid) ?? null) : null;
  }

  isOnline(node) {
    return node.error === null && node.snapshot !== null;
  }

  item(node) {
    return { snapshot: node.snapshot, alarms: node.alarms, online: this.isOnline(node) };
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    return [...this.nodes.values()]
      .filter((node) => node.snapshot !== null)
      .sort((a, b) => a.slot - b.slot || a.order - b.order)
      .map((node) =>
        buildDevice(this.gladys, {
          guid: node.guid,
          name: node.hostname,
          item: this.item(node),
          language: this.config.language,
        }),
      );
  }

  /** Publish the Discovery list when it changed (a node joined, a sensor appeared…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices.map((device) => [device.name, device.features]));
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the agents, publish the list again. */
  async rediscover() {
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const node = this.find(device.external_id);
    if (!node) {
      return;
    }
    this.transports.delete(device.external_id);
    await this.publishNodeStates(node, { force: true });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The user deleted a device: forget what was sent for it. */
  onDeviceDeleted(device) {
    const id = device?.external_id;
    if (typeof id !== 'string') {
      return;
    }
    this.transports.delete(id);
    for (const map of [this.published, this.publishedAt]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${id}:`)) {
          map.delete(key);
        }
      }
    }
  }

  // --- Reading the agents ------------------------------------------------------

  async pollAll({ publish = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record)));
    this.forgetStale();
    await this.afterChanges(changes.some(Boolean), { publish });
  }

  /** Gladys asks for a refresh (onPoll): read that node's agent now. */
  async pollDevice(device) {
    const node = this.find(device.external_id);
    const record = node ? this.records.get(node.slot) : null;
    if (record) {
      await this.afterChanges(await this.poll(record));
    }
  }

  /** Read again the agents whose last read is older than `freshMs` (scene actions). */
  async refreshIfStale(records = [...this.records.values()]) {
    const stale = records.filter((record) => this.now() - record.readAt >= this.timings.freshMs);
    if (stale.length > 0) {
      const changes = await Promise.all(stale.map((record) => this.poll(record)));
      await this.afterChanges(changes.some(Boolean));
    }
  }

  /**
   * Read one agent and its nodes. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    let info;
    try {
      info = await record.client.info();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.agentFailed(record, err);
    }
    if (record.dropped) {
      return false;
    }
    let changed = record.error !== null || record.readAt === 0;
    if (record.error) {
      logger.info(`${this.agentLabel(record)} answers again`);
    }
    if (record.version !== info.version) {
      logger.info(`${this.agentLabel(record)}: Netdata ${info.version}`);
      record.version = info.version;
    }
    record.error = null;
    record.readAt = this.now();

    const listed = parseNodes(info);
    // Another agent with a lower slot already holds the node: one device, read once.
    const mine = listed.filter((entry) => {
      const owner = this.nodes.get(entry.guid)?.slot;
      return owner === undefined || owner === record.agent.slot || !this.records.has(owner)
        ? true
        : owner > record.agent.slot;
    });
    if (mine.length > MAX_NODES_PER_AGENT) {
      this.issues.fail(
        `nodes-${record.agent.slot}`,
        'warn',
        `${this.agentLabel(record)} holds ${mine.length} nodes: the first ${MAX_NODES_PER_AGENT} are read`,
      );
    }
    const kept = mine.slice(0, MAX_NODES_PER_AGENT);
    record.nodeCount = kept.length;
    const keptGuids = new Set(kept.map((entry) => entry.guid));
    // A node this agent no longer lists: gone (a child removed from the parent).
    for (const node of this.nodes.values()) {
      if (node.slot === record.agent.slot && !keptGuids.has(node.guid)) {
        changed = (await this.nodeFailed(node, NODE_ERRORS.GONE)) || changed;
      }
    }
    const results = await Promise.all(
      kept.map((entry, order) => this.readNode(record, entry, order)),
    );
    if (results.some(Boolean)) {
      changed = true;
    }
    this.store.save({ nodes: this.saved });
    return changed;
  }

  nodeState(record, entry, order) {
    let node = this.nodes.get(entry.guid);
    if (!node || node.slot !== record.agent.slot) {
      node = {
        guid: entry.guid,
        slot: record.agent.slot,
        order,
        hostname: entry.hostname,
        local: entry.local,
        snapshot: null,
        alarms: [],
        latestId: null,
        error: null,
        failures: 0,
        down: false,
        readAt: 0,
      };
      this.nodes.set(entry.guid, node);
    }
    node.order = order;
    node.hostname = entry.hostname;
    node.local = entry.local;
    return node;
  }

  async readNode(record, entry, order) {
    const node = this.nodeState(record, entry, order);
    if (!entry.reachable) {
      return this.nodeFailed(node, NODE_ERRORS.DISCONNECTED);
    }
    let metrics;
    let alarms;
    try {
      [metrics, alarms] = await Promise.all([
        record.client.metrics(node, [...BASE_CHARTS, ...this.config.extraCharts]),
        record.client.alarms(node),
      ]);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.nodeFailed(node, err.kind);
    }
    if (record.dropped) {
      return false;
    }
    if (!metrics || !alarms) {
      return this.nodeFailed(node, NODE_ERRORS.GONE);
    }
    let changed = node.error !== null || node.readAt === 0;
    if (NODE_KINDS.has(node.error)) {
      logger.info(`${node.hostname} answers again`);
    }
    const parsed = parseAlarms(alarms);
    const previousLatestId = node.latestId;
    node.snapshot = parseSnapshot(metrics, this.config.extraCharts, MAX_EXTRA_DIMENSIONS);
    node.alarms = parsed.alarms;
    node.latestId = parsed.latestId;
    node.error = null;
    node.failures = 0;
    node.down = false;
    node.readAt = this.now();
    if (await this.compareAlarms(record, node, previousLatestId)) {
      changed = true;
    }
    await this.publishNodeStates(node);
    return changed;
  }

  /**
   * Fire the alarm transitions since the last read: raised, worse or better,
   * back to normal. A node read for the first time (no memory in /data) only
   * records its alarms.
   *
   * An alarm missing from the raised list is back to normal only when the
   * alarm log says CLEAR. Otherwise Netdata restarted or reloaded its health
   * configuration (every alarm REMOVED, then raised again a few seconds
   * later): the alarm is kept pending, silently, and only announced back to
   * normal, without a value, if it stays away for `pendingMs`.
   */
  async compareAlarms(record, node, previousLatestId) {
    const before = this.saved[node.guid]?.alarms;
    const now = Object.fromEntries(
      node.alarms.map((alarm) => [
        alarm.key,
        { status: alarm.status, name: alarm.name, chart: alarm.chart },
      ]),
    );
    if (!before) {
      this.saved[node.guid] = { alarms: now, seenAt: this.now() };
      return node.alarms.length > 0;
    }
    let changed = false;
    for (const alarm of node.alarms) {
      if (before[alarm.key]?.status === alarm.status) {
        continue;
      }
      changed = true;
      logger.debug(`${node.hostname}: alarm ${alarm.name} ${alarm.status}`);
      await this.fireAlarm(node, alarm, alarm.status);
    }
    const missing = Object.entries(before).filter(([key]) => !(key in now));
    let log = [];
    if (missing.length > 0 && previousLatestId !== null && node.latestId !== previousLatestId) {
      try {
        log = await record.client.alarmLog(node, previousLatestId);
      } catch (err) {
        logger.debug(`${node.hostname}: alarm log unavailable (${err.message})`);
      }
    }
    for (const [key, alarm] of missing) {
      const entry = clearedEntry(log, alarm);
      const missingSince = alarm.missingSince ?? this.now();
      if (!entry && this.now() - missingSince < this.timings.pendingMs) {
        now[key] = { ...alarm, missingSince };
        continue;
      }
      changed = true;
      logger.debug(`${node.hostname}: alarm ${alarm.name} back to normal`);
      await this.fireAlarm(
        node,
        {
          name: alarm.name,
          chart: alarm.chart,
          value: entry?.value ?? null,
          valueText: entry?.valueText ?? '',
          info: '',
        },
        'clear',
      );
    }
    this.saved[node.guid] = { alarms: now, seenAt: this.now() };
    return changed;
  }

  async fireAlarm(node, alarm, status) {
    await this.fireEvent(TRIGGERS.ALARM, {
      node: this.nodeId(node.guid),
      status,
      alarm: alarm.name,
      node_name: node.hostname,
      alarm_name: alarm.name,
      chart: alarm.chart,
      status_label: pick(ALARM_STATUS_TEXT[status], this.config.language),
      value: alarm.value,
      value_text: alarm.valueText,
      info: alarm.info,
    });
  }

  async agentFailed(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`${this.agentLabel(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.agentLabel(record)}: ${err.message}`);
    }
    if (err.kind === ERROR_KINDS.UNREACHABLE && !wasError) {
      this.scheduleRetry(record);
    }
    let changed = wasError !== err.kind;
    for (const node of this.nodes.values()) {
      if (node.slot === record.agent.slot) {
        changed = (await this.nodeFailed(node, err.kind)) || changed;
      }
    }
    return changed;
  }

  /** A node not read: offline, and unreachable once it failed twice in a row. */
  async nodeFailed(node, kind) {
    const wasError = node.error;
    node.error = kind;
    node.readAt = this.now();
    // The outage of an agent is logged by the agent; a child logs its own.
    if (wasError !== kind && NODE_KINDS.has(kind)) {
      logger.warn(`${node.hostname}: ${pick(ERROR_TEXT[kind], 'en')}`);
    }
    if (!UNREACHABLE_KINDS.has(kind)) {
      node.failures = 0;
      await this.publishNodeStates(node);
      return wasError !== kind;
    }
    node.failures += 1;
    if (!node.down && node.failures >= this.timings.downAfterFailures) {
      node.down = true;
      await this.fireEvent(TRIGGERS.UNREACHABLE, {
        node: this.nodeId(node.guid),
        node_name: node.hostname,
        error: pick(ERROR_TEXT[kind], this.config.language),
      });
      await this.publishNodeStates(node);
      return true;
    }
    if (node.down) {
      await this.publishNodeStates(node);
    }
    return wasError !== kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  /** Forget the alarms of nodes not seen for a week (a machine retired). */
  forgetStale() {
    let forgotten = false;
    for (const [guid, entry] of Object.entries(this.saved)) {
      if (!this.nodes.has(guid) && this.now() - (entry?.seenAt ?? 0) > this.timings.forgetAfterMs) {
        delete this.saved[guid];
        forgotten = true;
      }
    }
    if (forgotten) {
      this.store.save({ nodes: this.saved });
    }
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  /**
   * The states of a node the user added: every value once read, only
   * "offline" while it is down, nothing before the first read.
   */
  async publishNodeStates(node, { force = false } = {}) {
    if (!this.createdGuids().has(node.guid)) {
      return;
    }
    let values;
    if (this.isOnline(node)) {
      values = featureValues(this.gladys, { guid: node.guid, item: this.item(node) });
    } else if (node.down) {
      values = [{ externalId: deviceIds(this.gladys, node.guid).feature('online'), value: 0 }];
    } else {
      return;
    }
    await this.sendStates(values, { force });
  }

  /** Keep what must be sent now: changed, not too soon, within the budget. */
  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const due = [];
    for (const { externalId, value, noisy } of values) {
      if (value === null) {
        continue;
      }
      const last = this.published.get(externalId);
      const at = this.publishedAt.get(externalId);
      if (!force) {
        if (last === value && at !== undefined && now - at < this.timings.heartbeatMs) {
          continue;
        }
        if (last !== value && noisy && at !== undefined && now - at < this.timings.noisyEveryMs) {
          continue;
        }
      }
      due.push({ externalId, value, noisy });
    }
    this.sentTimes = this.sentTimes.filter((time) => now - time < 60_000);
    let states = due;
    if (!force) {
      const allowed = Math.max(0, this.timings.statesPerMinute - this.sentTimes.length);
      if (due.length > allowed) {
        // The quiet values first (online, alarms, disk); the rest waits.
        states = [...due.filter((s) => !s.noisy), ...due.filter((s) => s.noisy)].slice(0, allowed);
      }
    }
    for (let i = 0; i < states.length; i += 1) {
      this.sentTimes.push(now);
    }
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(
          batch.map(({ externalId, value }) => ({
            device_feature_external_id: externalId,
            state: value,
          })),
        );
        for (const { externalId, value } of batch) {
          this.published.set(externalId, value);
          this.publishedAt.set(externalId, now);
        }
        this.issues.ok('states', 'States accepted again');
      } catch (err) {
        this.issues.fail('states', 'warn', `States refused: ${err.message}`);
        for (let i = 0; i < batch.length; i += 1) {
          const index = this.sentTimes.lastIndexOf(now);
          if (index >= 0) {
            this.sentTimes.splice(index, 1);
          }
        }
      }
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    const created = this.createdGuids();
    const entries = [];
    for (const node of this.nodes.values()) {
      if (!created.has(node.guid) || node.readAt === 0) {
        continue;
      }
      const externalId = this.nodeId(node.guid);
      const transport = this.isOnline(node)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.issues.ok('transports', 'Transports accepted again');
      } catch (err) {
        this.issues.fail('transports', 'warn', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name: connected when every agent answers. */
  connectionStatus() {
    if (!this.config) {
      return { connected: false, message: CONNECTION_TEXT.noAgent };
    }
    const { agents, invalidSlots } = this.config;
    if (agents.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noAgent,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noAgent)) {
      const parts = failing.map((record) =>
        labelled(hostOf(record.agent.url), pick(ERROR_TEXT[record.error.kind], language), language),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) -------------------------------------

  /** Every node, in the order of the agents. */
  nodeList() {
    return [...this.nodes.values()].sort((a, b) => a.slot - b.slot || a.order - b.order);
  }

  /** What the widget and the scene actions show of a node. */
  view(node) {
    return {
      name: node.hostname,
      online: this.isOnline(node),
      error: node.error,
      snapshot: node.snapshot,
      alarms: node.alarms,
    };
  }

  /** "Test the connection": read every agent now, one line each. */
  async testConnection() {
    await this.pollAll({ publish: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const host = hostOf(record.agent.url);
        if (record.error) {
          return labelled(host, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const nodes = this.nodeList().filter((node) => node.slot === record.agent.slot);
        const raised = nodes.reduce((count, node) => count + node.alarms.length, 0);
        return labelled(
          host,
          [
            text.ok,
            `Netdata ${record.version}`,
            text.nodes(record.nodeCount),
            text.alarms(raised),
          ].join(', '),
          language,
        );
      });
      if (this.config?.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** Throws the reason no agent can answer a scene action, if any. */
  assertReadable() {
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noAgent, this.config?.language));
    }
  }
}
