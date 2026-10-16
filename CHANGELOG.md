# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-16

### Added

- One Gladys device per Netdata node: a standalone agent, or a Netdata parent
  and every child streaming to it (up to three agents). Features: online, CPU,
  memory, load averages, main disk used and free, download and upload rates,
  highest temperature, uptime, and the number of warning and critical alarms.
- Extra Netdata charts chosen by id in the configuration: one feature per
  dimension.
- Scene triggers: a Netdata alarm raised to warning or critical, or back to
  normal (filters: node, state, alarm name); a node unreachable.
- Scene actions: the state of a node, with a ready-made summary; the raised
  alarms of one node or all of them.
- Dashboard widget: every node and its alarms at a glance, or the gauges and
  alarms of one node, with a Refresh button.
- Optional bearer token, self-signed certificates, refresh interval from 30
  seconds to 5 minutes, texts in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-netdata/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-netdata/releases/tag/v1.0.0
