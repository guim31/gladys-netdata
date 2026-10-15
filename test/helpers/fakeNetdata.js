// -----------------------------------------------------------------------------
// An in-memory Netdata agent on a fake network, served from the real answers
// of a Netdata v2.12.1 parent and its child (test/fixtures/netdata/). The
// tests change what it answers (an alarm raised, a child disconnected, the
// agent down) and the integration reads it through the very same client.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const PARENT_GUID = '0c3a6f1e-5b2d-4c8a-9e7f-1a2b3c4d5e01';
export const CHILD_GUID = '0c3a6f1e-5b2d-4c8a-9e7f-1a2b3c4d5e02';
export const TOKEN = 'test-token-not-a-secret';

export const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/netdata/${name}`, import.meta.url), 'utf8'));

const response = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** One alarm as /api/v1/alarms lists it. */
export function alarm(name, chart, status, value, valueText = `${value}`) {
  return {
    id: 1,
    name,
    chart,
    status: status.toUpperCase(),
    value,
    value_string: valueText,
    summary: '',
    info: `${name} on ${chart}`,
    last_status_change: 1792107411,
  };
}

export class FakeNetdata {
  /**
   * @param {object} [options]
   * @param {boolean} [options.withChild] a parent with its child (default)
   * @param {string} [options.token] the bearer token the agent demands
   */
  constructor({ withChild = true, token = '' } = {}) {
    this.token = token;
    this.info = readFixture('info.json');
    if (!withChild) {
      this.info.mirrored_hosts_status = this.info.mirrored_hosts_status.slice(0, 1);
    }
    this.metrics = {
      [PARENT_GUID]: readFixture('metrics-parent.json'),
      [CHILD_GUID]: readFixture('metrics-child.json'),
    };
    this.alarmAnswers = {
      [PARENT_GUID]: readFixture('alarms-parent.json'),
      [CHILD_GUID]: readFixture('alarms-child.json'),
    };
    this.alarmLog = { [PARENT_GUID]: [], [CHILD_GUID]: [] };
    /** null, 'down', 'html', 'proxy' */
    this.failure = null;
    this.requests = [];
  }

  /** Replace the raised alarms of a node. */
  setAlarms(guid, alarms, latestId = null) {
    const answer = this.alarmAnswers[guid];
    answer.alarms = Object.fromEntries(alarms.map((a) => [`${a.chart}.${a.name}`, a]));
    if (latestId !== null) {
      answer.latest_alarm_log_unique_id = latestId;
    }
  }

  /** Set one dimension of a chart of a node. */
  setValue(guid, chart, dimension, value) {
    this.metrics[guid][chart].dimensions[dimension].value = value;
  }

  setReachable(guid, reachable) {
    const host = this.info.mirrored_hosts_status.find((entry) => entry.guid === guid);
    host.reachable = reachable;
  }

  handle(path, headers) {
    this.requests.push(path);
    if (this.failure === 'down') {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.failure === 'html') {
      return response(200, '<html>Login</html>');
    }
    if (this.failure === 'proxy') {
      return response(502, 'Bad gateway');
    }
    if (this.token && headers.authorization !== `Bearer ${this.token}`) {
      return response(401, 'Unauthorized');
    }
    const url = new URL(path, 'http://netdata');
    let guid = PARENT_GUID;
    let rest = url.pathname;
    const host = rest.match(/^\/host\/([^/]+)(\/.*)$/);
    if (host) {
      guid = decodeURIComponent(host[1]);
      rest = host[2];
      const known = this.info.mirrored_hosts_status.some((entry) => entry.guid === guid);
      if (!known || guid === PARENT_GUID) {
        return response(404, `This netdata does not maintain a database for host: ${guid}`);
      }
    }
    switch (rest) {
      case '/api/v1/info':
        return response(200, this.info);
      case '/api/v1/allmetrics': {
        const patterns = (url.searchParams.get('filter') ?? '*')
          .split(' ')
          .map(
            (pattern) =>
              new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`),
          );
        const all = this.metrics[guid];
        return response(
          200,
          Object.fromEntries(
            Object.entries(all).filter(([id]) => patterns.some((pattern) => pattern.test(id))),
          ),
        );
      }
      case '/api/v1/alarms':
        return response(200, this.alarmAnswers[guid]);
      case '/api/v1/alarm_log': {
        const after = Number(url.searchParams.get('after') ?? 0);
        return response(
          200,
          this.alarmLog[guid].filter((entry) => entry.unique_id > after),
        );
      }
      default:
        return response(404, 'Not found');
    }
  }
}

/**
 * A fake network: each base URL answered by a FakeNetdata, the others refused.
 * @param {Record<string, FakeNetdata>} agents
 */
export function createNetwork(agents) {
  return {
    async request(url, { headers = {} } = {}) {
      for (const [base, agent] of Object.entries(agents)) {
        if (url.startsWith(`${base}/`)) {
          return agent.handle(url.slice(base.length), headers);
        }
      }
      const error = new Error('connect EHOSTUNREACH');
      error.code = 'EHOSTUNREACH';
      throw error;
    },
  };
}
