# ChatCOM

ChatCOM est un relay local réutilisable pour une communication structurée entre un rôle de revue Work et un rôle technique Codex.

[English version](README.md)

## État actuel

Le noyau réutilisable a été séparé de FitMyLife dans un projet autonome. La configuration, le contrat de messages, le routage, le nettoyage, les diagnostics bornés, l’adaptateur Codex SDK, le fallback App Server et les tests synthétiques sont disponibles.

ChatCOM n’est pas encore déclaré opérationnel pour une utilisation réelle sans présence humaine. Une preuve réelle de bout en bout réussie et une revue indépendante restent obligatoires.

La baseline autonome extraite réussit actuellement 66 tests déterministes, ainsi que le build, le typecheck, la validation de configuration et le contrôle d’archive à blanc.

## Modèle de sécurité

- exécution du projet en lecture seule ;
- approbations désactivées ;
- arrêt après trois transmissions, avant une seconde mission Codex ;
- projet, phase, point, mission et instructions de rôles configurables ;
- aucune autorité utilisateur inventée ;
- diagnostics terminaux bornés, sans prompt, réponse, credential, message serveur ni stack.

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
```

## Développement

```powershell
npm run build
npm run typecheck
npm test
npm run validate-config
```

Les commandes de diagnostic peuvent contacter un runtime Codex réel. Elles ne doivent pas être exécutées par les tests ordinaires ni sans autorisation explicite.

## Origine

ChatCOM est extrait du relay générique Work ↔ Codex développé dans FitMyLife. Le code produit FitMyLife, les règles de compatibilité PC, l’interface web, les phases produit et l’historique de workflow FitMyLife ne font pas partie de ce dépôt.
