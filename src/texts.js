// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene event
// variables, scene action outputs and errors. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './netdata/client.js';

export const LANGUAGE_FALLBACK = 'en';

// Why a node is not read, beyond the errors of its agent (src/netdata/client.js).
export const NODE_ERRORS = Object.freeze({
  DISCONNECTED: 'disconnected', // a child no longer streams to its parent
  GONE: 'gone', // the agent no longer holds this node
});

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noAgent: {
    en: 'Enter the address of a Netdata agent in the configuration.',
    fr: "Saisissez l'adresse d'un agent Netdata dans la configuration.",
    de: 'Gib die Adresse eines Netdata-Agenten in der Konfiguration ein.',
    es: 'Introduzca la dirección de un agente Netdata en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.20 or http://nas.lan:19999',
    fr: 'Adresse incomprise, ex. 192.168.1.20 ou http://nas.lan:19999',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20 oder http://nas.lan:19999',
    es: 'Dirección no válida, p. ej. 192.168.1.20 o http://nas.lan:19999',
  },
};

// One short explanation per error kind.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer (is Netdata running?)',
    fr: 'ne répond pas (Netdata est-il lancé ?)',
    de: 'antwortet nicht (läuft Netdata?)',
    es: 'no responde (¿se está ejecutando Netdata?)',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'token refused',
    fr: 'jeton refusé',
    de: 'Token abgelehnt',
    es: 'token rechazado',
  },
  [ERROR_KINDS.TOKEN_MISSING]: {
    en: 'the agent asks for a token: enter it in the configuration',
    fr: "l'agent demande un jeton : saisissez-le dans la configuration",
    de: 'der Agent verlangt ein Token: Gib es in der Konfiguration ein',
    es: 'el agente pide un token: introdúzcalo en la configuración',
  },
  [ERROR_KINDS.NOT_NETDATA]: {
    en: 'no Netdata agent at this address',
    fr: 'aucun agent Netdata à cette adresse',
    de: 'kein Netdata-Agent unter dieser Adresse',
    es: 'no hay ningún agente Netdata en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
  [NODE_ERRORS.DISCONNECTED]: {
    en: 'no longer streams to its Netdata parent',
    fr: "n'envoie plus ses données à son parent Netdata",
    de: 'sendet keine Daten mehr an seinen Netdata-Parent',
    es: 'ya no envía sus datos a su padre Netdata',
  },
  [NODE_ERRORS.GONE]: {
    en: 'no longer known to its Netdata agent',
    fr: "n'est plus connu de son agent Netdata",
    de: 'ist seinem Netdata-Agenten nicht mehr bekannt',
    es: 'su agente Netdata ya no lo conoce',
  },
};

// The state of an alarm, in words (scene event variable, widget rows).
export const ALARM_STATUS_TEXT = {
  warning: { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  critical: { en: 'Critical', fr: 'Critique', de: 'Kritisch', es: 'Crítica' },
  clear: { en: 'Back to normal', fr: 'Revenue à la normale', de: 'Wieder normal', es: 'Normal' },
};

// The "Test the connection" report, one line per agent.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    nodes: (count) => `${count} node(s)`,
    alarms: (count) => `${count} alarm(s) raised`,
  },
  fr: {
    ok: 'OK',
    nodes: (count) => `${count} nœud(s)`,
    alarms: (count) => `${count} alarme(s) levée(s)`,
  },
  de: {
    ok: 'OK',
    nodes: (count) => `${count} Knoten`,
    alarms: (count) => `${count} aktive(r) Alarm(e)`,
  },
  es: {
    ok: 'OK',
    nodes: (count) => `${count} nodo(s)`,
    alarms: (count) => `${count} alarma(s) activa(s)`,
  },
};

// The `summary` outputs of the scene actions, ready for a message.
export const SUMMARY_TEXT = {
  en: {
    cpu: 'CPU',
    memory: 'memory',
    disk: 'disk',
    free: (size) => `${size} free`,
    alarms: (count) => `${count} alarm(s)`,
    noAlarm: 'no alarm raised',
    unreachable: 'unreachable',
  },
  fr: {
    cpu: 'processeur',
    memory: 'mémoire',
    disk: 'disque',
    free: (size) => `${size} libres`,
    alarms: (count) => `${count} alarme(s)`,
    noAlarm: 'aucune alarme levée',
    unreachable: 'injoignable',
  },
  de: {
    cpu: 'Prozessor',
    memory: 'Arbeitsspeicher',
    disk: 'Datenträger',
    free: (size) => `${size} frei`,
    alarms: (count) => `${count} Alarm(e)`,
    noAlarm: 'kein aktiver Alarm',
    unreachable: 'nicht erreichbar',
  },
  es: {
    cpu: 'procesador',
    memory: 'memoria',
    disk: 'disco',
    free: (size) => `${size} libres`,
    alarms: (count) => `${count} alarma(s)`,
    noAlarm: 'ninguna alarma activa',
    unreachable: 'inaccesible',
  },
};

// Units written in the texts (the French write "Go", the others "GB").
export const UNIT_TEXT = {
  gigabyte: { en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  noAgent: {
    en: 'No Netdata agent is configured.',
    fr: "Aucun agent Netdata n'est configuré.",
    de: 'Kein Netdata-Agent ist konfiguriert.',
    es: 'No hay ningún agente Netdata configurado.',
  },
  unknownNode: {
    en: 'This device is not a node of a configured Netdata agent.',
    fr: "Cet appareil n'est pas un nœud d'un agent Netdata configuré.",
    de: 'Dieses Gerät ist kein Knoten eines konfigurierten Netdata-Agenten.',
    es: 'Este dispositivo no es un nodo de un agente Netdata configurado.',
  },
};

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A number written the way the language writes it (decimal comma in fr, de, es). */
export const formatNumber = (value, language, digits = 1) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

/** "12 %" (fr, de, es) or "12%" (en). */
export const formatPercent = (value, language) =>
  `${formatNumber(value, language, 0)}${language === 'en' ? '%' : ' %'}`;

/** A size in GiB, "110 GB" / "110 Go". */
export const formatGigabytes = (gigabytes, language) =>
  `${formatNumber(gigabytes, language, gigabytes >= 10 ? 0 : 1)} ${pick(UNIT_TEXT.gigabyte, language)}`;

/** A temperature, "52 °C". */
export const formatCelsius = (value, language) => `${formatNumber(value, language, 0)} °C`;

/** An uptime, "4 d 3 h" / "4 j 3 h" / "4 T 3 Std." / "4 d 3 h". */
export function formatUptime(seconds, language) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const day = { en: 'd', fr: 'j', de: 'T', es: 'd' }[language] ?? 'd';
  const hour = language === 'de' ? 'Std.' : 'h';
  if (days > 0) {
    return `${days} ${day} ${hours} ${hour}`;
  }
  if (hours > 0) {
    return `${hours} ${hour} ${minutes} min`;
  }
  return `${minutes} min`;
}
