# ChatCOM

> Un pont de communication supervisé et en lecture seule entre un rôle local de contrôle WORK et Codex.

[![CI](https://github.com/NoisyBoyFR/ChatCOM/actions/workflows/ci.yml/badge.svg)](https://github.com/NoisyBoyFR/ChatCOM/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/release/NoisyBoyFR/ChatCOM?include_prereleases&label=version)](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11)](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English](README.md) · **Français** · [Historique des versions](CHANGELOG.md)

[![Télécharger ChatCOM Desktop](https://img.shields.io/badge/Télécharger-ChatCOM_Desktop_pour_Windows-0078D4?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/ChatCOM-Desktop-1.0.0-rc.3-Setup.exe)

**Version candidate du code source :** `1.0.0-rc.7` · Windows x64 · deux conversations Codex existantes peuvent être sélectionnées pour un dialogue borné en lecture seule ; les mises à jour publiques restent désactivées tant que l’identité externe et le profil de certificat ne sont pas configurés

## Qu’est-ce que ChatCOM ?

ChatCOM organise un échange borné entre deux rôles locaux :

```text
WORK_LOCAL ── MISSION ──▶ CODEX_LOCAL
WORK_LOCAL ◀── REPORT ─── CODEX_LOCAL
WORK_LOCAL ─ NEXT_PROMPT ▶ CODEX_LOCAL

WORK_HOST ── MISSION ──▶ CODEX_LOCAL
WORK_HOST ◀── REPORT ─── CODEX_LOCAL
WORK_HOST ─ NEXT_PROMPT ──▶ CODEX_LOCAL
```

L’utilisateur choisit un projet et une mission, observe la conversation et conserve l’autorité finale. Chaque relais reste en lecture seule, contient exactement trois transmissions validées, s’arrête avant une seconde mission Codex et exige un nettoyage confirmé.

`WORK_LOCAL` est un rôle interne de contrôle. Ce n’est pas une session ChatGPT Work distante et ChatCOM n’agit jamais à la place de l’utilisateur.

La route `WORK_HOST` est la seule éligible à une preuve WORK ↔ Codex réelle. L’hôte MCP gère l’authentification WORK ; ChatCOM ne lit jamais les cookies, jetons, clés API ou profils navigateur. L’ancienne route `WORK_LOCAL` est nommée `LOCAL_SIMULATION` et ne constitue jamais une preuve réelle.

## Points forts de l’interface Desktop

- configuration guidée du projet, de la phase, du point, de la mission, des délais et des cycles ;
- chronologie visuelle WORK ↔ Codex avec pause, reprise, arrêt et demande de décision ;
- traductions hors ligne en français, anglais, chinois simplifié et russe ;
- thèmes Système, Clair et Sombre ;
- modes fenêtre normale, maximisée et plein écran (`F11` / `Échap`) ;
- taille du texte, réduction des animations et défilement automatique ;
- pré-vérification sans modèle du runtime, de l’authentification, du projet et du mode lecture seule ;
- préférences versionnées et validées, sans mission ni contenu de conversation ;
- paramètres édités dans un brouillon temporaire : « Sauvegarder » persiste et ferme, tandis que « Annuler » abandonne les changements ;
- diagnostics bornés sans prompt, réponse, identifiant de thread, secret ni stack trace.
- l’état Desktop distingue `WORK_HOST`, `CODEX_LOCAL`, `USER`, `REAL_WORK_HOST` et `LOCAL_SIMULATION` ;
- RC.6 ajoute le choix explicite entre conversation temporaire et conversation Codex liée ; une liaison reprend un fil par UUID exact et le conserve après le nettoyage. Voir [les liaisons persistantes](PERSISTENT-BINDINGS.md).
- RC.7 détecte deux conversations Codex existantes via l’App Server, les nomme WORK/CODEX, reprend les threads exacts dans un dialogue borné en lecture seule et restaure la paire sans démarrage automatique. Voir [le dialogue à deux conversations](DUAL-CONVERSATION-DIALOGUE.md).

## Télécharger et installer sur Windows

Les liens publics ci-dessous pointent encore vers la dernière RC.3 publiée.
La RC.6 reste un travail local de validation : elle ne doit pas être publiée
et les mises à jour automatiques restent fermées tant que les artefacts
Windows ne sont pas signés. Le canal Stable utilise `autoUpdater` dans le
processus principal Electron avec la source officielle
`update.electronjs.org/NoisyBoyFR/ChatCOM`. Le canal Préversion utilise un flux
Squirrel statique distinct sous la structure GitHub Pages
`/preview/win32/x64` ; ce flux est conçu et testé localement, mais n’est pas
déployé ici. L’application attend la première exécution Squirrel puis vérifie
toutes les six heures, télécharge en arrière-plan et ne force jamais un
redémarrage pendant un relais. Le redémarrage n’est proposé qu’après nettoyage
confirmé.

1. Téléchargez **[ChatCOM-Desktop-1.0.0-rc.3-Setup.exe](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/ChatCOM-Desktop-1.0.0-rc.3-Setup.exe)**.
2. Vous pouvez aussi télécharger [SHA256SUMS.txt](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/SHA256SUMS.txt) pour vérifier l’installateur.
3. Exécutez l’installateur pour l’utilisateur Windows actuel.
4. Ouvrez **ChatCOM Desktop**, sélectionnez un projet Git local de confiance, puis suivez la configuration guidée.

L’installateur ne demande pas de droits administrateur, ne modifie pas le `PATH`, ne configure pas MCP et ne démarre automatiquement ni Codex ni un relais. Il est actuellement **non signé** : vérifiez son empreinte et continuez uniquement si vous faites confiance à ce dépôt et à cette préversion.

Le workflow manuel de signature Windows SignPath et la configuration unique à
effectuer par le propriétaire dans GitHub sont décrits dans
[WINDOWS-SIGNING.md](WINDOWS-SIGNING.md). Ce workflow produit uniquement un
artefact temporaire signé et ne peut créer ni tag ni Release.

Le nom du produit est `ChatCOM` ; l’éditeur Authenticode est le sujet exact
attribué ultérieurement par SignPath et n’est jamais deviné ni codé en dur.
Lors d’un futur build signé, `SIGNPATH_PUBLISHER_SUBJECT` est fourni comme
entrée publique du build puis intégré de manière immuable dans le bundle
principal Desktop. L’updater compare exactement cette valeur embarquée avec le
sujet du binaire installé et l’éditeur du manifeste ; toute valeur absente,
malformée ou différente désactive les mises à jour. Le validateur local du
canal Préversion refuse toute activation tant que le manifeste n’est pas
`SIGNED`, horodaté, haché et associé au même sujet configuré.

Le packaging Desktop commence dans un dossier de sortie ciblé et vérifié. Le
paquet contient exactement un `codex.exe` ; l’ancienne copie
`resources/@openai` dupliquée à côté du runtime décompressé n’est plus ajoutée.

Les informations de build lisibles par machine se trouvent dans [desktop-build-manifest.json](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/desktop-build-manifest.json).

## Prérequis

- Windows 10 ou Windows 11 x64 pour ChatCOM Desktop ;
- un compte Codex authentifié accessible au runtime Codex inclus ;
- un projet Git local de confiance à examiner ;
- Node.js 22 ou plus récent uniquement pour la CLI, MCP ou le développement depuis les sources.

## Modèle de sécurité

- les projets examinés restent en lecture seule ;
- les approbations Codex sont désactivées dans le relais ;
- chaque enveloppe, route, identifiant, date, enum et limite UTF-8 est validé ;
- le nettoyage doit être confirmé avant le cycle suivant ;
- une décision produit ou un effet de bord rend le contrôle à l’utilisateur ;
- le renderer Electron est isolé et ne possède pas d’accès Node ;
- les canaux IPC et leurs émetteurs sont autorisés et validés explicitement ;
- les diagnostics exposent uniquement des métadonnées bornées.

Le relais MCP authentifié a réussi une preuve réelle de trois transmissions avec nettoyage confirmé. L’architecture de mise à jour RC.6, l’interface Desktop, ses traductions, ses paramètres, son installateur, le pont WORK_HOST et les garde-fous SignPath sont couverts par la suite de tests déterministes et la CI multiplateforme. La preuve réelle WORK_HOST est enregistrée dans [`.ai/PROOF.md`](.ai/PROOF.md).

## Démarrage rapide pour les développeurs

```powershell
npm ci
npm run verify
npm run desktop:dev
```

Construire l’installateur Windows :

```powershell
npm run desktop:make
```

Installateur attendu :

```text
out-desktop/make/squirrel.windows/x64/ChatCOM-Desktop-1.0.0-rc.7-Setup.exe
```

`npm run verify` exécute le build, les vérifications TypeScript du noyau et de Desktop, les tests déterministes, la validation de configuration, l’audit des dépendances de production et le contrôle du paquet npm. Les commandes de diagnostic peuvent contacter un runtime Codex réel et nécessitent une autorisation explicite.

## Configuration de la CLI

Copiez `relay.config.example.json`, puis configurez la route du projet :

```json
{
  "version": "1.0",
  "project_root": ".",
  "phase": "TESTS",
  "point": "REVUE_FINALE",
  "mission": "Examiner l’état actuel du projet sans modifier les fichiers."
}
```

Valider sans démarrer Codex :

```powershell
node .\dist\portable-cli.js validate --config .\relay.config.example.json
```

Exécuter uniquement avec une autorisation utilisateur explicite :

```powershell
node .\dist\portable-cli.js run --config .\relay.config.example.json --timeout-ms 600000
```

## Pont MCP

ChatCOM expose les outils du pont RC.6 ainsi que des opérations locales bornées de gestion des liaisons :

- `chatcom_validate_config` valide la configuration sans démarrer Codex ;
- `chatcom_work_open` reçoit une `MISSION` `WORK_HOST` validée, obtient un rapport Codex en lecture seule et laisse l’échange ouvert ;
- `chatcom_work_complete` reçoit exactement un `NEXT_PROMPT` `WORK_HOST`, supprime un fil temporaire ou conserve un fil lié, ferme le client et confirme le nettoyage ;
- `chatcom_binding_create`, `chatcom_binding_validate`, `chatcom_binding_list`, `chatcom_binding_disable` et `chatcom_binding_remove` gèrent les liaisons locales exactes sans lire l’historique de conversation ;
- `chatcom_run_relay` reste un outil de compatibilité nommé `LOCAL_SIMULATION` et ne constitue pas une preuve WORK réelle.

Le protocole réel est le suivant :

1. Le véritable hôte WORK appelle `chatcom_work_open` avec `MISSION`.
2. ChatCOM retourne `REPORT` ; WORK l’analyse dans sa session hôte.
3. Le même hôte appelle `chatcom_work_complete` avec `NEXT_PROMPT`.

La réussite finale exige exactement trois transmissions et `cleanup=CONFIRMED`. ChatCOM ne lit jamais les cookies, jetons, clés API ou profils navigateur de WORK. Sans véritable hôte WORK, le verdict est `READY_FOR_WORK_PROOF`, jamais une preuve réelle simulée.

Le mode par défaut reste `EPHEMERAL`. Un `binding_id` active `PERSISTENT_BOUND` uniquement après validation de l’UUID exact et du chemin canonique du projet. Les titres ne sélectionnent jamais les conversations et les identifiants complets de thread ne figurent jamais dans les sorties bornées. Voir [PERSISTENT-BINDINGS.md](PERSISTENT-BINDINGS.md).

Compilez ChatCOM, copiez [`.codex/config.toml.example`](.codex/config.toml.example) dans une configuration Codex de confiance, remplacez les chemins fictifs par des chemins absolus, puis redémarrez l’hôte MCP. Conservez le relais en mode d’approbation `prompt`.

## Ressources du projet

- [Page d’accueil anglaise](README.md)
- [Historique des versions](CHANGELOG.md)
- [Procédure de publication](RELEASING.md)
- [Preuves opérationnelles](.ai/PROOF.md)
- [Prompt Codex durable](CODEX-CHATCOM-PROMPT.md)
- [Liaisons Codex persistantes](PERSISTENT-BINDINGS.md)
- [Licence](LICENSE)
- [Avis de confidentialite](PRIVACY.md)
- [Politique de securite](SECURITY.md)
- [Notices tierces](THIRD-PARTY-NOTICES.md)
- [Politique de signature Windows](CODE-SIGNING-POLICY.md)
- [Dossier de candidature SignPath](SIGNPATH-APPLICATION.md)
- [Préversion RC.3](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)

## Gate de publication RC.6

La RC.6 est une candidate source, pas une release publique. La publication
Windows reste bloquee tant que le proprietaire n'a pas termine la candidature
SignPath Foundation Open Source Code Signing et que le workflow protege n'a
pas produit un manifeste `SIGNED`. Le workflow est manuel, limite a `main`, ne
peut creer ni tag ni Release et n'execute jamais `npm publish`.

## Origine

ChatCOM provient du relais générique WORK ↔ Codex développé dans FitMyLife. Le code produit et l’état de workflow de FitMyLife ne font pas partie de ce dépôt.
