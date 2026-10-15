# Netdata for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings your [Netdata](https://www.netdata.cloud/) nodes into Gladys: one
device per node, the Netdata alarms as scene triggers, and a dashboard widget.
Point it at a Netdata **parent** and every child streaming to it shows up.
Local only: Netdata Cloud is not needed.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

- **One device per Netdata node** (a standalone agent, or a parent and all its
  children, up to three agents): online, CPU, memory, load averages, main disk
  used and free, download and upload rates, highest temperature, uptime, and
  the number of warning and critical alarms raised.
- **Extra charts** chosen by id in the configuration (`system.io, mem.swap`…):
  one feature per dimension.
- **Scene triggers**: a Netdata alarm raised to warning or critical, or back to
  normal (filters: node, state, alarm name; variables: node, alarm, chart,
  state, value, description); a node unreachable (the agent silent, or a child
  that stopped streaming to its parent).
- **Scene actions**: the state of a node (every figure, and a ready-made
  summary to send); the raised alarms of one node or of all of them.
- **Dashboard widget**: every node and its alarms at a glance, or the gauges,
  temperature and alarms of one node.
- Optional bearer token, self-signed certificates, refresh every 30 seconds to
  5 minutes, texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- A Netdata agent (v1.31 or later, v2 recommended), or a Netdata parent,
  reachable from the Gladys machine (port 19999 by default).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-netdata`.
2. In the **Configuration** tab, enter the address of the agent or the parent,
   then **Test the connection**.
3. Add the nodes from the **Discover** tab.

## How it works

At each refresh (30 seconds by default), per agent: one `/api/v1/info` (the
nodes it holds, and whether each child is connected), then per node one
`/api/v1/allmetrics` filtered on the charts used (about 10 kB, every value at
once) and one `/api/v1/alarms` (the alarms raised). The alarm log is read only
when an alarm cleared, for the value it cleared at. The children of a parent
are read through it (`/host/<guid>/…`). Nodes are identified by their Netdata
machine GUID: the same node seen directly and through its parent is one
device.

Only the devices added to Gladys receive states, only when a value changes
(the ones that move at every read at most once a minute), with a heartbeat
every 6 hours. The alarms raised at the last read are kept under `/data`, so a
restart neither misses nor repeats a transition.

## Checked on a real Netdata, and what was not

Tested against a real Netdata v2.12.1 parent and its child in Docker (the
official `netdata/netdata` image), with a test alarm raised and another one
flapping between warning and normal; the answers are kept, anonymized, in
`test/fixtures/netdata/`. The image of the integration was run in the Gladys
sandbox constraints (read-only, no capability, 256 MB) against them.

Not checked: Netdata v1.x agents (the API read here exists since v1.31), a
parent with many children, an agent behind a reverse proxy with a bearer
token (the header is sent, untested against a real proxy), and an actual
Gladys instance.

## Limitations

- Netdata Cloud is not read; 30 nodes per agent, three agents at most.
- The latest value of each chart only, no history import.
- Temperatures come from the `sensors.*` charts (lm-sensors / `/sys`), not
  from SMART or IPMI.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Netdata (`test/helpers/fakeNetdata.js`) serving the real
answers of `test/fixtures/netdata/`. See [`CLAUDE.md`](CLAUDE.md) for the
project rules.

## Credits

- [Netdata](https://github.com/netdata/netdata) by Netdata Inc. and
  contributors (GPL-3.0): the REST API read here.
- Home Assistant's
  [`netdata`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/netdata)
  integration (Apache-2.0) and its [`netdata`](https://github.com/home-assistant-ecosystem/python-netdata)
  library by Fabian Affolter (MIT): the idea of reading the agent API on the
  local network. No code reused.
- The architecture and the conformity tests follow
  [gladys-glances](https://github.com/guim31/gladys-glances) and
  [gladys-wled](https://github.com/guim31/gladys-wled).
- The cover is a generic illustration made for this project (no third-party
  logo).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Netdata Inc.

## License

Apache-2.0
