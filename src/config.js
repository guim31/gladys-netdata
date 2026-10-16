// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three Netdata agents, each in its own slot. One agent may be a
// Netdata parent: every node it streams from becomes a device. A node is
// identified by its machine GUID, not by the slot: the same node keeps its
// device when it moves from a standalone agent to a parent.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// Port of the Netdata agent web server.
export const DEFAULT_PORT = 19999;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// Extra charts read on every node, at most, and dimensions kept per chart.
export const MAX_EXTRA_CHARTS = 5;
export const MAX_EXTRA_DIMENSIONS = 8;

export const DEFAULT_CONFIG = {
  agent_1_url: '',
  agent_1_token: '',
  agent_2_url: '',
  agent_2_token: '',
  agent_3_url: '',
  agent_3_token: '',
  extra_charts: '',
  poll_interval: '30',
  allow_self_signed: false,
  language: 'fr',
};

// What follows the root of the dashboard in a URL copied from the browser, or
// an API path: the client adds `/api/v1/...` on its own.
const INTERFACE_PATH = /\/(api(\/v\d+)?(\/.*)?|v\d+(\/.*)?|spaces(\/.*)?|index\.html)$/i;

// A chart id as Netdata writes it: `system.io`, `disk_space./mnt/data`, `net.eth0`.
const CHART_ID = /^[A-Za-z0-9_][A-Za-z0-9_.:/@-]{0,199}$/;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 19999 added), `host:port`, or the URL copied from the
 * browser (`http://nas.lan:19999/v3/`). HTTP by default. A path is kept
 * (Netdata behind a reverse proxy sub-path); the dashboard and API paths are
 * dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseAgentUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the messages.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme, no default port). */
export const hostOf = (url) =>
  url.replace(/^https?:\/\//, '').replace(new RegExp(`:${DEFAULT_PORT}(?=/|$)`), '');

/** The extra chart ids typed by the user: comma, semicolon or space separated. */
export function parseCharts(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const charts = [];
  for (const part of raw.split(/[\s,;]+/)) {
    if (CHART_ID.test(part) && !charts.includes(part)) {
      charts.push(part);
    }
  }
  return charts.slice(0, MAX_EXTRA_CHARTS);
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const agents = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(`agent_${slot}_url`);
    if (!typed) {
      continue;
    }
    const url = parseAgentUrl(typed);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    // A pasted token often carries a "Bearer " prefix or a trailing new line.
    const token = text(`agent_${slot}_token`).replace(/^Bearer\s+/i, '');
    agents.push({ slot, url, token });
  }

  return {
    agents,
    invalidSlots: invalid,
    extraCharts: parseCharts(source.extra_charts),
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
