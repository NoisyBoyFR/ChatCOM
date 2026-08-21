# ChatCOM

ChatCOM est un relay local réutilisable pour une communication structurée entre un rôle de revue Work et un rôle technique Codex.

[English version](README.md)

## État actuel

Le noyau réutilisable a été séparé de FitMyLife dans un projet autonome. La configuration, le contrat de messages, le routage, le nettoyage, les diagnostics bornés, l’adaptateur Codex SDK, le fallback App Server et les tests synthétiques sont disponibles.

ChatCOM `1.0.0-rc.3` est la candidate de publication du relay local borné. Elle
ajoute au pont MCP STDIO v0.3.0 un contrat de messages TypeScript/MCP strict et
partagé, une annulation hôte propagée et bornée, la cohérence validée des
sessions du relay et une matrice CI multi-plateforme.

La candidate a terminé un relay réel authentifié MCP STDIO → ChatCOM → Codex →
Work avec exactement trois transmissions et un nettoyage confirmé. La preuve
bornée et les preuves runtime antérieures sont consignées dans
[`.ai/PROOF.md`](.ai/PROOF.md).

La candidate réussit 83 tests déterministes, le build, le typecheck, la
validation de configuration, le contrôle d’archive à blanc et l’audit des
dépendances de production. La CI exécute le même garde-fou sur Ubuntu, Windows
et macOS.

## ChatCOM Desktop 1.0.0-rc.3

La candidate Windows fournit une interface locale supervisee pour le workflow
en lecture seule `WORK_LOCAL` vers `CODEX_LOCAL`. Elle guide le choix du projet,
de la phase, du point, de la mission et de la limite de cycles, puis affiche la
timeline bornee `MISSION -> REPORT -> NEXT_PROMPT` pour chaque cycle. Pause,
reprise, arret, diagnostics bornes et export JSON sont disponibles dans la
fenetre.

Le `ChatCOM Setup.exe` non signe est produit par l artefact CI Windows. Il ne
demande pas de droits administrateur, ne modifie pas le PATH et n ajoute pas la
configuration MCP a Codex. Les preferences restent dans les donnees utilisateur
Electron ; elles peuvent etre reinitialisees dans l interface ou supprimees
avec la desinstallation Windows. Le projet supervise n est jamais modifie par
le relay desktop et le renderer ne peut pas executer de commandes arbitraires.
Une preuve Codex reelle n est pas implicite dans l installateur ni dans les tests
synthetiques.

Commandes de developpement :

```powershell
npm run desktop:dev
npm run desktop:typecheck
npm run desktop:make
```

`desktop:make` cree l installateur Squirrel Windows dans `out-desktop`. Le
runtime Codex natif est inclus dans le paquet Windows ; un compte Codex
authentifie reste necessaire pour executer un relay. La CLI et le pont MCP
restent disponibles separement.

## Modèle de sécurité

- exécution du projet en lecture seule ;
- approbations désactivées ;
- arrêt après trois transmissions, avant une seconde mission Codex ;
- projet, phase, point, mission et instructions de rôles configurables ;
- aucune autorité utilisateur inventée ;
- diagnostics terminaux bornés, sans prompt, réponse, credential, message serveur ni stack.

L’API TypeScript restitue les trois enveloppes validées à son appelant. La CLI
n’affiche volontairement que des métadonnées de statut.

Le pont MCP restitue les enveloppes complètes comme contenu structuré. Son texte
ordinaire reste borné. `chatcom_run_relay` est déclaré comme action externe et
non idempotente afin que l’hôte exige une approbation explicite à chaque appel,
même si le dépôt inspecté reste en lecture seule.

## Prérequis

- Node.js 22 ou plus récent ;
- une installation Codex authentifiée et utilisable par le SDK Codex officiel ;
- un projet Git local à examiner.

## Installation

```powershell
npm install
npm run build
```

### Installation Windows simple

Depuis la racine du dépôt ou d’une archive préparée (`dist` doit déjà être
construit), installer ChatCOM pour l’utilisateur courant :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -AddToUserPath
```

L’installateur utilise `%LOCALAPPDATA%\ChatCOM`, n’exige pas de privilèges
administrateur, n’exécute pas les scripts npm des dépendances et n’active ni
Codex ni le relais. Une connexion Internet peut être nécessaire pour récupérer
les dépendances. L’installation fournit `chatcom` et `chatcom-mcp`, mais
n’ajoute pas automatiquement la configuration MCP à Codex. Ouvrir un nouveau
terminal après l’ajout au PATH, puis valider l’installation :

```powershell
chatcom validate --config .\relay.config.example.json
```

Un aperçu sans modification est disponible avec `-WhatIf`.

## Configuration

Copier `relay.config.example.json` puis définir la racine du projet et le routage :

```json
{
  "version": "1.0",
  "project_root": ".",
  "phase": "PHASE-1",
  "point": "POINT-1",
  "mission": "Examiner l’état courant du projet sans modifier les fichiers."
}
```

Valider sans démarrer Codex :

```powershell
node .\dist\portable-cli.js validate --config .\relay.config.example.json
```

Exécuter le relay uniquement après validation et autorisation explicite :

```powershell
node .\dist\portable-cli.js run --config .\relay.config.example.json --timeout-ms 600000
```

## API TypeScript

```ts
import { loadRelayConfig, runPortableRelay } from "chatcom";

const config = await loadRelayConfig("./relay.config.json");
const result = await runPortableRelay(config, { timeoutMs: 600_000 });

const [mission, report, nextPrompt] = result.relay.messages;
const cancellation = new AbortController();
const cancellable = runPortableRelay(config, { signal: cancellation.signal });
// Appeler cancellation.abort() depuis l’hôte pour arrêter la mission.
// Consommer les contenus validés par programme sans les imprimer dans les diagnostics bornés.
```

## Pont MCP

Si l’hôte MCP annule une requête, le signal d’annulation est propagé au flux
Codex et le nettoyage doit rester confirmé avant la fin de l’appel.

Compiler ChatCOM, puis copier
[`.codex/config.toml.example`](.codex/config.toml.example) dans une configuration
Codex approuvée et remplacer les chemins fictifs. Redémarrer l’hôte Codex après
toute modification de la configuration MCP.

Le serveur expose exactement deux outils :

- `chatcom_validate_config` valide la configuration sans démarrer Codex ;
- `chatcom_run_relay` exécute un relay autorisé à trois transmissions et
  restitue `MISSION`, `REPORT` et `NEXT_PROMPT` sous forme structurée.

Conserver `chatcom_run_relay` en mode d’approbation `prompt`. La sortie du
protocole MCP est le transport privé destiné à Work ; elle ne doit pas être
recopiée dans les diagnostics terminaux.

Pour démarrer directement le serveur STDIO :

```powershell
npm run build
npm run mcp
```

## Développement

```powershell
npm run build
npm run typecheck
npm test
npm run validate-config
npm run audit
npm run verify
```

Les commandes de diagnostic peuvent contacter un runtime Codex réel. Elles ne doivent pas être exécutées par les tests ordinaires ni sans autorisation explicite.

`1.0.0-rc.3` n’est pas une publication formelle. La création d’un tag, d’une
GitHub Release ou d’une publication npm exige une autorisation explicite séparée.
La procédure contrôlée est décrite dans [`RELEASING.md`](RELEASING.md).

## Desktop 1.0.0-rc.3

Desktop fournit des traductions statiques et hors ligne pour `fr-FR`, `en-US`,
`zh-CN` (chinois simplifié) et `ru-RU` (russe). Au premier démarrage, la
langue Windows est utilisée lorsqu’elle est prise en charge ; sinon le français
est utilisé. Le changement est immédiat dans Paramètres et est conservé dans
les préférences Electron versionnées.

Les paramètres proposent les thèmes Système/Clair/Sombre, les modes fenêtre
normale/maximisée/plein écran, les tailles de texte Petite/Normale/Grande, la
réduction des animations, le défilement automatique et une réinitialisation
sûre. `F11` active ou désactive le plein écran et `Échap` en sort. Les
préférences ne contiennent ni mission, contenu de message, diagnostic, token,
identifiant de thread ni réponse utilisateur. Les préférences RC.2 sont
migrées et les valeurs invalides reviennent à des valeurs sûres.

Chaque champ indique Obligatoire, Recommandé ou Optionnel, fournit une aide
pour débutant et affiche son erreur près du champ. Démarrer reste désactivé
tant que le formulaire et le préflight lecture seule sans modèle ne sont pas
valides.

L’installateur Windows est `ChatCOM-Desktop-1.0.0-rc.3-Setup.exe`. Il est
non signé, s’installe pour l’utilisateur, ne modifie pas PATH, ne configure pas
MCP et ne démarre aucun relais. L’artefact GitHub Actions exact est
`chatcom-desktop-1.0.0-rc.3-windows-x64` ; il contient l’installateur,
`SHA256SUMS.txt` et `desktop-build-manifest.json`. Il s’agit d’un résultat de
build et de tests synthétiques, pas d’une preuve réelle WORK ↔ Codex.

## Workflow Visual Studio Code

Utiliser [`CODEX-CHATCOM-PROMPT.md`](CODEX-CHATCOM-PROMPT.md) comme prompt
unique durable pour l’extension Codex. Il conduit une mission autonome complète
jusqu’à un seul compte rendu final destiné à Work.

## Origine

ChatCOM est extrait du relay générique Work ↔ Codex développé dans FitMyLife. Le code produit FitMyLife, les règles de compatibilité PC, l’interface web, les phases produit et l’historique de workflow FitMyLife ne font pas partie de ce dépôt.
