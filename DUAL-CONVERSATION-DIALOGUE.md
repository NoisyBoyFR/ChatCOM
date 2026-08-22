# ChatCOM RC.7 — dialogue entre deux conversations

RC.7 permet de sélectionner deux conversations Codex déjà existantes dans la
liste fournie par l’App Server officiel, puis de les relier dans un dialogue
borné supervisé par ChatCOM Desktop.

## Fonctionnement

1. ChatCOM initialise l’App Server et demande `thread/list` avec pagination.
2. Les conversations provenant de `cli`, `vscode`, `exec`, `appServer` ou
   `unknown` sont présentées avec un identifiant masqué.
3. L’utilisateur choisit une conversation WORK et une conversation CODEX,
   précise l’orateur initial et une limite de 1 à 10 cycles.
4. ChatCOM mémorise localement la paire et restaure uniquement la sélection au
   redémarrage. Il ne démarre jamais automatiquement un dialogue restauré.
5. Au démarrage explicite, ChatCOM appelle `thread/resume` sur les deux
   conversations puis enchaîne `turn/start` sur les threads exacts.

Chaque cycle initial produit `MISSION → REPORT → NEXT_PROMPT`. Les cycles
suivants produisent deux transmissions supplémentaires et s’arrêtent à la
limite choisie. Aucun thread sélectionné n’est créé, copié, forké ou supprimé.

## Sécurité

Les échanges restent en sandbox `read-only` avec `approvalPolicy: "never"`.
Les identifiants complets sont conservés uniquement dans le processus principal
et dans la sélection locale nécessaire à la reprise ; l’interface, les
diagnostics et les rapports utilisent des suffixes masqués. Les erreurs de
route, les doublons, les projets incompatibles, l’annulation et les échecs de
nettoyage sont traités en échec fermé.

La preuve réelle RC.7 n’est pas implicite : elle nécessitera une autorisation
distincte après la validation complète. La fonctionnalité de mise à jour
publique reste désactivée tant que la signature Authenticode, l’horodatage,
l’éditeur et les artefacts ne sont pas validés.
