# ChatCOM

ChatCOM est un relay local réutilisable pour une communication structurée entre un rôle de revue Work et un rôle technique Codex.

[English version](README.md)

## État actuel

Le noyau réutilisable a été séparé de FitMyLife dans un projet autonome. La configuration, le contrat de messages, le routage, le nettoyage, les diagnostics bornés, l’adaptateur Codex SDK, le fallback App Server et les tests synthétiques sont disponibles.

ChatCOM v0.2.0 est opérationnel pour son workflow local borné. Le cycle de vie
Codex SDK authentifié, le relay complet Work ↔ Codex à trois transmissions et
le fallback App Server ont réussi avec un nettoyage confirmé. Les preuves
terminales sûres sont consignées dans [`.ai/PROOF.md`](.ai/PROOF.md).

La baseline opérationnelle réussit 66 tests déterministes, le build, le
typecheck, la validation de configuration, le contrôle d’archive à blanc et
l’audit des dépendances de production.

## Modèle de sécurité

- exécution du projet en lecture seule ;
- approbations désactivées ;
- arrêt après trois transmissions, avant une seconde mission Codex ;
- projet, phase, point, mission et instructions de rôles configurables ;
- aucune autorité utilisateur inventée ;
- diagnostics terminaux bornés, sans prompt, réponse, credential, message serveur ni stack.

L’API TypeScript restitue les trois enveloppes validées à son appelant. La CLI
n’affiche volontairement que des métadonnées de statut.

## Prérequis

- Node.js 22 ou plus récent ;
- une installation Codex authentifiée et utilisable par le SDK Codex officiel ;
- un projet Git local à examiner.

## Installation

```powershell
npm install
npm run build
```

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
// Consommer les contenus validés par programme sans les imprimer dans les diagnostics bornés.
```

## Développement

```powershell
npm run build
npm run typecheck
npm test
npm run validate-config
npm run verify
```

Les commandes de diagnostic peuvent contacter un runtime Codex réel. Elles ne doivent pas être exécutées par les tests ordinaires ni sans autorisation explicite.

## Workflow Visual Studio Code

Utiliser [`CODEX-CHATCOM-PROMPT.md`](CODEX-CHATCOM-PROMPT.md) comme prompt
unique durable pour l’extension Codex. Il conduit une mission autonome complète
jusqu’à un seul compte rendu final destiné à Work.

## Origine

ChatCOM est extrait du relay générique Work ↔ Codex développé dans FitMyLife. Le code produit FitMyLife, les règles de compatibilité PC, l’interface web, les phases produit et l’historique de workflow FitMyLife ne font pas partie de ce dépôt.
