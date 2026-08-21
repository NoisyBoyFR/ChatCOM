export const SUPPORTED_LOCALES = ["fr-FR", "en-US", "zh-CN", "ru-RU"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const french = {
  cancel: "Annuler",
  stopAndQuit: "Arrêter et quitter",
  closeWhileRunning: "ChatCOM doit terminer l’annulation et le nettoyage avant de quitter.",
  appTitle: "ChatCOM Desktop",
  eyebrow: "CHATCOM DESKTOP",
  headline: "Supervision locale WORK ↔ CODEX",
  subtitle: "WORK_LOCAL contrôle le relais local en lecture seule.",
  configuration: "Configuration guidée",
  project: "Projet supervisé",
  chooseProject: "Choisir le projet",
  projectPlaceholder: "Choisissez un dossier",
  phase: "Phase",
  phaseHelp: "Étape générale examinée. Exemple : CONCEPTION.",
  point: "Point",
  pointHelp: "Sujet précis à traiter. Exemple : INTERFACE.",
  mission: "Mission",
  missionHelp: "Demande exacte transmise à WORK_LOCAL, en lecture seule.",
  missionPlaceholder: "Décrivez une mission en lecture seule",
  maxCycles: "Nombre de cycles",
  cycleHelp: "Un cycle contient au maximum MISSION → REPORT → NEXT_PROMPT.",
  cycleTimeout: "Délai par cycle (ms)",
  cycleTimeoutHelp: "Arrête un cycle trop long.",
  globalTimeout: "Délai global (ms)",
  globalTimeoutHelp: "Limite la durée totale de la conversation.",
  required: "Obligatoire",
  recommended: "Recommandé",
  optional: "Optionnel",
  example: "Exemple",
  advanced: "Avancé",
  close: "Fermer",
  settings: "Paramètres",
  language: "Langue",
  theme: "Thème",
  themeSystem: "Système",
  themeLight: "Clair",
  themeDark: "Sombre",
  windowMode: "Mode de fenêtre",
  windowNormal: "Fenêtre normale",
  windowMaximized: "Fenêtre maximisée",
  windowFullscreen: "Plein écran",
  textSize: "Taille du texte",
  textSmall: "Petite",
  textNormal: "Normale",
  textLarge: "Grande",
  reduceMotion: "Réduire les animations",
  autoScroll: "Défilement automatique vers le dernier message",
  resetPreferences: "Restaurer les paramètres par défaut",
  resetConfirm: "Les paramètres d’affichage et les préférences locales seront réinitialisés. Le projet et les conversations externes ne seront pas supprimés. Continuer ?",
  resetDone: "Paramètres restaurés.",
  beginnerHelp: "Aide pour commencer",
  projectBeginner: "Dossier que WORK et Codex doivent examiner. ChatCOM ne le modifie pas.",
  startExplanationTitle: "Que se passe-t-il lorsque je clique sur Démarrer ?",
  startExplanation: "WORK prépare une mission, Codex prépare un rapport, WORK prépare la suite, puis le nettoyage est confirmé. Vous pouvez mettre en pause ou arrêter. Une décision importante exige votre intervention explicite.",
  preflight: "Pré-vérification sans modèle",
  runtime: "Runtime",
  authentication: "Authentification",
  security: "Sécurité",
  verifyConfig: "Vérifier la configuration",
  readOnly: "READ_ONLY",
  start: "Démarrer",
  pause: "Pause",
  resume: "Reprendre",
  stop: "Arrêter",
  copyDiagnostic: "Copier le diagnostic borné",
  exportReport: "Exporter le compte rendu",
  decisionTitle: "Décision utilisateur requise",
  decisionResponse: "Réponse",
  decisionPlaceholder: "Répondez explicitement à la question",
  submitDecision: "Valider ma décision",
  relayState: "État du relais",
  conversation: "Conversation",
  cycle: "Cycle",
  elapsed: "Temps écoulé",
  cleanup: "Nettoyage",
  session: "Session",
  notice: "Lecture seule permanente. ChatCOM ne modifie pas le projet supervisé et n’ajoute pas automatiquement de configuration MCP.",
  timeline: "Chronologie",
  showContent: "Afficher le contenu validé",
  ready: "Prêt.",
  projectSelected: "Projet sélectionné. Vérifiez la configuration avant de démarrer.",
  preflightReady: "Pré-vérification réussie. Le démarrage reste en lecture seule.",
  preflightRequired: "Pré-vérification requise avant le démarrage.",
  started: "Relais démarré.",
  paused: "Pause demandée : le cycle courant se termine proprement.",
  resumed: "Reprise demandée.",
  stopped: "Arrêt et nettoyage terminés.",
  cycleStarted: "Cycle {cycle} démarré.",
  cycleCompleted: "Cycle {cycle} terminé, nettoyage confirmé.",
  decisionNeeded: "Décision utilisateur requise : aucun cycle suivant ne démarre automatiquement.",
  decisionSaved: "Décision enregistrée. Reprenez explicitement pour lancer le cycle suivant.",
  interventionNeeded: "Une intervention est nécessaire.",
  diagnosticCopied: "Diagnostic borné copié.",
  noDiagnostic: "Aucun diagnostic à copier.",
  exportCanceled: "Export annulé.",
  exported: "Compte rendu exporté.",
  localeInvalid: "Locale non prise en charge.",
  fieldRequired: "Ce champ est obligatoire.",
  invalidNumber: "Saisissez un nombre valide.",
  projectRequired: "Sélectionnez un projet.",
  missionRequired: "Saisissez une mission.",
  phaseRequired: "Saisissez une phase.",
  pointRequired: "Saisissez un point.",
  cyclesRange: "Le nombre de cycles doit être compris entre 1 et 20.",
  settingsSaved: "Paramètres enregistrés.",
  settingsReset: "Paramètres réinitialisés.",
  accessibilityRequired: "Les champs marqués Obligatoire doivent être complétés.",
} as const;

type DictionaryKey = keyof typeof french;
type BridgeKey = "communicationStatus" | "workConnection" | "mcpConnection" | "codexLocal" | "communicationMode" | "realWorkHost" | "localSimulation" | "bridgeCleanup" | "workAuthManaged" | "mcpConnected" | "mcpNotConnected" | "codexReady" | "codexAuthRequired" | "codexError";
export type I18nKey = DictionaryKey | BridgeKey | "settingsSave" | "settingsCancel" | "settingsSaveFailed" | "autoUpdate" | "updateChannel" | "updateStable" | "updatePreview" | "updateStatus" | "checkUpdates" | "restartUpdate";
type Dictionary = Record<DictionaryKey, string>;

const english: Dictionary = {
  cancel: "Cancel", stopAndQuit: "Stop and quit", closeWhileRunning: "ChatCOM must finish cancellation and cleanup before quitting.",
  advanced: "Advanced", close: "Close",
  appTitle: "ChatCOM Desktop", eyebrow: "CHATCOM DESKTOP", headline: "Local WORK ↔ CODEX supervision", subtitle: "WORK_LOCAL controls the local read-only relay.", configuration: "Guided configuration", project: "Supervised project", chooseProject: "Choose project", projectPlaceholder: "Choose a folder", phase: "Phase", phaseHelp: "General step being reviewed. Example: DESIGN.", point: "Point", pointHelp: "Specific topic to handle. Example: INTERFACE.", mission: "Mission", missionHelp: "Exact request sent to WORK_LOCAL, read-only.", missionPlaceholder: "Describe a read-only mission", maxCycles: "Number of cycles", cycleHelp: "A cycle contains at most MISSION → REPORT → NEXT_PROMPT.", cycleTimeout: "Cycle timeout (ms)", cycleTimeoutHelp: "Stops an overly long cycle.", globalTimeout: "Global timeout (ms)", globalTimeoutHelp: "Limits the total conversation duration.", required: "Required", recommended: "Recommended", optional: "Optional", example: "Example", settings: "Settings", language: "Language", theme: "Theme", themeSystem: "System", themeLight: "Light", themeDark: "Dark", windowMode: "Window mode", windowNormal: "Normal window", windowMaximized: "Maximized window", windowFullscreen: "Fullscreen", textSize: "Text size", textSmall: "Small", textNormal: "Normal", textLarge: "Large", reduceMotion: "Reduce animations", autoScroll: "Auto-scroll to the latest message", resetPreferences: "Restore default settings", resetConfirm: "Display settings and local preferences will be reset. No project or external conversation will be deleted. Continue?", resetDone: "Settings restored.", beginnerHelp: "Getting started", projectBeginner: "Folder that WORK and Codex should inspect. ChatCOM does not modify it.", startExplanationTitle: "What happens when I click Start?", startExplanation: "WORK prepares a mission, Codex prepares a report, WORK prepares the next step, then cleanup is confirmed. You can pause or stop. An important decision requires your explicit intervention.", preflight: "No-model preflight", runtime: "Runtime", authentication: "Authentication", security: "Security", verifyConfig: "Verify configuration", readOnly: "READ_ONLY", start: "Start", pause: "Pause", resume: "Resume", stop: "Stop", copyDiagnostic: "Copy bounded diagnostic", exportReport: "Export report", decisionTitle: "User decision required", decisionResponse: "Response", decisionPlaceholder: "Explicitly answer the question", submitDecision: "Validate my decision", relayState: "Relay state", conversation: "Conversation", cycle: "Cycle", elapsed: "Elapsed time", cleanup: "Cleanup", session: "Session", notice: "Permanent read-only mode. ChatCOM does not modify the supervised project or automatically add MCP configuration.", timeline: "Timeline", showContent: "Show validated content", ready: "Ready.", projectSelected: "Project selected. Verify configuration before starting.", preflightReady: "Preflight succeeded. Start remains read-only.", preflightRequired: "Preflight is required before starting.", started: "Relay started.", paused: "Pause requested: the current cycle will finish cleanly.", resumed: "Resume requested.", stopped: "Stopped and cleaned up.", cycleStarted: "Cycle {cycle} started.", cycleCompleted: "Cycle {cycle} completed, cleanup confirmed.", decisionNeeded: "User decision required: no next cycle starts automatically.", decisionSaved: "Decision saved. Resume explicitly to start the next cycle.", interventionNeeded: "An intervention is required.", diagnosticCopied: "Bounded diagnostic copied.", noDiagnostic: "No diagnostic to copy.", exportCanceled: "Export canceled.", exported: "Report exported.", localeInvalid: "Unsupported locale.", fieldRequired: "This field is required.", invalidNumber: "Enter a valid number.", projectRequired: "Select a project.", missionRequired: "Enter a mission.", phaseRequired: "Enter a phase.", pointRequired: "Enter a point.", cyclesRange: "Cycles must be between 1 and 20.", settingsSaved: "Settings saved.", settingsReset: "Settings reset.", accessibilityRequired: "Fields marked Required must be completed.",
};

const chinese: Dictionary = {
  cancel: "取消", stopAndQuit: "停止并退出", closeWhileRunning: "ChatCOM 必须在退出前完成取消和清理。",
  advanced: "高级", close: "关闭",
  appTitle: "ChatCOM Desktop", eyebrow: "CHATCOM DESKTOP", headline: "本地 WORK ↔ CODEX 监督", subtitle: "WORK_LOCAL 控制本地只读中继。", configuration: "引导式配置", project: "受监督的项目", chooseProject: "选择项目", projectPlaceholder: "选择文件夹", phase: "阶段", phaseHelp: "正在检查的总体阶段。例如：设计。", point: "检查点", pointHelp: "要处理的具体主题。例如：界面。", mission: "任务", missionHelp: "发送给 WORK_LOCAL 的只读请求。", missionPlaceholder: "描述只读任务", maxCycles: "循环数量", cycleHelp: "每个循环最多包含 MISSION → REPORT → NEXT_PROMPT。", cycleTimeout: "单循环超时（毫秒）", cycleTimeoutHelp: "停止过长的循环。", globalTimeout: "全局超时（毫秒）", globalTimeoutHelp: "限制对话总时长。", required: "必填", recommended: "推荐", optional: "可选", example: "示例", settings: "设置", language: "语言", theme: "主题", themeSystem: "系统", themeLight: "浅色", themeDark: "深色", windowMode: "窗口模式", windowNormal: "普通窗口", windowMaximized: "最大化窗口", windowFullscreen: "全屏", textSize: "文字大小", textSmall: "小", textNormal: "正常", textLarge: "大", reduceMotion: "减少动画", autoScroll: "自动滚动到最新消息", resetPreferences: "恢复默认设置", resetConfirm: "显示设置和本地偏好将被重置。不会删除项目或外部对话。继续吗？", resetDone: "设置已恢复。", beginnerHelp: "入门帮助", projectBeginner: "WORK 和 Codex 要检查的文件夹。ChatCOM 不会修改它。", startExplanationTitle: "点击开始后会发生什么？", startExplanation: "WORK 准备任务，Codex 准备报告，WORK 准备下一步，然后确认清理。你可以暂停或停止。重要决定需要你的明确介入。", preflight: "无模型预检", runtime: "运行时", authentication: "身份验证", security: "安全", verifyConfig: "验证配置", readOnly: "READ_ONLY", start: "开始", pause: "暂停", resume: "继续", stop: "停止", copyDiagnostic: "复制有界诊断", exportReport: "导出报告", decisionTitle: "需要用户决定", decisionResponse: "回复", decisionPlaceholder: "明确回答问题", submitDecision: "确认我的决定", relayState: "中继状态", conversation: "对话", cycle: "循环", elapsed: "已用时间", cleanup: "清理", session: "会话", notice: "永久只读模式。ChatCOM 不会修改项目，也不会自动添加 MCP 配置。", timeline: "时间线", showContent: "显示已验证内容", ready: "就绪。", projectSelected: "已选择项目。开始前请验证配置。", preflightReady: "预检成功。启动仍为只读。", preflightRequired: "启动前需要预检。", started: "中继已开始。", paused: "已请求暂停：当前循环将正常完成。", resumed: "已请求继续。", stopped: "已停止并完成清理。", cycleStarted: "循环 {cycle} 已开始。", cycleCompleted: "循环 {cycle} 已完成，清理已确认。", decisionNeeded: "需要用户决定：不会自动开始下一个循环。", decisionSaved: "决定已保存。请明确继续以开始下一个循环。", interventionNeeded: "需要介入。", diagnosticCopied: "有界诊断已复制。", noDiagnostic: "没有可复制的诊断。", exportCanceled: "导出已取消。", exported: "报告已导出。", localeInvalid: "不支持的语言。", fieldRequired: "此字段为必填项。", invalidNumber: "请输入有效数字。", projectRequired: "请选择项目。", missionRequired: "请输入任务。", phaseRequired: "请输入阶段。", pointRequired: "请输入检查点。", cyclesRange: "循环数量必须在 1 到 20 之间。", settingsSaved: "设置已保存。", settingsReset: "设置已重置。", accessibilityRequired: "必须填写标记为必填的字段。",
};

const russian: Dictionary = {
  cancel: "Отмена", stopAndQuit: "Остановить и выйти", closeWhileRunning: "Перед выходом ChatCOM должен завершить отмену и очистку.",
  advanced: "Расширенные", close: "Закрыть",
  appTitle: "ChatCOM Desktop", eyebrow: "CHATCOM DESKTOP", headline: "Локальный контроль WORK ↔ CODEX", subtitle: "WORK_LOCAL управляет локальным реле только для чтения.", configuration: "Пошаговая настройка", project: "Контролируемый проект", chooseProject: "Выбрать проект", projectPlaceholder: "Выберите папку", phase: "Этап", phaseHelp: "Общий этап проверки. Например: ПРОЕКТИРОВАНИЕ.", point: "Точка", pointHelp: "Конкретная тема. Например: ИНТЕРФЕЙС.", mission: "Задание", missionHelp: "Точный запрос WORK_LOCAL в режиме только чтения.", missionPlaceholder: "Опишите задание только для чтения", maxCycles: "Количество циклов", cycleHelp: "Цикл содержит не более MISSION → REPORT → NEXT_PROMPT.", cycleTimeout: "Тайм-аут цикла (мс)", cycleTimeoutHelp: "Останавливает слишком долгий цикл.", globalTimeout: "Общий тайм-аут (мс)", globalTimeoutHelp: "Ограничивает общую длительность диалога.", required: "Обязательно", recommended: "Рекомендуется", optional: "Необязательно", example: "Пример", settings: "Настройки", language: "Язык", theme: "Тема", themeSystem: "Системная", themeLight: "Светлая", themeDark: "Тёмная", windowMode: "Режим окна", windowNormal: "Обычное окно", windowMaximized: "Развёрнутое окно", windowFullscreen: "Полный экран", textSize: "Размер текста", textSmall: "Маленький", textNormal: "Обычный", textLarge: "Большой", reduceMotion: "Уменьшить анимации", autoScroll: "Автопрокрутка к последнему сообщению", resetPreferences: "Восстановить настройки по умолчанию", resetConfirm: "Настройки отображения и локальные параметры будут сброшены. Проекты и внешние диалоги не удаляются. Продолжить?", resetDone: "Настройки восстановлены.", beginnerHelp: "Помощь для начала", projectBeginner: "Папка, которую должны проверить WORK и Codex. ChatCOM её не изменяет.", startExplanationTitle: "Что произойдёт после нажатия «Запустить»?", startExplanation: "WORK подготовит задание, Codex подготовит отчёт, WORK подготовит следующий шаг, затем будет подтверждена очистка. Можно поставить на паузу или остановить. Важное решение требует явного вмешательства.", preflight: "Проверка без модели", runtime: "Среда выполнения", authentication: "Аутентификация", security: "Безопасность", verifyConfig: "Проверить конфигурацию", readOnly: "READ_ONLY", start: "Запустить", pause: "Пауза", resume: "Продолжить", stop: "Остановить", copyDiagnostic: "Копировать ограниченную диагностику", exportReport: "Экспортировать отчёт", decisionTitle: "Требуется решение пользователя", decisionResponse: "Ответ", decisionPlaceholder: "Явно ответьте на вопрос", submitDecision: "Подтвердить решение", relayState: "Состояние реле", conversation: "Диалог", cycle: "Цикл", elapsed: "Прошло времени", cleanup: "Очистка", session: "Сессия", notice: "Постоянный режим только для чтения. ChatCOM не изменяет проект и не добавляет конфигурацию MCP автоматически.", timeline: "Хронология", showContent: "Показать проверенное содержимое", ready: "Готово.", projectSelected: "Проект выбран. Проверьте конфигурацию перед запуском.", preflightReady: "Проверка успешна. Запуск остаётся только для чтения.", preflightRequired: "Перед запуском требуется проверка.", started: "Реле запущено.", paused: "Запрошена пауза: текущий цикл завершится корректно.", resumed: "Запрошено продолжение.", stopped: "Остановлено и очищено.", cycleStarted: "Цикл {cycle} запущен.", cycleCompleted: "Цикл {cycle} завершён, очистка подтверждена.", decisionNeeded: "Требуется решение: следующий цикл автоматически не запускается.", decisionSaved: "Решение сохранено. Явно продолжите для запуска следующего цикла.", interventionNeeded: "Требуется вмешательство.", diagnosticCopied: "Ограниченная диагностика скопирована.", noDiagnostic: "Нет диагностики для копирования.", exportCanceled: "Экспорт отменён.", exported: "Отчёт экспортирован.", localeInvalid: "Неподдерживаемая локаль.", fieldRequired: "Поле обязательно.", invalidNumber: "Введите корректное число.", projectRequired: "Выберите проект.", missionRequired: "Введите задание.", phaseRequired: "Введите этап.", pointRequired: "Введите точку.", cyclesRange: "Число циклов должно быть от 1 до 20.", settingsSaved: "Настройки сохранены.", settingsReset: "Настройки сброшены.", accessibilityRequired: "Заполните поля, отмеченные как обязательные.",
};

export const DICTIONARIES = { "fr-FR": french, "en-US": english, "zh-CN": chinese, "ru-RU": russian } as const satisfies Record<Locale, Dictionary>;

const settingsTranslations: Record<Locale, Record<"settingsSave" | "settingsCancel" | "settingsSaveFailed", string>> = {
  "fr-FR": { settingsSave: "Sauvegarder", settingsCancel: "Annuler", settingsSaveFailed: "Impossible d’enregistrer les paramètres." },
  "en-US": { settingsSave: "Save", settingsCancel: "Cancel", settingsSaveFailed: "Settings could not be saved." },
  "zh-CN": { settingsSave: "\u4fdd\u5b58", settingsCancel: "\u53d6\u6d88", settingsSaveFailed: "\u65e0\u6cd5\u4fdd\u5b58\u8bbe\u7f6e\u3002" },
  "ru-RU": { settingsSave: "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c", settingsCancel: "\u041e\u0442\u043c\u0435\u043d\u0430", settingsSaveFailed: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043d\u0430с\u0442ро\u0439ки." },
};

const updateTranslations: Record<Locale, Record<"autoUpdate" | "updateChannel" | "updateStable" | "updatePreview" | "updateStatus" | "checkUpdates" | "restartUpdate", string>> = {
  "fr-FR": { autoUpdate: "Mises à jour automatiques", updateChannel: "Canal de mise à jour", updateStable: "Stable", updatePreview: "Préversion", updateStatus: "État des mises à jour", checkUpdates: "Vérifier maintenant", restartUpdate: "Redémarrer et installer" },
  "en-US": { autoUpdate: "Automatic updates", updateChannel: "Update channel", updateStable: "Stable", updatePreview: "Preview", updateStatus: "Update status", checkUpdates: "Check now", restartUpdate: "Restart and install" },
  "zh-CN": { autoUpdate: "\u81ea\u52a8\u66f4\u65b0", updateChannel: "\u66f4\u65b0\u6e20\u9053", updateStable: "\u7a33\u5b9a\u7248", updatePreview: "\u9884\u89c8\u7248", updateStatus: "\u66f4\u65b0\u72b6\u6001", checkUpdates: "\u7acb\u5373\u68c0\u67e5", restartUpdate: "\u91cd\u65b0\u542f\u52a8\u5e76\u5b89\u88c5" },
  "ru-RU": { autoUpdate: "\u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f", updateChannel: "\u041a\u0430\u043d\u0430\u043b \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0439", updateStable: "\u0421\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u0430\u044f", updatePreview: "\u041f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f", updateStatus: "\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0439", checkUpdates: "\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0441\u0435\u0439\u0447\u0430\u0441", restartUpdate: "\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0438 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c" },
};

const bridgeTranslations: Record<Locale, Record<BridgeKey, string>> = {
  "fr-FR": { communicationStatus: "Communication", workConnection: "WORK", mcpConnection: "ChatCOM MCP", codexLocal: "Codex local", communicationMode: "Mode de communication", realWorkHost: "REAL_WORK_HOST", localSimulation: "LOCAL_SIMULATION", bridgeCleanup: "Nettoyage", workAuthManaged: "Connexion gérée par l’application OpenAI", mcpConnected: "CONNECTED", mcpNotConnected: "NOT_CONNECTED", codexReady: "READY", codexAuthRequired: "AUTH_REQUIRED", codexError: "ERROR" },
  "en-US": { communicationStatus: "Communication", workConnection: "WORK", mcpConnection: "ChatCOM MCP", codexLocal: "Local Codex", communicationMode: "Communication mode", realWorkHost: "REAL_WORK_HOST", localSimulation: "LOCAL_SIMULATION", bridgeCleanup: "Cleanup", workAuthManaged: "Connection managed by the OpenAI application", mcpConnected: "CONNECTED", mcpNotConnected: "NOT_CONNECTED", codexReady: "READY", codexAuthRequired: "AUTH_REQUIRED", codexError: "ERROR" },
  "zh-CN": { communicationStatus: "通信", workConnection: "WORK", mcpConnection: "ChatCOM MCP", codexLocal: "本地 Codex", communicationMode: "通信模式", realWorkHost: "REAL_WORK_HOST", localSimulation: "LOCAL_SIMULATION", bridgeCleanup: "清理", workAuthManaged: "连接由 OpenAI 应用管理", mcpConnected: "CONNECTED", mcpNotConnected: "NOT_CONNECTED", codexReady: "READY", codexAuthRequired: "AUTH_REQUIRED", codexError: "ERROR" },
  "ru-RU": { communicationStatus: "Связь", workConnection: "WORK", mcpConnection: "ChatCOM MCP", codexLocal: "Локальный Codex", communicationMode: "Режим связи", realWorkHost: "REAL_WORK_HOST", localSimulation: "LOCAL_SIMULATION", bridgeCleanup: "Очистка", workAuthManaged: "Подключение управляется приложением OpenAI", mcpConnected: "CONNECTED", mcpNotConnected: "NOT_CONNECTED", codexReady: "READY", codexAuthRequired: "AUTH_REQUIRED", codexError: "ERROR" },
};

export function isSupportedLocale(value: unknown): value is Locale { return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value); }
export function normalizeLocale(value: unknown): Locale | undefined {
  if (isSupportedLocale(value)) return value;
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === lower || locale.slice(0, 2).toLowerCase() === lower.slice(0, 2));
}
export function detectLocale(value: string | undefined): Locale { return normalizeLocale(value) ?? "fr-FR"; }
export function dictionary(locale: Locale): Dictionary { return DICTIONARIES[locale]; }
export function translate(locale: Locale, key: I18nKey, params: Record<string, string | number> = {}): string {
  const value = key in bridgeTranslations[locale]
    ? bridgeTranslations[locale][key as BridgeKey]
    : key in settingsTranslations[locale]
    ? settingsTranslations[locale][key as "settingsSave" | "settingsCancel" | "settingsSaveFailed"]
    : key in updateTranslations[locale]
      ? updateTranslations[locale][key as "autoUpdate" | "updateChannel" | "updateStable" | "updatePreview" | "updateStatus" | "checkUpdates" | "restartUpdate"]
    : dictionary(locale)[key as DictionaryKey];
  return value.replace(/\{(\w+)\}/gu, (_, name: string) => String(params[name] ?? `{${name}}`));
}
