# Netdata

[Netdata](https://www.netdata.cloud/) est un agent de supervision en temps réel
pour Linux, FreeBSD, macOS et Windows, très répandu dans les homelabs. Cette
intégration lit les agents Netdata de vos **autres machines** — un NAS, un
serveur maison, un Raspberry Pi — et les amène dans Gladys : un appareil par
nœud Netdata, avec son processeur, sa mémoire, sa charge, son disque principal,
son réseau, sa température, sa durée de fonctionnement et le nombre d'alarmes
Netdata levées. Indiquez-lui un **parent Netdata** et tous les nœuds qui lui
envoient leurs données apparaissent. Les scènes peuvent réagir quand une alarme
Netdata est levée ou retombe, ou quand un nœud ne répond plus, et un widget de
tableau de bord montre vos nœuds et leurs alarmes. Tout reste sur votre réseau
local : Netdata Cloud n'est pas nécessaire.

Testée contre un vrai parent Netdata v2.12.1 et son enfant (Docker), avec des
alarmes de test levées puis retombées. Pas encore sur toutes les installations :
vos retours sont les bienvenus dans
[les issues](https://github.com/guim31/gladys-netdata/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un agent Netdata (v1.31 ou plus récent, v2 conseillée) sur chaque machine à
  suivre, ou un parent Netdata auquel elles envoient leurs données, joignable
  depuis la machine de Gladys (port 19999 par défaut).
- Jusqu'à trois agents par installation de l'intégration, et 30 nœuds par
  agent.

L'intégration ne fait que lire : elle ne modifie rien sur vos machines ni dans
la configuration de Netdata.

## Mise en route

### 1. Vérifier que Netdata répond

Depuis un navigateur de votre réseau, ouvrez `http://<machine>:19999` : le
tableau de bord de Netdata doit s'afficher. Sinon, Netdata n'écoute peut-être
que sur `localhost` : mettez `bind to = *` dans la section `[web]` de
`netdata.conf` et redémarrez-le.

Avec plusieurs machines, le plus simple est un
[parent Netdata](https://learn.netdata.cloud/docs/observability-centralization-points/metrics-centralization-points/configuration) :
les autres agents lui envoient leurs données, et l'intégration les lit toutes à
travers lui, avec une seule adresse.

### 2. Configurer l'intégration

Dans Gladys, ouvrez **Intégrations → Netdata → Configuration** :

- **Adresse de Netdata** : l'adresse de l'agent ou du parent, par exemple
  `192.168.1.20`, `nas.lan` ou `http://nas.lan:19999` (l'adresse copiée depuis
  le navigateur convient aussi).
- **Jeton Bearer (facultatif)** : seulement si l'agent ou son proxy inverse
  demande un en-tête `Authorization: Bearer`. Laissez vide pour un agent local
  ordinaire.
- **Adresse du deuxième** et **du troisième Netdata** : d'autres agents,
  inutiles pour les enfants d'un parent.
- **Graphiques supplémentaires (facultatif)** : des identifiants de graphiques
  Netdata, séparés par des virgules, par exemple `system.io, mem.swap`. Chaque
  dimension de ces graphiques devient une fonctionnalité supplémentaire des
  nœuds qui les ont. L'identifiant figure sous le titre de chaque graphique
  dans le tableau de bord de Netdata. Cinq graphiques au plus.
- **Intervalle de rafraîchissement** : 30 secondes par défaut.
- **Accepter les certificats auto-signés** : seulement pour une adresse en
  `https://` dont votre navigateur ne reconnaît pas non plus le certificat.
- **Langue des noms** : la langue des noms des fonctionnalités, fixés à l'ajout
  d'un appareil, et des résultats de scène.

Enregistrez, puis utilisez **Tester la connexion** : une ligne par agent, avec
la version de Netdata, le nombre de nœuds et d'alarmes levées.

### 3. Ajouter les nœuds

Ouvrez l'onglet **Découverte** : chaque nœud Netdata y figure. Ajoutez ceux que
vous voulez suivre. Les déclencheurs de scène fonctionnent pour tous les nœuds,
ajoutés ou non.

## Les appareils

Chaque nœud est un appareil, au nom de sa machine. Ses fonctionnalités :

- **En ligne** : 1 tant que le nœud répond, 0 dès qu'il ne répond plus.
- **Processeur** : l'utilisation du processeur, en %.
- **Mémoire** : la mémoire utilisée par les programmes, en % (cache et tampons
  exclus, comme le compte `free`).
- **Charge (1 min)**, **Charge (5 min)**, **Charge (15 min)** : les charges
  moyennes.
- **Disque principal utilisé** (%) et **Disque principal libre** (Go) : le
  système de fichiers racine, sinon le plus grand.
- **Réception** et **Émission** : le trafic des interfaces physiques, en
  Mbit/s.
- **Température la plus haute** : le capteur de température le plus chaud, en
  °C, quand le nœud a des capteurs.
- **Durée de fonctionnement** : en jours.
- **Alarmes en avertissement** et **Alarmes critiques** : le nombre d'alarmes
  Netdata levées en ce moment.
- Une fonctionnalité par dimension des **graphiques supplémentaires**, au nom
  du graphique et de la dimension, avec l'unité donnée par Netdata.

Les valeurs qui bougent à chaque lecture (processeur, mémoire, charge, réseau,
température) sont envoyées à Gladys au plus une fois par minute, les autres
quand elles changent.

## Tableau de bord

Ajoutez le widget **Nœuds Netdata** à un tableau de bord :

- sans nœud choisi dans ses réglages, il montre combien de nœuds sont en ligne
  et combien d'alarmes sont levées, puis une ligne par nœud, en rouge s'il a
  une alarme critique ou ne répond pas, en orange avec un avertissement ;
- avec un nœud choisi, il montre ses jauges processeur, mémoire et disque, sa
  température, la liste de ses alarmes levées avec leurs valeurs, sa charge et
  sa durée de fonctionnement.

Le bouton **Actualiser** relit Netdata aussitôt.

## Scènes

### Déclencheurs

- **Alarme Netdata** : une alarme Netdata passe en avertissement ou critique,
  ou revient à la normale. Filtres : le nœud, le nouvel état
  (**Avertissement**, **Critique**, **Revenue à la normale**) et le nom de
  l'alarme (par exemple `ram_in_use` ou `disk_space_usage`, visible dans le
  tableau de bord de Netdata) ; laissés vides, ils acceptent tout. Les actions
  peuvent utiliser le nœud, l'alarme, son graphique, le nouvel état, la valeur
  (avec et sans unité) et la description de l'alarme. La valeur n'est pas
  toujours connue quand une alarme revient à la normale (quand Netdata a
  redémarré ou rechargé ses alarmes, par exemple).
- **Nœud injoignable** : un nœud ne répond plus, ou n'envoie plus ses données à
  son parent, deux lectures de suite. Les actions peuvent utiliser le nom du
  nœud et la raison.

Les alarmes sont celles de Netdata lui-même : leurs seuils se règlent dans
Netdata (`edit-config health.d/…`), pas dans Gladys. Les alarmes levées au
démarrage de l'intégration sont son point de départ : seuls les changements
qui suivent déclenchent une scène, y compris après un redémarrage de Gladys.

### Actions

- **État d'un nœud Netdata** : lit un nœud et donne aux actions suivantes ses
  chiffres (processeur, mémoire, charge, disque, réseau, température, durée de
  fonctionnement, alarmes) et un résumé prêt à envoyer, par exemple
  `nas : processeur 12 %, mémoire 45 %, disque 78 % (310 Go libres), 48 °C, aucune alarme levée`.
- **Alarmes Netdata levées** : liste les alarmes levées en ce moment, sur un
  nœud ou sur tous, avec leur nombre et un résumé à envoyer, par exemple
  `nas : ram_in_use (Avertissement, 91.2%)`.

### Idées de scènes

- **Alarme Netdata**, état **Critique** → envoyer le message
  `{{triggerEvent.data.node_name}} : {{triggerEvent.data.alarm_name}} ({{triggerEvent.data.value_text}})`.
- Chaque matin à 8 h → **Alarmes Netdata levées** → si le nombre dépasse 0,
  envoyer le résumé.
- **Nœud injoignable** sur le NAS → allumer une lampe en rouge et envoyer un
  message.

## Dépannage

- **« ne répond pas »** : vérifiez l'adresse et le port dans un navigateur, et
  que Netdata écoute sur le réseau (`bind to = *`). Un pare-feu bloque peut-être
  le port 19999.
- **« l'agent demande un jeton »** / **« jeton refusé »** : l'agent ou le proxy
  inverse devant lui protège l'API : saisissez le bon jeton Bearer.
- **« aucun agent Netdata à cette adresse »** : un autre service répond à cette
  adresse (une page de connexion, un proxy inverse sans Netdata derrière).
- **Un nœud « n'envoie plus ses données à son parent Netdata »** : l'enfant est
  éteint, ou son envoi vers le parent s'est arrêté : voyez les logs de son
  agent Netdata.
- **Pas de température** : le nœud n'a aucun capteur lu par Netdata (une VM, un
  conteneur sans accès à `/sys`).
- **Netdata en Docker ne montre que son conteneur** : lancez-le avec les
  montages des instructions officielles (`/proc`, `/sys`, `/etc/os-release`…),
  sinon il supervise son propre conteneur.
- Plus de détails avec la variable d'environnement `LOG_LEVEL=debug` sur
  l'intégration.

## Limites

- Netdata Cloud et ses espaces ne sont pas lus : seulement les agents et
  parents locaux.
- 30 nœuds par agent au plus, trois agents au plus.
- L'intégration lit la dernière valeur de chaque graphique à chaque
  rafraîchissement : elle n'importe pas l'historique de Netdata.
- Seules les alarmes Netdata déclenchent des scènes : un seuil à vous est une
  condition de scène sur une fonctionnalité.
- Sans lien avec Netdata Inc.
