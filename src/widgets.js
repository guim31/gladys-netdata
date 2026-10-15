// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `nodes`.
//
// The use case: a glance at the wall tablet tells whether the machines are
// fine, and which Netdata alarms are raised.
//
//   - No node chosen: every node at once. Three tiles (nodes online, warning
//     and critical alarms), then one row per node, red or orange when it has
//     a raised alarm, with its CPU and memory.
//   - A node chosen (any of its devices: a node is one device): CPU, memory
//     and disk gauges, the hottest sensor, then its raised alarms, critical
//     first, and its load and uptime.
//
// The figures are sent as values, not bound to device features: the widget
// works before any device is added (without a node chosen).
//
// Budget (8 components, 6 tiles, 2 texts, 1 status, 4 buttons): one heading,
// up to five tiles, one status list of eight rows at most, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import {
  ALARM_STATUS_TEXT,
  ERROR_TEXT,
  formatNumber,
  formatPercent,
  formatUptime,
  labelled,
  pick,
} from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 8;

export const TEXT = {
  noNode: {
    en: 'No Netdata node yet: enter the address of an agent in the configuration.',
    fr: "Aucun nœud Netdata pour l'instant : saisissez l'adresse d'un agent dans la configuration.",
    de: 'Noch kein Netdata-Knoten: Gib die Adresse eines Agenten in der Konfiguration ein.',
    es: 'Aún no hay ningún nodo Netdata: introduzca la dirección de un agente en la configuración.',
  },
  gone: {
    en: 'This node is no longer held by a configured Netdata agent.',
    fr: "Ce nœud n'est plus suivi par un agent Netdata configuré.",
    de: 'Dieser Knoten wird von keinem konfigurierten Netdata-Agenten mehr geführt.',
    es: 'Este nodo ya no lo sigue ningún agente Netdata configurado.',
  },
  waiting: {
    en: 'Waiting for the first answer of Netdata…',
    fr: 'En attente de la première réponse de Netdata…',
    de: 'Warte auf die erste Antwort von Netdata …',
    es: 'Esperando la primera respuesta de Netdata…',
  },
  noAlarm: {
    en: 'No alarm raised',
    fr: 'Aucune alarme levée',
    de: 'Kein aktiver Alarm',
    es: 'Ninguna alarma activa',
  },
  title: { en: 'Netdata', fr: 'Netdata', de: 'Netdata', es: 'Netdata' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  warning: { en: 'Warnings', fr: 'Avertissements', de: 'Warnungen', es: 'Advertencias' },
  critical: { en: 'Critical', fr: 'Critiques', de: 'Kritisch', es: 'Críticas' },
  cpu: { en: 'CPU', fr: 'Processeur', de: 'Prozessor', es: 'Procesador' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  disk: { en: 'Disk', fr: 'Disque', de: 'Datenträger', es: 'Disco' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  alarms: { en: 'Alarms', fr: 'Alarmes', de: 'Alarme', es: 'Alarmas' },
  uptime: { en: 'Uptime', fr: 'En marche depuis', de: 'Läuft seit', es: 'En marcha desde' },
  load: { en: 'Load', fr: 'Charge', de: 'Last', es: 'Carga' },
  ram: { en: 'RAM', fr: 'RAM', de: 'RAM', es: 'RAM' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Netdata read again.',
    fr: 'Netdata relu.',
    de: 'Netdata neu gelesen.',
    es: 'Netdata leído de nuevo.',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Danger from 90, warning from 75: what Netdata itself shows in red and orange. */
const usageColor = (value) =>
  value >= 90 ? WIDGET_COLORS.DANGER : value >= 75 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
const temperatureColor = (celsius) =>
  celsius >= 85
    ? WIDGET_COLORS.DANGER
    : celsius >= 70
      ? WIDGET_COLORS.WARNING
      : WIDGET_COLORS.NEUTRAL;
const alarmColor = (alarms) =>
  alarms.some((alarm) => alarm.status === 'critical')
    ? WIDGET_COLORS.DANGER
    : alarms.length
      ? WIDGET_COLORS.WARNING
      : WIDGET_COLORS.SUCCESS;

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

const gauge = (label, value, language) => ({
  type: 'gauge',
  value: Math.round(value),
  min: 0,
  max: 100,
  unit: '%',
  label: t(label, language),
  color: usageColor(value),
});

/** The status list, cut at MAX_ROWS with an "Others +n" row. */
function statusList(rows, language) {
  const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS - 1) : rows;
  if (rows.length > shown.length) {
    shown.push({
      label: t(TEXT.more, language),
      value: `+${rows.length - shown.length}`,
      icon: 'more-horizontal',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return { type: 'status', items: shown };
}

/** Every node: tiles of the totals, one row per node. */
function overview(hub, language) {
  const nodes = hub.nodeList().map((node) => hub.view(node));
  const online = nodes.filter((view) => view.online);
  const alarms = online.flatMap((view) => view.alarms);
  const critical = alarms.filter((alarm) => alarm.status === 'critical').length;
  const rows = [...nodes]
    // The problems first: offline, critical, warning, then the rest.
    .sort((a, b) => rank(b) - rank(a))
    .map((view) => {
      if (!view.online) {
        return {
          label: fit(view.name, 40),
          value: fit(t(TEXT.offline, language), 40),
          icon: 'x-circle',
          color: WIDGET_COLORS.DANGER,
        };
      }
      const { snapshot } = view;
      const figures = [];
      if (snapshot.cpu !== null) {
        figures.push(`${t(TEXT.cpu, language)} ${formatPercent(snapshot.cpu, language)}`);
      }
      if (snapshot.memory !== null) {
        figures.push(`${t(TEXT.ram, language)} ${formatPercent(snapshot.memory, language)}`);
      }
      if (view.alarms.length) {
        figures.push(`⚠ ${view.alarms.length}`);
      }
      return {
        label: fit(view.name, 40),
        value: fit(figures.join(' · ') || t(TEXT.online, language), 40),
        icon: view.alarms.length ? 'alert-triangle' : 'server',
        color: alarmColor(view.alarms),
      };
    });
  const components = [
    { type: 'text', variant: 'heading', text: t(TEXT.title, language) },
    {
      type: 'value',
      value: `${online.length}/${nodes.length}`,
      label: t(TEXT.online, language),
      icon: 'server',
      color: online.length === nodes.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
    {
      type: 'value',
      value: alarms.length - critical,
      label: t(TEXT.warning, language),
      icon: 'alert-triangle',
      color: alarms.length - critical ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: critical,
      label: t(TEXT.critical, language),
      icon: 'alert-octagon',
      color: critical ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (rows.length) {
    components.push(statusList(rows, language));
  }
  components.push(refreshButton(language));
  return { ttl_seconds: 30, components };
}

const rank = (view) =>
  !view.online
    ? 3
    : view.alarms.some((alarm) => alarm.status === 'critical')
      ? 2
      : view.alarms.length
        ? 1
        : 0;

/** One node: gauges, temperature, its alarms and a few rows. */
function nodeComponents(view, language) {
  const { snapshot } = view;
  const components = [];
  if (snapshot.cpu !== null) {
    components.push(gauge(TEXT.cpu, snapshot.cpu, language));
  }
  if (snapshot.memory !== null) {
    components.push(gauge(TEXT.memory, snapshot.memory, language));
  }
  if (snapshot.disk) {
    components.push(gauge(TEXT.disk, snapshot.disk.percent, language));
  }
  if (snapshot.temperature !== null) {
    components.push({
      type: 'value',
      value: Math.round(snapshot.temperature),
      unit: '°C',
      label: t(TEXT.temperature, language),
      icon: 'thermometer',
      color: temperatureColor(snapshot.temperature),
    });
  }
  components.push({
    type: 'value',
    value: view.alarms.length,
    label: t(TEXT.alarms, language),
    icon: 'bell',
    color: alarmColor(view.alarms),
  });

  const rows = view.alarms.map((alarm) => ({
    label: fit(alarm.name, 40),
    value: fit(alarm.valueText || t(ALARM_STATUS_TEXT[alarm.status], language), 40),
    icon: alarm.status === 'critical' ? 'alert-octagon' : 'alert-triangle',
    color: alarm.status === 'critical' ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
  }));
  if (!rows.length) {
    rows.push({
      label: t(TEXT.alarms, language),
      value: t(TEXT.noAlarm, language),
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  if (snapshot.load) {
    const loads = [snapshot.load.min1, snapshot.load.min5, snapshot.load.min15]
      .filter((value) => value !== null)
      .map((value) => formatNumber(value, language, 2));
    if (loads.length) {
      rows.push({
        label: t(TEXT.load, language),
        value: loads.join(' · '),
        icon: 'activity',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  if (snapshot.uptime !== null) {
    rows.push({
      label: t(TEXT.uptime, language),
      value: formatUptime(snapshot.uptime, language),
      icon: 'clock',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push(statusList(rows, language));
  return components;
}

async function get(hub, { settings, language = 'en' }) {
  const chosen = typeof settings?.node === 'string' ? settings.node : '';
  if (!chosen) {
    if (hub.nodes.size === 0) {
      return message(hub.records.size ? TEXT.waiting : TEXT.noNode, language, 30);
    }
    return overview(hub, language);
  }
  const node = hub.find(chosen);
  if (!node) {
    return message(TEXT.gone, language);
  }
  const view = hub.view(node);
  if (!view.online) {
    if (!view.error) {
      return message(TEXT.waiting, language, 30);
    }
    return {
      ttl_seconds: 30,
      components: [
        { type: 'text', variant: 'heading', text: fit(view.name, 40) },
        {
          type: 'text',
          variant: 'body',
          text: labelled(view.name, t(ERROR_TEXT[view.error], language), language),
        },
        refreshButton(language),
      ],
    };
  }
  return {
    ttl_seconds: 30,
    components: [
      { type: 'text', variant: 'heading', text: fit(view.name, 40) },
      ...nodeComponents(view, language),
      refreshButton(language),
    ],
  };
}

async function action(hub, { actionKey, settings }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const node = typeof settings?.node === 'string' ? hub.find(settings.node) : null;
  const record = node ? hub.records.get(node.slot) : null;
  if (record) {
    await hub.afterChanges(await hub.poll(record));
  } else {
    await hub.pollAll();
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
