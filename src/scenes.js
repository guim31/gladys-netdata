// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is the CPU above 80 %?" is already a scene condition on the device
// features. The actions do what a condition cannot: put the state of a node
// or the list of raised alarms in a message ("nas: CPU 12 %, memory 45 %,
// disk 78 %, 1 alarm(s)…"). They read Netdata again when the last read is
// older than 15 seconds. An unreachable node is an answer, not a failure:
// `online` false, and the summary says so — the scene can still send it.
// -----------------------------------------------------------------------------

import {
  ACTION_TEXT,
  ALARM_STATUS_TEXT,
  ERROR_TEXT,
  SUMMARY_TEXT,
  formatCelsius,
  formatGigabytes,
  formatPercent,
  labelled,
  pick,
} from './texts.js';

// Alarms listed in a summary, at most (the rest is counted).
export const MAX_LISTED_ALARMS = 10;

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The one-line state of a node, in the configured language. */
export function summarize(view, language) {
  const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
  if (!view.online) {
    const reason = view.error ? pick(ERROR_TEXT[view.error], language) : text.unreachable;
    return labelled(view.name, reason, language);
  }
  const { snapshot } = view;
  const parts = [];
  if (snapshot.cpu !== null) {
    parts.push(`${text.cpu} ${formatPercent(snapshot.cpu, language)}`);
  }
  if (snapshot.memory !== null) {
    parts.push(`${text.memory} ${formatPercent(snapshot.memory, language)}`);
  }
  if (snapshot.disk) {
    const free = text.free(formatGigabytes(snapshot.disk.freeGb, language));
    parts.push(`${text.disk} ${formatPercent(snapshot.disk.percent, language)} (${free})`);
  }
  if (snapshot.temperature !== null) {
    parts.push(formatCelsius(snapshot.temperature, language));
  }
  parts.push(view.alarms.length ? text.alarms(view.alarms.length) : text.noAlarm);
  return labelled(view.name, parts.join(', '), language);
}

/** "ram_in_use (Warning, 92%)": one raised alarm, in words. */
const alarmText = (alarm, language) => {
  const status = pick(ALARM_STATUS_TEXT[alarm.status], language);
  return `${alarm.name} (${alarm.valueText ? `${status}, ${alarm.valueText}` : status})`;
};

export const SCENE_ACTIONS = {
  async get_node_status(hub, { fields = {} }) {
    hub.assertReadable();
    const language = hub.config.language;
    const found = hub.find(fields.node);
    if (!found) {
      throw new Error(pick(ACTION_TEXT.unknownNode, language));
    }
    const record = hub.records.get(found.slot);
    await hub.refreshIfStale(record ? [record] : []);
    // Read again: the node may have moved meanwhile.
    const view = hub.view(hub.find(fields.node) ?? found);
    const outputs = { name: view.name, online: view.online, summary: summarize(view, language) };
    if (!view.online) {
      return outputs;
    }
    const { snapshot } = view;
    const set = (key, value, digits = 1) => {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        outputs[key] = round(value, digits);
      }
    };
    set('cpu', snapshot.cpu);
    set('memory', snapshot.memory);
    set('load_1', snapshot.load?.min1, 2);
    set('load_5', snapshot.load?.min5, 2);
    set('load_15', snapshot.load?.min15, 2);
    set('disk_percent', snapshot.disk?.percent);
    set('disk_free_gb', snapshot.disk?.freeGb);
    set('rx_mbps', snapshot.rx, 2);
    set('tx_mbps', snapshot.tx, 2);
    set('temperature', snapshot.temperature);
    set('uptime_days', snapshot.uptime === null ? null : snapshot.uptime / 86400, 2);
    outputs.alarms_warning = view.alarms.filter((alarm) => alarm.status === 'warning').length;
    outputs.alarms_critical = view.alarms.filter((alarm) => alarm.status === 'critical').length;
    return outputs;
  },

  async get_active_alarms(hub, { fields = {} }) {
    hub.assertReadable();
    const language = hub.config.language;
    const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
    let nodes;
    if (fields.node) {
      const found = hub.find(fields.node);
      if (!found) {
        throw new Error(pick(ACTION_TEXT.unknownNode, language));
      }
      const record = hub.records.get(found.slot);
      await hub.refreshIfStale(record ? [record] : []);
      nodes = [hub.find(fields.node) ?? found];
    } else {
      await hub.refreshIfStale();
      nodes = hub.nodeList();
    }
    const raised = [];
    const lines = [];
    for (const node of nodes) {
      const view = hub.view(node);
      if (!view.online) {
        if (fields.node) {
          lines.push(summarize(view, language));
        }
        continue;
      }
      raised.push(...view.alarms);
      if (view.alarms.length) {
        const listed = view.alarms.slice(0, MAX_LISTED_ALARMS).map((a) => alarmText(a, language));
        const more = view.alarms.length - listed.length;
        lines.push(
          labelled(view.name, `${listed.join(', ')}${more > 0 ? `, +${more}` : ''}`, language),
        );
      }
    }
    const critical = raised.filter((alarm) => alarm.status === 'critical').length;
    return {
      count: raised.length,
      warning: raised.length - critical,
      critical,
      summary: lines.length
        ? lines.join('\n')
        : `${text.noAlarm[0].toUpperCase()}${text.noAlarm.slice(1)}`,
    };
  },
};
