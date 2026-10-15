// -----------------------------------------------------------------------------
// Netdata client: the REST API v1 of the Netdata agent (port 19999), the one
// every agent serves, standalone or parent, from v1.x to v2.x:
//
//   /api/v1/info              version, and the nodes the agent holds (itself,
//                             plus every child when it is a parent), with
//                             whether each child is connected
//   /api/v1/allmetrics        the latest value of every dimension of the
//                             charts matched by `filter`: ONE request reads
//                             CPU, memory, load, disks, network, sensors…
//   /api/v1/alarms            the alarms raised now (warning and critical)
//   /api/v1/alarm_log?after=  the alarm transitions since an entry
//
// A child of a parent is read through the parent with the `/host/<guid>`
// prefix. Read only: nothing here changes the agent.
//
// Authentication: none by default on the local network. An agent behind a
// reverse proxy or with bearer protection takes `Authorization: Bearer`.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, firewall, Netdata stopped
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // the token is refused
  TOKEN_MISSING: 'token_missing', // the agent asks for a token and none is configured
  NOT_NETDATA: 'not_netdata', // something answers, not the API of a Netdata agent
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class NetdataError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'NetdataError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// The charts every node is read for: the families src/netdata/model.js
// understands. `disk_space.*` and `sensors.*` match every mount point and
// every temperature sensor.
export const BASE_CHARTS = Object.freeze([
  'system.cpu',
  'system.ram',
  'system.load',
  'system.uptime',
  'system.net',
  'disk_space.*',
  'sensors.*',
]);

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** The path prefix of a node: none for the agent itself, `/host/<guid>` for a child. */
export const nodePrefix = (node) => (node.local ? '' : `/host/${encodeURIComponent(node.guid)}`);

export class NetdataClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.token] bearer token, '' for none
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token = '', insecure = false, request = httpRequest, timeoutMs = 15_000 }) {
    this.url = url;
    this.token = token;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  headers() {
    const headers = { accept: 'application/json' };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * One GET. Resolves `{ status, data }` for 200 (`data` parsed) and 404
   * (`data` null: a child the parent no longer holds). Throws a NetdataError
   * for everything else.
   */
  async get(path) {
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        headers: this.headers(),
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new NetdataError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      if (err.code === 'ERESPONSETOOLARGE') {
        throw new NetdataError(ERROR_KINDS.HTTP, 'Answer too large');
      }
      throw new NetdataError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }
    const { status } = response;
    if (status === 401 || status === 403) {
      throw this.token
        ? new NetdataError(ERROR_KINDS.AUTH, `Token refused (HTTP ${status})`, { status })
        : new NetdataError(ERROR_KINDS.TOKEN_MISSING, `A token is needed (HTTP ${status})`, {
            status,
          });
    }
    // A reverse proxy in front of a stopped Netdata: silence, like no answer at all.
    if (status === 502 || status === 503 || status === 504) {
      throw new NetdataError(
        ERROR_KINDS.UNREACHABLE,
        `No Netdata behind the proxy (HTTP ${status})`,
        {
          status,
        },
      );
    }
    if (status >= 300 && status < 400) {
      throw new NetdataError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      return { status, data: null };
    }
    if (status !== 200) {
      throw new NetdataError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    try {
      return { status, data: JSON.parse(response.body) };
    } catch {
      // An HTML page: the web interface of another service, a login portal.
      throw new NetdataError(ERROR_KINDS.NOT_NETDATA, 'The answer is not JSON');
    }
  }

  /** `/api/v1/info` of the agent. */
  async info() {
    const { status, data } = await this.get('/api/v1/info');
    if (
      status !== 200 ||
      !data ||
      typeof data !== 'object' ||
      typeof data.version !== 'string' ||
      !(Array.isArray(data.mirrored_hosts_status) || Array.isArray(data.mirrored_hosts))
    ) {
      throw new NetdataError(ERROR_KINDS.NOT_NETDATA, 'No Netdata agent API at this address');
    }
    return data;
  }

  /**
   * The latest values of the charts of a node.
   * @param {{ guid: string, local: boolean }} node
   * @param {string[]} charts chart ids or simple patterns
   * @returns {Promise<object|null>} null when the agent no longer holds the node
   */
  async metrics(node, charts) {
    const filter = encodeURIComponent(charts.join(' '));
    const { data } = await this.get(
      `${nodePrefix(node)}/api/v1/allmetrics?format=json&filter=${filter}`,
    );
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  }

  /** The alarms raised now on a node, null when the agent no longer holds it. */
  async alarms(node) {
    const { data } = await this.get(`${nodePrefix(node)}/api/v1/alarms`);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  }

  /** The alarm transitions of a node after a log entry (newest first). */
  async alarmLog(node, after) {
    const { data } = await this.get(`${nodePrefix(node)}/api/v1/alarm_log?after=${after}`);
    return Array.isArray(data) ? data : [];
  }
}
