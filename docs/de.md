# Netdata

[Netdata](https://www.netdata.cloud/) ist ein Echtzeit-Überwachungsagent für
Linux, FreeBSD, macOS und Windows, in Homelabs sehr verbreitet. Diese
Integration liest die Netdata-Agenten deiner **anderen Rechner** — ein NAS, ein
Heimserver, ein Raspberry Pi — und bringt sie in Gladys: ein Gerät pro
Netdata-Knoten, mit Prozessor, Arbeitsspeicher, Last, Hauptdatenträger,
Netzwerk, Temperatur, Laufzeit und der Anzahl aktiver Netdata-Alarme. Gib ihr
einen **Netdata-Parent** an, und jeder Knoten, der an ihn streamt, erscheint.
Szenen können reagieren, wenn ein Netdata-Alarm ausgelöst wird oder endet oder
wenn ein Knoten nicht mehr antwortet, und ein Dashboard-Widget zeigt deine
Knoten und ihre Alarme. Alles bleibt in deinem lokalen Netzwerk: Netdata Cloud
wird nicht benötigt.

Getestet mit einem echten Netdata-v2.12.1-Parent und seinem Kind (Docker), mit
ausgelösten und beendeten Testalarmen. Noch nicht auf jeder Installation:
Rückmeldungen sind in [den Issues](https://github.com/guim31/gladys-netdata/issues)
willkommen.

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Einen Netdata-Agenten (v1.31 oder neuer, v2 empfohlen) auf jedem zu
  überwachenden Rechner oder einen Netdata-Parent, an den sie streamen,
  erreichbar vom Gladys-Rechner aus (standardmäßig Port 19999).
- Bis zu drei Agenten pro Installation der Integration und 30 Knoten pro
  Agent.

Die Integration liest nur und ändert nichts auf deinen Rechnern und nichts an
der Netdata-Konfiguration.

## Erste Schritte

### 1. Prüfen, ob Netdata antwortet

Öffne in einem Browser in deinem Netzwerk `http://<rechner>:19999`: Das
Netdata-Dashboard muss erscheinen. Falls nicht, lauscht Netdata vielleicht nur
auf `localhost`: Setze `bind to = *` im Abschnitt `[web]` von `netdata.conf` und
starte es neu.

Bei mehreren Rechnern ist ein
[Netdata-Parent](https://learn.netdata.cloud/docs/observability-centralization-points/metrics-centralization-points/configuration)
am einfachsten: Die anderen Agenten streamen an ihn, und die Integration liest
sie alle über ihn, mit einer einzigen Adresse.

### 2. Die Integration konfigurieren

Öffne in Gladys **Integrationen → Netdata → Konfiguration**:

- **Netdata-Adresse**: die Adresse des Agenten oder des Parents, zum Beispiel
  `192.168.1.20`, `nas.lan` oder `http://nas.lan:19999` (die aus dem Browser
  kopierte Adresse funktioniert auch).
- **Bearer-Token (optional)**: nur wenn der Agent oder sein Reverse-Proxy einen
  `Authorization: Bearer`-Header verlangt. Bei einem einfachen lokalen Agenten
  leer lassen.
- **Adresse des zweiten** und **des dritten Netdata**: weitere Agenten, für die
  Kinder eines Parents nicht nötig.
- **Zusätzliche Diagramme (optional)**: Diagramm-IDs von Netdata, durch Kommas
  getrennt, zum Beispiel `system.io, mem.swap`. Jede Dimension dieser Diagramme
  wird eine zusätzliche Funktion der Knoten, die sie haben. Die ID steht unter
  dem Titel jedes Diagramms im Netdata-Dashboard. Höchstens fünf Diagramme.
- **Aktualisierungsintervall**: standardmäßig 30 Sekunden.
- **Selbstsignierte Zertifikate akzeptieren**: nur für eine `https://`-Adresse,
  deren Zertifikat auch dein Browser nicht anerkennt.
- **Sprache der Namen**: die Sprache der Funktionsnamen, beim Hinzufügen eines
  Geräts festgelegt, und der Szenen-Ergebnisse.

Speichere und nutze dann **Verbindung testen**: eine Zeile pro Agent, mit der
Netdata-Version, der Anzahl der Knoten und der aktiven Alarme.

### 3. Die Knoten hinzufügen

Öffne den Tab **Entdecken**: Jeder Netdata-Knoten ist dort aufgeführt. Füge
die hinzu, die du überwachen willst. Die Szenen-Auslöser funktionieren für
alle Knoten, ob hinzugefügt oder nicht.

## Die Geräte

Jeder Knoten ist ein Gerät, benannt nach seinem Hostnamen. Seine Funktionen:

- **Online**: 1, solange der Knoten antwortet, 0, sobald er es nicht mehr tut.
- **Prozessor**: die Prozessorauslastung in %.
- **Arbeitsspeicher**: der von Programmen belegte Speicher in % (ohne Cache und
  Puffer, wie `free` ihn zählt).
- **Last (1 Min.)**, **Last (5 Min.)**, **Last (15 Min.)**: die
  Durchschnittslasten.
- **Hauptdatenträger belegt** (%) und **Hauptdatenträger frei** (GB): das
  Root-Dateisystem, sonst das größte.
- **Empfang** und **Senden**: der Verkehr der physischen Schnittstellen in
  Mbit/s.
- **Höchste Temperatur**: der heißeste Temperatursensor in °C, wenn der Knoten
  Sensoren hat.
- **Laufzeit**: in Tagen.
- **Warnende Alarme** und **Kritische Alarme**: wie viele Netdata-Alarme gerade
  aktiv sind.
- Eine Funktion pro Dimension der **zusätzlichen Diagramme**, benannt nach
  Diagramm und Dimension, mit der Einheit, die Netdata angibt.

Die Werte, die sich bei jeder Lesung ändern (Prozessor, Arbeitsspeicher, Last,
Netzwerk, Temperatur), werden höchstens einmal pro Minute an Gladys gesendet,
die anderen, wenn sie sich ändern.

## Dashboard

Füge das Widget **Netdata-Knoten** zu einem Dashboard hinzu:

- ohne gewählten Knoten in seinen Einstellungen zeigt es, wie viele Knoten
  online und wie viele Alarme aktiv sind, dann eine Zeile pro Knoten, rot bei
  einem kritischen Alarm oder ohne Antwort, orange bei einer Warnung;
- mit einem gewählten Knoten zeigt es seine Anzeigen für Prozessor, Speicher
  und Datenträger, seine Temperatur, die Liste seiner aktiven Alarme mit ihren
  Werten, seine Last und seine Laufzeit.

Die Schaltfläche **Aktualisieren** liest Netdata sofort neu.

## Szenen

### Auslöser

- **Netdata-Alarm**: Ein Netdata-Alarm wechselt zu Warnung oder kritisch oder
  wird wieder normal. Filter: der Knoten, der neue Zustand (**Warnung**,
  **Kritisch**, **Wieder normal**) und der Name des Alarms (zum Beispiel
  `ram_in_use` oder `disk_space_usage`, im Netdata-Dashboard sichtbar); leer
  gelassen passen sie auf alles. Die Aktionen können den Knoten, den Alarm,
  sein Diagramm, den neuen Zustand, den Wert (mit und ohne Einheit) und die
  Beschreibung des Alarms verwenden. Ein Wert ist nicht immer bekannt, wenn ein
  Alarm wieder normal wird (zum Beispiel wenn Netdata neu gestartet wurde oder
  seine Alarme neu geladen hat).
- **Knoten nicht erreichbar**: Ein Knoten antwortet nicht mehr oder streamt
  nicht mehr an seinen Parent, zwei Lesungen hintereinander. Die Aktionen
  können den Knotennamen und den Grund verwenden.

Die Alarme sind die von Netdata selbst, deren Schwellen in Netdata
eingestellt werden (`edit-config health.d/…`), nicht in Gladys. Die beim Start der
Integration aktiven Alarme sind ihr Ausgangspunkt: Nur die Änderungen danach
lösen eine Szene aus, auch über einen Neustart von Gladys hinweg.

### Aktionen

- **Zustand eines Netdata-Knotens**: liest einen Knoten und gibt den nächsten
  Aktionen seine Zahlen (Prozessor, Speicher, Last, Datenträger, Netzwerk,
  Temperatur, Laufzeit, Alarme) und eine fertige Zusammenfassung, zum Beispiel
  `nas: Prozessor 12 %, Arbeitsspeicher 45 %, Datenträger 78 % (310 GB frei), 48 °C, kein aktiver Alarm`.
- **Aktive Netdata-Alarme**: listet die gerade aktiven Alarme auf einem oder
  allen Knoten auf, mit ihrer Anzahl und einer Zusammenfassung zum Senden, zum
  Beispiel `nas: ram_in_use (Warnung, 91.2%)`.

### Szenen-Ideen

- **Netdata-Alarm**, Zustand **Kritisch** → die Nachricht
  `{{triggerEvent.data.node_name}}: {{triggerEvent.data.alarm_name}} ({{triggerEvent.data.value_text}})`
  senden.
- Jeden Morgen um 8:00 Uhr → **Aktive Netdata-Alarme** → wenn die Anzahl über 0
  liegt, die Zusammenfassung senden.
- **Knoten nicht erreichbar** beim NAS → eine Lampe rot einschalten und eine
  Nachricht senden.

## Fehlerbehebung

- **„antwortet nicht“**: Prüfe Adresse und Port in einem Browser und ob Netdata
  im Netzwerk lauscht (`bind to = *`). Vielleicht blockiert eine Firewall den
  Port 19999.
- **„der Agent verlangt ein Token“** / **„Token abgelehnt“**: Der Agent oder
  der Reverse-Proxy davor schützt die API: Gib das richtige Bearer-Token ein.
- **„kein Netdata-Agent unter dieser Adresse“**: Unter dieser Adresse antwortet
  ein anderer Dienst (eine Anmeldeseite, ein Reverse-Proxy ohne Netdata
  dahinter).
- **Ein Knoten „sendet keine Daten mehr an seinen Netdata-Parent“**: Das Kind
  ist aus, oder sein Streaming an den Parent hat aufgehört: Sieh dir die
  Protokolle seines Netdata-Agenten an.
- **Keine Temperatur**: Der Knoten hat keinen Sensor, den Netdata liest (eine
  VM, ein Container ohne Zugriff auf `/sys`).
- **Netdata in Docker zeigt nur seinen Container**: Starte es mit den Mounts
  der offiziellen Anleitung (`/proc`, `/sys`, `/etc/os-release` …), sonst
  überwacht es seinen eigenen Container.
- Mehr Details mit der Umgebungsvariable `LOG_LEVEL=debug` an der Integration.

## Grenzen

- Netdata Cloud und seine Räume werden nicht gelesen: nur lokale Agenten und
  Parents.
- Höchstens 30 Knoten pro Agent und höchstens drei Agenten.
- Die Integration liest bei jeder Aktualisierung den letzten Wert jedes
  Diagramms und importiert nicht den Verlauf von Netdata.
- Nur die Netdata-Alarme lösen Szenen aus: Eine eigene Schwelle ist eine
  Szenen-Bedingung auf einer Funktion.
- Nicht mit Netdata Inc. verbunden.
