// Human-play controller: clocks, turn buffers, round status, HUD, and persistence.

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const translations = {
    'zh-CN': {
      controller: "控制方式",
      humanAgent: "玩家操控",
      randomAgent: "随机 AI",
      heuristicAgent: "启发式 AI",
      episodeStats: "回合统计",
      episodeNumber: "回合",
      stepsSurvived: "存活步数",
      foodCollected: "食物数量",
      causeOfDeath: "死亡原因",
      death_wall: "撞墙",
      death_self: "撞到自身",
      death_none: "—",
      agentSettings: "AI 运行设置",
      aiSpeed: "AI 速度",
      normalSpeed: "正常速度",
      headless: "关闭棋盘渲染（无界面运行）",
      headlessNote: "棋盘渲染已关闭，统计数据仍会更新。",
      autoRestart: "自动开始下一轮 AI 回合",
      agentHint: "切换控制方式将重置本局。AI 速度仅影响 AI 棋盘；自动开始下一轮需要所有启用的棋盘均由 AI 控制。",
      languageLabel: '语言 / Language',
      pageTitle: '像素贪吃蛇 · PIXEL SNAKE', subtitle: '霓虹街机 · 像素贪吃蛇', best: '最高纪录',
      coins: '金币', shop: '皮肤商店', close: '关闭', equipFor: '装备给',
      shopIntro: '每吃一个果子获得 5 金币，两位玩家共享钱包。解锁你喜欢的霓虹皮肤。',
      shopFooter: '皮肤仅改变外观。打开商店会暂停游戏，关闭后点击继续。',
      skin_lime: '电光青柠', skin_cyan: '极光冰蓝', skin_pink: '霓虹樱粉', skin_violet: '紫电魅影', skin_solar: '熔金日冕', skin_prism: '幻彩脉冲',
      skin_solid_cyan: '纯色冰蓝', skin_solid_pink: '纯色樱粉', skin_solid_white: '纯色月白',
      boostHint: '沿当前前进方向长按方向键或虚拟按键 0.5 秒，加速至 10 格/秒；松开或转向后恢复。', boosted: '加速中',
      free: '免费', owned: '已拥有', equipped: '已装备', equip: '装备', unlock: '解锁 · {price}',
      coinPrice: '{price} 金币', needCoins: '还差 {amount} 金币',
      skinUnlocked: '已解锁「{skin}」，并装备给{player}。', skinEquipped: '{player}已装备「{skin}」。',
      storageNotice: '浏览器未允许本地保存，本次获得的金币和皮肤仍可使用。',
      gameArea: '游戏区域', board: '{player}的贪吃蛇棋盘', canvasFallback: '请使用支持 Canvas 的浏览器。',
      ready: '准备好了吗？', title: '像素贪吃蛇', intro: '吃掉食物，不断长大。\n小心墙壁和自己的身体！', start: '开始游戏', startBoth: '同时开始',
      singleInstructions: '方向键 / WASD 移动 · 空格暂停\n手机可滑动棋盘或使用方向按钮',
      dualInstructions: '玩家 1：WASD · 玩家 2：方向键\n空格同时暂停 / 继续，也可分别滑动棋盘',
      score: '得分', length: '长度', speed: '速度', speedValue: '{speed} 格/秒',
      mode: '游戏模式', single: '单人模式', dual: '双人模式', modeHint: '切换模式会重置本局，点击开始后同时出发。',
      rules: '玩法说明', speedHint: '初始每秒 4 格，每吃一个果子增加 0.1 格/秒，最高 10 格/秒。',
      dualRules: '两人独立计分、独立加速。一方结束后，另一方可继续；两人都结束后比较得分。',
      pause: '暂停', resume: '继续', restart: '重新开始', directions: '方向控制',
      up: '向上', down: '向下', left: '向左', right: '向右', startPause: '开始 / 暂停', space: '空格',
      paused: '已暂停', pauseHint: '休息一下，准备好后继续。', resumeGame: '继续游戏',
      won: 'YOU WIN, 100%', over: '游戏结束', newRecord: '新纪录！', again: '再玩一次',
      player1: '玩家 1', player2: '玩家 2', playing: '游戏中', waiting: '另一位玩家仍在游戏中',
      roundScore: '得分：{score}',
      canvasError: '无法创建游戏画布，请使用支持 Canvas 的浏览器。'
    },
    en: {
      controller: "Controller",
      humanAgent: "Human",
      randomAgent: "Random AI",
      heuristicAgent: "Heuristic AI",
      episodeStats: "Episode statistics",
      episodeNumber: "Episode",
      stepsSurvived: "Steps survived",
      foodCollected: "Food collected",
      causeOfDeath: "Cause of death",
      death_wall: "Wall",
      death_self: "Self collision",
      death_none: "—",
      agentSettings: "AI execution",
      aiSpeed: "AI speed",
      normalSpeed: "Normal",
      headless: "Disable board rendering (headless)",
      headlessNote: "Board rendering is disabled. Statistics remain live.",
      autoRestart: "Auto-restart AI episodes",
      agentHint: "Changing controller resets the round. AI speed affects AI boards only. Auto-restart requires every active board to use AI.",
      languageLabel: 'Language',
      pageTitle: 'Pixel Snake', subtitle: 'Neon arcade · Pixel classic', best: 'Best score',
      coins: 'Coins', shop: 'Skin shop', close: 'Close', equipFor: 'Equip for',
      shopIntro: 'Earn 5 coins per fruit. Both players share a wallet. Unlock your favorite neon skins.',
      shopFooter: 'Skins are cosmetic. Opening the shop pauses the game; close it and press Resume to continue.',
      skin_lime: 'Electric Lime', skin_cyan: 'Arctic Cyan', skin_pink: 'Neon Sakura', skin_violet: 'Violet Phantom', skin_solar: 'Solar Gold', skin_prism: 'Prism Pulse',
      skin_solid_cyan: 'Solid Cyan', skin_solid_pink: 'Solid Pink', skin_solid_white: 'Solid Moonlight',
      boostHint: 'Hold the key or on-screen button for your current direction for 0.5 seconds to boost to 10 cells/s. Release or turn to return to normal speed.', boosted: 'BOOST',
      free: 'Free', owned: 'Owned', equipped: 'Equipped', equip: 'Equip', unlock: 'Unlock · {price}',
      coinPrice: '{price} coins', needCoins: 'Need {amount} more coins',
      skinUnlocked: 'Unlocked {skin} and equipped it for {player}.', skinEquipped: '{player} equipped {skin}.',
      storageNotice: 'Local saving is unavailable. Coins and skins still work for this session.',
      gameArea: 'Game area', board: '{player} snake board', canvasFallback: 'Please use a browser that supports Canvas.',
      ready: 'Ready to play?', title: 'Pixel Snake', intro: 'Eat food and grow longer.\nAvoid the walls and your own tail!', start: 'Start game', startBoth: 'Start both',
      singleInstructions: 'Arrow keys / WASD to move · Space to pause\nOn mobile, swipe the board or use the direction buttons',
      dualInstructions: 'Player 1: WASD · Player 2: Arrow keys\nSpace pauses / resumes both. You can also swipe each board.',
      score: 'Score', length: 'Length', speed: 'Speed', speedValue: '{speed} cells/s',
      mode: 'Game mode', single: 'Single player', dual: 'Two players', modeHint: 'Switching modes resets the round. Both players start together.',
      rules: 'How to play', speedHint: 'Start at 4 cells/s. Each fruit adds 0.1 cells/s, up to 10 cells/s.',
      dualRules: 'Separate scores and speeds. If one player finishes, the other keeps playing. Compare scores when both finish.',
      pause: 'Pause', resume: 'Resume', restart: 'Restart', directions: 'Direction controls',
      up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', startPause: 'Start / Pause', space: 'Space',
      paused: 'Paused', pauseHint: 'Take a break. Resume when you are ready.', resumeGame: 'Resume game',
      won: 'YOU WIN, 100%', over: 'Game over', newRecord: 'New record!', again: 'Play again',
      player1: 'Player 1', player2: 'Player 2', playing: 'Playing', waiting: 'The other player is still playing',
      roundScore: 'Score: {score}',
      canvasError: 'Unable to create the game canvas. Please use a browser that supports Canvas.'
    },
    fr: {
      controller: "Contrôle",
      humanAgent: "Humain",
      randomAgent: "IA aléatoire",
      heuristicAgent: "IA heuristique",
      episodeStats: "Statistiques de la partie",
      episodeNumber: "Partie",
      stepsSurvived: "Pas survécus",
      foodCollected: "Fruits mangés",
      causeOfDeath: "Cause de la mort",
      death_wall: "Mur",
      death_self: "Collision avec soi",
      death_none: "—",
      agentSettings: "Exécution IA",
      aiSpeed: "Vitesse IA",
      normalSpeed: "Normale",
      headless: "Désactiver le rendu du plateau",
      headlessNote: "Rendu désactivé. Les statistiques restent actives.",
      autoRestart: "Relancer les parties IA",
      agentHint: "Changer le contrôle réinitialise la partie. La vitesse IA concerne seulement les plateaux IA. La relance exige que tous les plateaux actifs utilisent une IA.",
      languageLabel: 'Langue',
      pageTitle: 'Serpent pixel', subtitle: 'Arcade néon · Classique en pixels', best: 'Meilleur score',
      coins: 'Pièces', shop: 'Boutique', close: 'Fermer', equipFor: 'Équiper pour',
      shopIntro: 'Gagnez 5 pièces par fruit. Les deux joueurs partagent leurs pièces. Débloquez vos apparences néon préférées.',
      shopFooter: 'Les apparences sont purement visuelles. La boutique met le jeu en pause. Fermez-la, puis cliquez sur Reprendre.',
      skin_lime: 'Citron électrique', skin_cyan: 'Cyan arctique', skin_pink: 'Sakura néon', skin_violet: 'Fantôme violet', skin_solar: 'Or solaire', skin_prism: 'Prisme vibrant',
      skin_solid_cyan: 'Cyan uni', skin_solid_pink: 'Rose uni', skin_solid_white: 'Blanc uni',
      boostHint: 'Maintenez la touche ou le bouton de la direction actuelle pendant 0,5 seconde pour atteindre 10 cases/s. Relâchez ou tournez pour revenir à la vitesse normale.', boosted: 'TURBO',
      free: 'Gratuit', owned: 'Débloqué', equipped: 'Équipé', equip: 'Équiper', unlock: 'Débloquer · {price}',
      coinPrice: '{price} pièces', needCoins: 'Il manque {amount} pièces',
      skinUnlocked: 'Apparence « {skin} » débloquée et équipée pour {player}.', skinEquipped: '{player} utilise « {skin} ».',
      storageNotice: 'La sauvegarde locale est indisponible. Les pièces et les apparences restent utilisables pendant cette session.',
      gameArea: 'Zone de jeu', board: 'Plateau de {player}', canvasFallback: 'Utilisez un navigateur compatible avec Canvas.',
      ready: 'Prêt à jouer ?', title: 'Serpent pixel', intro: 'Mangez des fruits pour grandir.\nÉvitez les murs et votre propre corps !', start: 'Jouer', startBoth: 'Jouer à deux',
      singleInstructions: 'Flèches / WASD pour bouger · Espace pour la pause\nSur mobile, balayez le plateau ou utilisez les boutons de direction.',
      dualInstructions: 'Joueur 1 : WASD · Joueur 2 : flèches\nEspace met les deux joueurs en pause ou reprend la partie. Vous pouvez aussi balayer chaque plateau.',
      score: 'Score', length: 'Longueur', speed: 'Vitesse', speedValue: '{speed} cases/s',
      mode: 'Mode de jeu', single: 'Solo', dual: 'Deux joueurs', modeHint: 'Changer de mode réinitialise la partie. Les deux joueurs démarrent ensemble.',
      rules: 'Comment jouer', speedHint: 'Départ à 4 cases/s. Chaque fruit ajoute 0,1 case/s, jusqu’à 10 cases/s.',
      dualRules: 'Scores et vitesses indépendants. Si un joueur termine, l’autre continue. Comparez les scores à la fin.',
      pause: 'Pause', resume: 'Reprendre', restart: 'Recommencer', directions: 'Commandes de direction',
      up: 'Aller en haut', down: 'Aller en bas', left: 'Aller à gauche', right: 'Aller à droite', startPause: 'Jouer / Pause', space: 'Espace',
      paused: 'En pause', pauseHint: 'Faites une pause. Reprenez quand vous voulez.', resumeGame: 'Reprendre',
      won: 'YOU WIN, 100%', over: 'Partie terminée', newRecord: 'Nouveau record !', again: 'Rejouer',
      player1: 'Joueur 1', player2: 'Joueur 2', playing: 'En jeu', waiting: 'L’autre joueur joue encore',
      roundScore: 'Score : {score}',
      canvasError: 'Impossible de créer le plateau de jeu. Utilisez un navigateur compatible avec Canvas.'
    }
  };
  const localTranslations = {"zh-CN": {"dqnAgent": "DQN", "qwenAgent": "Qwen（本机）", "safetyAssist": "防困辅助（所有 AI）", "dqnModel": "DQN 模型", "refreshModels": "连接 / 刷新模型", "trainingHint": "选择已有模型继续训练，或从零开始。episode 数是本次追加数量。Qwen 不参与训练。", "trainingSource": "起始模型", "newModel": "从零开始", "trainingEpisodes": "追加 episodes", "saveEvery": "保存间隔", "trainingSeed": "种子（新模型）", "trainingStart": "开始训练", "trainingStop": "停止并保存", "trainingSaveHint": "模型保存在 models/。2000_model.pt 追加 500 回合后生成 2500_model.pt。同名文件保留在独立目录。", "localOffline": "DQN / Qwen / Training 需要本机服务。请双击项目目录里的 Start-PixelSnake.cmd，并使用它自动打开的页面。直接打开 HTML 无法加载模型。", "localOnline": "本机服务已连接 · {count} 个模型", "thinking": "正在等待 {type} 决策…", "decisionReady": "决策 {ms} ms{fallback} · 防困调整 {count} 次", "fallbackNote": "（回退动作）", "aiError": "AI 暂停等待：{error}", "trainingIdle": "尚未训练。停止将在当前 episode 完成后保存。", "trainingRunning": "状态 {state} · episode {episode} / {target}\n分数 {score} · 均分 {average} · epsilon {epsilon}\n已保存：{saved}", "trainingFailed": "训练失败：{error}", "notSaved": "尚未保存", "resumedLegacy": "旧模型：重新积累经验回放", "resumeFull": "完整续训状态"}, "en": {"dqnAgent": "DQN", "qwenAgent": "Qwen (local)", "safetyAssist": "Trap avoidance assistance (all AI)", "dqnModel": "DQN model", "refreshModels": "Connect / refresh models", "trainingHint": "Continue an existing model or start fresh. Episodes are additional training episodes. Qwen is inference only.", "trainingSource": "Starting model", "newModel": "New model", "trainingEpisodes": "Add episodes", "saveEvery": "Save every", "trainingSeed": "Seed (new model)", "trainingStart": "Start training", "trainingStop": "Stop and save", "trainingSaveHint": "Saved in models/: 2000_model.pt + 500 episodes becomes 2500_model.pt. Name collisions use separate run folders.", "localOffline": "DQN / Qwen / Training need the local service. Double-click Start-PixelSnake.cmd in the project folder and use the page it opens. Opening the HTML file directly cannot load models.", "localOnline": "Local service connected · {count} models", "thinking": "Waiting for {type} decision…", "decisionReady": "Decision {ms} ms{fallback} · safety overrides {count}", "fallbackNote": " (fallback)", "aiError": "AI waiting: {error}", "trainingIdle": "No training yet. Stop saves after the current episode.", "trainingRunning": "State {state} · episode {episode} / {target}\nScore {score} · moving mean {average} · epsilon {epsilon}\nSaved: {saved}", "trainingFailed": "Training failed: {error}", "notSaved": "Not saved yet", "resumedLegacy": "Legacy model: replay starts empty", "resumeFull": "Full resume state"}, "fr": {"dqnAgent": "DQN", "qwenAgent": "Qwen (local)", "safetyAssist": "Assistance anti-piège (toutes les IA)", "dqnModel": "Modèle DQN", "refreshModels": "Connecter / actualiser", "trainingHint": "Reprendre un modèle ou repartir de zéro. Le nombre indique les épisodes supplémentaires. Qwen ne fait que des inférences.", "trainingSource": "Modèle initial", "newModel": "Nouveau modèle", "trainingEpisodes": "Ajouter épisodes", "saveEvery": "Sauver tous les", "trainingSeed": "Graine (nouveau)", "trainingStart": "Entraîner", "trainingStop": "Arrêter et sauver", "trainingSaveHint": "Sauvé dans models/ : 2000_model.pt + 500 épisodes donne 2500_model.pt. Les doublons utilisent un dossier distinct.", "localOffline": "DQN / Qwen / Training nécessitent le service local. Lancez Start-PixelSnake.cmd dans le dossier du projet et utilisez la page ouverte. Un fichier HTML ouvert directement ne peut pas charger les modèles.", "localOnline": "Service local connecté · {count} modèles", "thinking": "Décision {type} en attente…", "decisionReady": "Décision {ms} ms{fallback} · corrections {count}", "fallbackNote": " (repli)", "aiError": "IA en attente : {error}", "trainingIdle": "Aucun entraînement. Arrêt sauvegardé après cet épisode.", "trainingRunning": "État {state} · épisode {episode} / {target}\nScore {score} · moyenne {average} · epsilon {epsilon}\nSauvé : {saved}", "trainingFailed": "Échec : {error}", "notSaved": "Pas encore sauvé", "resumedLegacy": "Ancien modèle : mémoire vide", "resumeFull": "Reprise complète"}};
  localTranslations['zh-CN'].noModels = '没有找到可读取的模型。请将 .pt 模型连同 models 子文件夹一起复制到当前项目目录，然后刷新。';
  localTranslations.en.noModels = 'No readable models found. Copy the models folder and its .pt files into this project, then refresh.';
  localTranslations.fr.noModels = 'Aucun modèle lisible. Copiez le dossier models avec ses fichiers .pt dans ce projet, puis actualisez.';
  for (const lang of Object.keys(translations)) Object.assign(translations[lang], localTranslations[lang]);
  const rewardTranslations={
    'zh-CN':{rewardProfile:'奖励 / 行走方案',rewardClassic:'classic · 基础型',rewardStrategy:'strategy · 策略型',rewardUltimate:'ultimate · 铺满型',rewardHint:'classic：吃食物 +10，撞击 −10，每步 −0.01。strategy：再鼓励接近食物、保留退路，惩罚重复绕圈和多余转弯。ultimate：使用 strategy 训练奖励，加上超过 50% 后逐行铺满的浏览器规则（需开启防困辅助）。改变训练奖励会清空旧经验回放。',rewardReset:'奖励已切换：旧经验回放已清空',trainingSeed:'随机种子 Seed（默认 42）',seedHint:'Seed 控制食物分布、初始权重和训练探索的随机性。同样设置和种子便于复现实验；不是难度，不懂就用 42。续训沿用原模型种子，此项不可修改。',trainingSaveHint:'自动保存到 models/classic、models/strategy 或 models/ultimate。文件名带本机日期、时间和累计回合数，例如 2026-09-12_14-30-00-123456_ep2400.pt。'},
    en:{rewardProfile:'Reward / movement scheme',rewardClassic:'classic · Basic',rewardStrategy:'strategy · Strategic',rewardUltimate:'ultimate · Board filling',rewardHint:'classic: food +10, collision −10, step −0.01. strategy: also rewards food progress and escape space, penalizes loops and extra turns. ultimate: strategy training rewards plus a browser sweep above 50% (assistance required). Changing numeric rewards clears replay.',rewardReset:'Reward changed: old replay cleared',trainingSeed:'Random seed (default 42)',seedHint:'Controls food, initial weights and exploration randomness. Matching settings and seeds help reproduce a run. It is not difficulty; keep 42 if unsure. Resuming keeps the source seed and disables this field.',trainingSaveHint:'Saved under models/classic, models/strategy or models/ultimate. Names include local date, time and cumulative episodes, e.g. 2026-09-12_14-30-00-123456_ep2400.pt.'},
    fr:{rewardProfile:'Récompenses / déplacement',rewardClassic:'classic · Base',rewardStrategy:'strategy · Stratégie',rewardUltimate:'ultimate · Remplissage',rewardHint:'classic : fruit +10, collision −10, pas −0,01. strategy : progression vers le fruit et espace de sortie, pénalités de boucles et virages. ultimate : récompenses strategy avec parcours au-delà de 50 % dans le navigateur (assistance requise). Changer les récompenses numériques vide la mémoire.',rewardReset:'Récompenses modifiées : mémoire vidée',trainingSeed:'Graine aléatoire (défaut 42)',seedHint:'Contrôle les fruits, les poids initiaux et l’exploration. Les mêmes paramètres et graines facilitent la reproduction. Ce n’est pas la difficulté ; gardez 42. Une reprise conserve la graine du modèle et désactive ce champ.',trainingSaveHint:'Sauvé dans models/classic, models/strategy ou models/ultimate, avec date et heure locales et épisodes cumulés, ex. 2026-09-12_14-30-00-123456_ep2400.pt.'}
  };
  for(const lang of Object.keys(translations))Object.assign(translations[lang],rewardTranslations[lang]);
  const layoutTranslations={
    'zh-CN':{trainingTitle:'训练工作台',schemeGuide:'选择适合的方案',classicDesc:'基础奖励，专注吃食物与避开碰撞。',foodReward:'吃到食物',collisionReward:'发生碰撞',stepReward:'每走一步',strategyDesc:'在 classic 基础上，兼顾路线效率和生存空间。',strategyFood:'鼓励接近食物、保留可通行的退路',strategyLoop:'惩罚重复绕圈和多余转弯',ultimateDesc:'使用 strategy 训练奖励，附加逐行铺满规则。',ultimateThreshold:'蛇身超过 50% 时接入铺满路线',ultimateAssist:'需要开启「防困辅助」',replayNote:'更换数值奖励会清空旧经验回放，保留权重与累计回合数。',trainingConfig:'训练配置',trainingMonitor:'进度与保存',seedTitle:'Seed 是什么？',saveTitle:'自动分类保存',saveFolders:'按所选方案保存到对应目录',saveNaming:'文件名包含本机日期、时间和累计回合数。',seedHint:'控制食物分布和训练随机性，方便复现实验，不是难度。保留 42 即可；续训沿用原模型种子。'},
    en:{trainingTitle:'Training workspace',schemeGuide:'Choose your scheme',classicDesc:'Basic rewards for collecting food and avoiding collisions.',foodReward:'Food collected',collisionReward:'Collision',stepReward:'Each step',strategyDesc:'Builds on classic with route efficiency and room to survive.',strategyFood:'Rewards food progress and escape space',strategyLoop:'Penalizes repeated loops and extra turns',ultimateDesc:'Strategy training rewards with a row-by-row sweep rule.',ultimateThreshold:'Joins the sweep above 50% board occupancy',ultimateAssist:'Requires safety assistance to be enabled',replayNote:'Changing numeric rewards clears old replay; weights and cumulative episodes are kept.',trainingConfig:'Training setup',trainingMonitor:'Progress & saving',seedTitle:'What is Seed?',saveTitle:'Organized automatically',saveFolders:'Saved in the folder for the selected scheme',saveNaming:'Names include local date, time and cumulative episodes.',seedHint:'Controls food and training randomness to help reproduce a run. It is not difficulty. Keep 42 if unsure; resumed models keep their original seed.'},
    fr:{trainingTitle:'Atelier d’entraînement',schemeGuide:'Choisir une approche',classicDesc:'Récompenses de base pour les fruits et éviter les collisions.',foodReward:'Fruit mangé',collisionReward:'Collision',stepReward:'Chaque pas',strategyDesc:'Ajoute à classic l’efficacité du trajet et un espace de sortie.',strategyFood:'Favorise les fruits accessibles et les issues',strategyLoop:'Pénalise les boucles et les virages superflus',ultimateDesc:'Récompenses strategy avec parcours ligne par ligne.',ultimateThreshold:'Rejoint le parcours au-delà de 50 % du plateau',ultimateAssist:'Nécessite l’assistance de sécurité',replayNote:'Changer les récompenses numériques vide la mémoire ; les poids et épisodes sont conservés.',trainingConfig:'Configuration',trainingMonitor:'Progression et sauvegarde',seedTitle:'Qu’est-ce que Seed ?',saveTitle:'Classement automatique',saveFolders:'Sauvé dans le dossier de l’approche sélectionnée',saveNaming:'Noms avec date, heure locales et épisodes cumulés.',seedHint:'Contrôle les fruits et l’aléatoire pour reproduire un essai. Ce n’est pas la difficulté. Gardez 42 ; une reprise conserve sa graine.'}
  };
  for(const lang of Object.keys(translations))Object.assign(translations[lang],layoutTranslations[lang]);
  const inferenceTranslations = {"zh-CN": {"aiSpeed": "\u76ee\u6807 AI \u901f\u5ea6", "actualRate": "\u5b9e\u9645 {actual} steps/s \u00b7 \u76ee\u6807 {target}", "dqnLoading": "\u6b63\u5728\u52a0\u8f7d DQN \u6743\u91cd\u2026", "dqnLocal": "DQN \u6d4f\u89c8\u5668\u63a8\u7406 \u00b7 \u9632\u56f0\u8c03\u6574 {count} \u6b21"}, "en": {"aiSpeed": "Target AI speed", "actualRate": "Actual {actual} steps/s \u00b7 target {target}", "dqnLoading": "Loading DQN weights\u2026", "dqnLocal": "DQN browser inference \u00b7 safety overrides {count}"}, "fr": {"aiSpeed": "Vitesse IA cible", "actualRate": "R\u00e9el {actual} steps/s \u00b7 cible {target}", "dqnLoading": "Chargement des poids DQN\u2026", "dqnLocal": "DQN dans le navigateur \u00b7 corrections {count}"}};
  for(const lang of Object.keys(translations))Object.assign(translations[lang],inferenceTranslations[lang]);
  const skins = {
    lime: {price:0,accent:'#b5ff70',alternate:'#63c244'},
    cyan: {price:0,accent:'#75f8ff',alternate:'#31bbd2'},
    pink: {price:30,accent:'#ff88d8',alternate:'#c43b9c'},
    violet: {price:60,accent:'#c3a0ff',alternate:'#7952d0'},
    solar: {price:100,accent:'#ffdb79',alternate:'#eb9c2b'},
    prism: {price:150,accent:'#69f8ed',alternate:'#f56fce'},
    solid_cyan: {price:20,accent:'#55eaff',alternate:'#55eaff',solid:true},
    solid_pink: {price:20,accent:'#ff73ce',alternate:'#ff73ce',solid:true},
    solid_white: {price:40,accent:'#edf4ff',alternate:'#edf4ff',solid:true}
  };
  // One visual definition for shop previews and the playable snakes.
  const skinStyle = {head:'#f1faff',eye:'#0a1024',radius:5,glow:8,glowColor:'rgba(174,239,255,.5)'};
  const maxCoins = 999999999;
  let coins = 0, ownedSkins = new Set(['lime','cyan']), equippedSkins = ['lime','cyan'];
  let shopPlayer = 1, shopMessage = null, storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem('pixel-snake-shop') || 'null');
    if (saved && typeof saved === 'object') {
      if (Number.isSafeInteger(saved.coins) && saved.coins >= 0 && saved.coins <= maxCoins) coins = saved.coins;
      if (Array.isArray(saved.owned)) for (const id of saved.owned) {
        if (typeof id === 'string' && Object.hasOwn(skins, id)) ownedSkins.add(id);
      }
      if (Array.isArray(saved.equipped)) equippedSkins = equippedSkins.map((fallback, index) => ownedSkins.has(saved.equipped[index]) ? saved.equipped[index] : fallback);
    }
  } catch { /* 缺失或损坏的存档不会阻止游戏启动。 */ }
  function saveShop() {
    try { localStorage.setItem('pixel-snake-shop', JSON.stringify({coins,owned:[...ownedSkins],equipped:equippedSkins})); }
    catch { storageAvailable = false; }
  }
  let language = 'zh-CN', mode = 'single', state = 'ready', best = 0, roundBest = 0, lastTime = null;
  try {
    const saved = localStorage.getItem('pixel-snake-language');
    if (Object.hasOwn(translations, saved)) language = saved;
    const stored = Number(localStorage.getItem('pixel-snake-best'));
    if (Number.isFinite(stored) && stored >= 0) best = stored;
  } catch { /* 游戏及语言切换在禁用存储时仍可运行。 */ }
  const t = (key, values = {}) => translations[language][key].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  const {SnakeGame, Actions, directions, size, initialSpeed, maxSpeed} = globalThis.SnakeEngine;
  const {HumanAgent, RandomAgent, HeuristicAgent} = globalThis.SnakeAgents;
  const {EpisodeRunner} = globalThis.SnakeEpisodes;
  let safetyEnabled = true;
  let rateLastTime = null;
  let aiSpeed = 'normal', headless = false, autoRestart = false, batching = false, progressDirty = false;
  const players = [1, 2].map(id => {
    const canvas = $('game-' + id);
    const engine = new SnakeGame();
    const agent = new HumanAgent(), runner = new EpisodeRunner({game:engine, agent});
    return { id, engine, agent, runner, agentType:'human', model:engine.getState(), canvas, ctx:canvas.getContext('2d'),
      elapsed:0, touch:null, particles:[], growthFlashes:[],
      rateSteps:0, rateMs:0, actualRate:null,
      boosting: false, boostHeldMs: 0, boostDirection: null,
      motionFrom: [], motionVia: [], motionProgress: 1, motionDuration: 250 };
  });
  const {draw:paint, visibleSnake, fruitFeedback, updateParticles, unlockAudio} = globalThis.createSnakeRenderer({
    size, skinStyle, getSkin:id => skins[equippedSkins[id - 1]]
  });
  const {clearPressedControls, directionButtons, isHeld} = globalThis.createSnakeInput({
    players, getMode:() => mode, getStatus:() => state, onAction:turn, start, togglePause,
    canControl:player => player.agentType === 'human',
    onRelease:() => players.forEach(player => updateBoost(player, 0)),
    onClear:id => players.forEach(player => { if (id === undefined || player.id === id) resetBoost(player); })
  });
  const activePlayers = () => mode === 'dual' ? players : players.slice(0, 1);
  const canPlay = () => headless || activePlayers().every(player => player.ctx);
  const draw = player => { if (!headless) paint(player); };
  const accelerated = player => player.agentType !== 'human' && aiSpeed !== 'normal';
  // Calculate in tenths instead of repeatedly adding floating-point increments.
  const speed = player => globalThis.SnakeEngine.speed(player.model);
  const currentSpeed = player => accelerated(player) ? Number(aiSpeed) : player.boosting ? maxSpeed : speed(player);
  const delay = player => 1000 / currentSpeed(player);
  function retimeMovement(player, previousDelay) {
    const ratio = delay(player) / previousDelay;
    // Preserve both clocks' progress so the animation reaches the cell as the next step begins.
    player.elapsed *= ratio;
    player.motionDuration *= ratio;
  }
  function resetBoost(player) {
    const wasBoosting = player.boosting;
    const previousDelay = delay(player);
    player.boosting = false; player.boostHeldMs = 0; player.boostDirection = null;
    if (wasBoosting) { retimeMovement(player, previousDelay); updateStats(player); }
  }
  function updateBoost(player, delta) {
    const direction = Object.keys(directions).find(name => directions[name].x === player.model.direction.x && directions[name].y === player.model.direction.y);
    const held = isHeld(player.id, direction);
    if (player.agentType !== 'human' || state !== 'running' || !player.model.alive || !activePlayers().includes(player) || !held) { resetBoost(player); return; }
    if (player.boostDirection !== direction) {
      resetBoost(player); player.boostDirection = direction;
    }
    player.boostHeldMs += delta;
    if (!player.boosting && player.boostHeldMs >= 500) {
      const previousDelay = delay(player);
      player.boosting = true; retimeMovement(player, previousDelay); updateStats(player);
    }
  }
  function renderShop() {
    $('coins').textContent = coins;
    $('shop-coins').textContent = coins;
    document.querySelectorAll('[data-shop-player]').forEach(button => {
      const active = Number(button.dataset.shopPlayer) === shopPlayer;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    for (const [id, skin] of Object.entries(skins)) {
      const owned = ownedSkins.has(id), equipped = equippedSkins[shopPlayer - 1] === id;
      const button = $('skin-buy-' + id);
      const card = $('skin-card-' + id);
      card.classList.toggle('equipped', equipped);
      card.style.setProperty('--skin-color', skin.accent);
      card.style.setProperty('--skin-alt', skin.alternate);
      card.style.setProperty('--skin-head', skin.solid ? skin.accent : skinStyle.head);
      card.style.setProperty('--skin-eye', skinStyle.eye);
      card.style.setProperty('--skin-radius', skinStyle.radius + 'px');
      card.style.setProperty('--skin-glow', skinStyle.glow + 'px');
      card.style.setProperty('--skin-glow-color', skinStyle.glowColor);
      $('skin-price-' + id).textContent = t(owned ? (skin.price === 0 ? 'free' : 'owned') : 'coinPrice', {price:skin.price});
      button.textContent = t(equipped ? 'equipped' : owned ? 'equip' : 'unlock', {price:skin.price});
      button.disabled = equipped || (!owned && coins < skin.price);
      button.title = !owned && coins < skin.price ? t('needCoins', {amount:skin.price - coins}) : t('skin_' + id);
      button.setAttribute('aria-label', t('skin_' + id) + ' · ' + button.textContent + ' · ' + t('player' + shopPlayer));
    }
    $('shop-message').textContent = shopMessage ? t(shopMessage.key, {
      skin:shopMessage.skin ? t('skin_' + shopMessage.skin) : '',
      player:t('player' + shopPlayer), amount:shopMessage.amount
    }) : '';
    $('shop-storage').hidden = storageAvailable;
  }
  function selectShopPlayer(value) {
    if (value !== 1 && value !== 2) return;
    shopPlayer = value; shopMessage = null; renderShop();
  }
  function buySkin(id) {
    if (!Object.hasOwn(skins, id)) return;
    const skin = skins[id], owned = ownedSkins.has(id);
    if (!owned && coins < skin.price) {
      shopMessage = {key:'needCoins',amount:skin.price - coins}; renderShop(); return;
    }
    if (owned && equippedSkins[shopPlayer - 1] === id) return;
    if (!owned) { coins -= skin.price; ownedSkins.add(id); }
    equippedSkins[shopPlayer - 1] = id;
    shopMessage = {key:owned ? 'skinEquipped' : 'skinUnlocked',skin:id};
    saveShop(); renderStatus(); players.forEach(draw);
  }
  function openShop() {
    if ($('skin-shop').open) return;
    if (state === 'running') togglePause();
    clearPressedControls(); shopMessage = null; renderShop(); $('skin-shop').showModal();
  }
  function resetPlayers(newEpisode = false) {
    roundBest = best;
    clearPressedControls();
    for (const player of players) {
      $('ai-status-' + player.id).textContent = '';
      if (!newEpisode) { player.rateSteps = 0; player.rateMs = 0; player.actualRate = null; }
      player.model = player.runner.reset({countEpisode:newEpisode && activePlayers().includes(player)});
      player.motionFrom = []; player.motionVia = []; player.motionProgress = 1;
      player.motionDuration = 1000 / initialSpeed;
      player.elapsed = 0;
      player.touch = null;
      player.particles = [];
      player.growthFlashes = [];
      $('score-' + player.id).classList.remove('score-pop');
    }
    lastTime = null;
  }
  function updateStats(player) {
    $('episode-' + player.id).textContent = player.runner.episodeNumber;
    $('steps-' + player.id).textContent = player.model.stepsSurvived;
    $('food-' + player.id).textContent = player.model.foodCollected;
    $('death-' + player.id).textContent = t('death_' + (player.model.causeOfDeath || 'none'));
    $('score-' + player.id).textContent = player.model.score;
    $('length-' + player.id).textContent = player.model.snake.length;
    const formattedSpeed = currentSpeed(player).toFixed(1).replace('.', language === 'fr' ? ',' : '.');
    $('speed-' + player.id).textContent = t('speedValue', {speed: formattedSpeed}) + (player.boosting ? ' · ' + t('boosted') : '');
    const rate = $('ai-rate-' + player.id);
    rate.hidden = player.agentType === 'human';
    rate.textContent = t('actualRate', {actual:state === 'running' ? (player.actualRate === null ? '…' : player.actualRate.toFixed(0)) : '0', target:formattedSpeed});
    if (player.agentType === 'dqn' && player.agent.agent.network && player.agent.agent.loadedModel === $('dqn-model').value) {
      $('ai-status-' + player.id).textContent = t('dqnLocal', {count:player.agent.guard?.overrides || 0});
    }
    if (safetyEnabled && player.agent.guard?.filling) {
      const joining=player.agent.guard.lastReason==='fill_join';
      $('ai-status-' + player.id).textContent = language==='zh-CN'
        ? (joining ? '蛇身超过 50% · 正在安全接入铺满路线' : '蛇身超过 50% · 逐行铺满模式')
        : language==='fr' ? (joining ? 'Occupation > 50 % · Rejoint le parcours' : 'Occupation > 50 % · Parcours ligne par ligne')
        : (joining ? 'Board > 50% · Joining sweep safely' : 'Board > 50% · Row-by-row sweep');
    }
    $('meter-' + player.id).style.width = (Math.min(1, currentSpeed(player) / maxSpeed) * 100) + '%';
    $('player-' + player.id).classList.toggle('boosting', player.boosting);
  }
  function renderStatus() {
    renderShop();
    const letters = {up:'W',left:'A',down:'S',right:'D'}, symbols = {up:'↑',left:'←',down:'↓',right:'→'};
    directionButtons.forEach(button => {
      button.textContent = (mode === 'dual' && button.dataset.player === '1' ? letters : symbols)[button.dataset.direction];
      button.disabled = players[Number(button.dataset.player) - 1].agentType !== 'human';
    });
    const paused = state === 'paused', over = state === 'over';
    const action = t(paused ? 'resumeGame' : over ? 'again' : mode === 'dual' ? 'startBoth' : 'start');
    $('pause').textContent = t(paused ? 'resume' : 'pause');
    $('pause').disabled = state !== 'running' && !paused;
    $('start').textContent = action;
    $('start').disabled = !canPlay() || state === 'running';
    $('restart').disabled = !canPlay();
    $('instructions').textContent = t(mode === 'dual' ? 'dualInstructions' : 'singleInstructions');
    $('mode-rules').textContent = t(mode === 'dual' ? 'dualRules' : 'intro');
    $('best').textContent = best;
    for (const player of players) {
      $('agent-' + player.id).value = player.agentType;
      const id = player.id, label = t('player' + id);
      $('player-title-' + id).textContent = mode === 'single' && id === 1 ? t('single') : label;
      $('player-keys-' + id).textContent = id === 1 ? (mode === 'dual' ? 'WASD' : 'WASD / ↑ ↓ ← →') : '↑ ↓ ← →';
      if (player.agentType !== 'human') $('player-keys-' + id).textContent = t(player.agentType + 'Agent');
      player.canvas.setAttribute('aria-label', t('board', {player: label}));
      updateStats(player);
      let title = t('title'), text = t('intro'), kicker = t('ready');
      const newRecord = mode === 'single' && !player.model.alive && player.model.score > roundBest;
      if (!canPlay()) text = t('canvasError');
      else if (!player.model.alive) {
        title = t(player.model.won ? 'won' : 'over');
        text = t('roundScore', {score: player.model.score});
        kicker = mode === 'dual' && !over ? t('waiting') : mode === 'single' ? t('single') : label;
        if (newRecord) {
          if (player.model.won) kicker = t('newRecord');
          else { kicker = title; title = t('newRecord'); }
        }
      } else if (paused) { title = t('paused'); text = t('pauseHint'); kicker = label; }
      $('title-' + id).textContent = title; $('text-' + id).textContent = text; $('kicker-' + id).textContent = kicker;
      $('overlay-' + id).classList.toggle('result', !player.model.alive);
      $('overlay-' + id).classList.toggle('full-board-win', player.model.won);
      $('overlay-' + id).classList.toggle('new-record', newRecord);
      $('overlay-' + id).hidden = state === 'running' && player.model.alive;
      $('play-' + id).textContent = action;
      $('play-' + id).hidden = (state === 'running' || paused) && !player.model.alive;
      $('play-' + id).disabled = !canPlay();
    }
  }
  function setLanguage(value) {
    if (!Object.hasOwn(translations, value)) return;
    language = value; document.documentElement.lang = language; document.title = t('pageTitle');
    $('language').value = language;
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(element => { element.setAttribute('aria-label', t(element.dataset.i18nAria)); });
    renderStatus();
    try { localStorage.setItem('pixel-snake-language', language); } catch { /* 本次选择仍然生效。 */ }
  }
  function setMode(value) {
    if (!['single', 'dual'].includes(value) || value === mode) return;
    mode = value; state = 'ready'; resetPlayers();
    $('cabinet').classList.toggle('dual', mode === 'dual');
    $('player-2').hidden = mode !== 'dual';
    document.querySelectorAll('[data-mode]').forEach(button => {
      const selected = button.dataset.mode === mode;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    renderStatus(); players.forEach(draw);
  }
  function start() {
    if (!canPlay()) return;
    if (!headless) unlockAudio();
    resetPlayers(true); state = 'running'; renderStatus(); activePlayers().forEach(draw);
  }
  function togglePause() {
    clearPressedControls();
    if (state === 'running') { state = 'paused'; players.forEach(p => { if (['dqn','qwen'].includes(p.agentType)) p.agent.agent.cancel(); }); }
    else if (state === 'paused') {
      if (!headless) unlockAudio();
      state = 'running'; lastTime = null;
      players.forEach(player => { player.elapsed = 0; });
    }
    renderStatus();
  }
  function finish(player, won = false) {
    clearPressedControls(player.id);
    player.agent.reset?.(); player.elapsed = 0;
    if (activePlayers().every(item => !item.model.alive)) state = 'over';
    renderStatus();
    if (!won && !headless) {
      const flash = $('flash-' + player.id);
      flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 180);
    }
  }
  function turn(player, action) {
    if (state !== 'running' || player.agentType !== 'human' || !activePlayers().includes(player)) return;
    player.agent.queueAction(action, player.model);
  }
  function step(player) {
    if (state !== 'running' || !player.model.alive || !activePlayers().includes(player)) return;
    const animate = !headless && !accelerated(player);
    const from = animate ? visibleSnake(player).map(part => ({...part})) : [];
    const via = animate ? player.model.snake.map(part => ({...part})) : [];
    const previousScore = player.model.score;
    const beforeSteps = player.model.steps;
    player.model = player.runner.step();
    if (player.model.steps === beforeSteps) return;
    if (player.agentType !== 'human' && player.agent.guard && !['dqn','qwen'].includes(player.agentType)) {
      $('ai-status-' + player.id).textContent = safetyEnabled ? (language === 'zh-CN' ? '防困调整：' : 'Safety overrides: ') + player.agent.guard.overrides : '';
    }
    updateBoost(player, 0);
    const eating = player.model.score > previousScore;
    if (!player.model.alive && !player.model.won) { finish(player); return; }
    if (eating) {
      coins = Math.min(maxCoins, coins + 5);
      if (batching) progressDirty = true;
      else { saveShop(); renderShop(); }
      if (player.model.score > best) {
        best = player.model.score; $('best').textContent = best;
        if (!batching) { try { localStorage.setItem('pixel-snake-best', String(best)); } catch { /* 保留本次纪录。 */ } }
      }
      if (!batching) updateStats(player);
      if (animate) fruitFeedback(player, player.model.snake[0]);
      if (player.model.won) finish(player, true);
    }
    if (!animate) {
      player.motionProgress = 1;
      if (!batching) { updateStats(player); draw(player); }
      return;
    }
    // Keep the displayed position continuous, even when boost changes the step interval.
    player.motionFrom = player.model.snake.map((part, index) => from[index] || from[from.length - 1] || part);
    player.motionVia = player.model.snake.map((part, index) => via[index] || via[via.length - 1] || part);
    player.motionDuration = delay(player);
    player.motionProgress = Math.min(1, player.elapsed / player.motionDuration);
    updateStats(player);
    draw(player);
  }
  function frame(time) {
    const rateDelta = rateLastTime === null ? 0 : Math.max(0, time - rateLastTime);
    rateLastTime = time;
    if (state === 'over' && !document.hidden && autoRestart && activePlayers().every(player => player.agentType !== 'human' && !player.model.won)) start();
    if (lastTime === null) lastTime = time;
    const wallDelta = Math.max(0, time - lastTime), delta = Math.min(wallDelta, 250);
    if (state === 'running') activePlayers().forEach(player => updateBoost(player, wallDelta));
    const animated = new Set();
    if (!headless && state !== 'paused' && !document.hidden) for (const player of activePlayers()) {
      if (!player.particles.length && !player.growthFlashes.length && player.motionProgress >= 1) continue;
      player.motionProgress = Math.min(1, player.motionProgress + delta / player.motionDuration);
      updateParticles(player, delta); animated.add(player);
    }
    batching = true;
    const frameStarted = Date.now();
    if (state !== 'running') for (const player of players) { player.rateMs = 0; player.rateSteps = 0; }
    if (state === 'running') for (const player of activePlayers()) {
      if (!player.model.alive) continue;
      player.elapsed += delta;
      const before = player.model.steps;
      let frameSteps = 0;
      while (player.elapsed >= delay(player) && state === 'running' && player.model.alive && frameSteps < 128 && (frameSteps === 0 || Date.now() - frameStarted < 12)) {
        frameSteps++;
        player.elapsed -= delay(player);
        const previousSteps = player.model.steps;
        step(player);
        if (player.model.steps === previousSteps) { player.elapsed = delay(player); break; }
      }
      player.rateMs += rateDelta;
      player.rateSteps += player.model.steps - before;
      const rateReady = player.rateMs >= 1000;
      if (rateReady) {
        player.actualRate = player.rateSteps * 1000 / player.rateMs;
        player.rateMs = 0; player.rateSteps = 0;
      }
      // Bound catch-up debt when inference/planning cannot reach the requested rate.
      player.elapsed = Math.min(player.elapsed, delay(player) * 128);
      if (player.model.steps !== before || rateReady) {
        updateStats(player);
        if (accelerated(player)) animated.add(player);
      }
    }
    batching = false;
    if (progressDirty) {
      saveShop(); renderShop();
      try { localStorage.setItem('pixel-snake-best', String(best)); } catch { /* Session records still work. */ }
      progressDirty = false;
    }
    animated.forEach(draw);
    lastTime = time; requestAnimationFrame(frame);
  }
  function setAgentType(player, value) {
    const types = {human:HumanAgent, random:RandomAgent, heuristic:HeuristicAgent, dqn:null, qwen:null};
    if (!Object.hasOwn(types, value) || player.agentType === value) return;
    clearPressedControls();
    player.agent.reset?.();
    player.agentType = value;
    let agent;
    if (value === 'dqn' || value === 'qwen') {
      const Agent = value === 'dqn' ? globalThis.SnakeDQN.BrowserDQNAgent : globalThis.SnakeLocalAI.RemoteAgent;
      agent = new Agent({type:value,model:()=>$('dqn-model').value,
        onStatus:message=>{
          $('ai-status-' + player.id).textContent = message.state === 'loading' ? t('dqnLoading') :
            message.state === 'local' ? t('dqnLocal',{count:player.agent.guard?.overrides || 0}) :
            message.state === 'thinking' ? t('thinking',{type:value}) :
            message.state === 'error' ? t('aiError',{error:message.error}) :
            t('decisionReady',{ms:message.latency_ms.toFixed(0),fallback:message.fallback?t('fallbackNote'):'',count:player.agent.guard?.overrides || 0});
        }});
    } else agent = new types[value]();
    player.agent = value === 'human' ? agent : new globalThis.SnakeSafety.AssistedAgent(agent,()=>safetyEnabled);
    player.runner.setAgent(player.agent);
    state = 'ready'; resetPlayers(); renderStatus(); players.forEach(draw);
  }
  function setAISpeed(value) {
    if (!['normal','60','600','6000'].includes(value) || value === aiSpeed) return;
    for (const player of players) if (player.agentType !== 'human') clearPressedControls(player.id);
    aiSpeed = value; $('ai-speed').value = value;
    for (const player of players) if (player.agentType !== 'human') {
      player.elapsed = 0; player.motionProgress = 1;
      player.rateMs = 0; player.rateSteps = 0; player.actualRate = null;
      player.particles = []; player.growthFlashes = [];
      updateStats(player); draw(player);
    }
  }
  function setHeadless(value) {
    headless = Boolean(value); $('headless').checked = headless;
    for (const player of players) {
      player.canvas.hidden = headless;
      $('headless-' + player.id).hidden = !headless;
      player.particles = []; player.growthFlashes = []; player.motionProgress = 1;
    }
    renderStatus(); players.forEach(draw);
  }
  const primaryAction = () => state === 'paused' ? togglePause() : start();
  document.querySelectorAll('[data-player-agent]').forEach(select => select.addEventListener('change', event => {
    setAgentType(players[Number(select.dataset.playerAgent) - 1], event.target.value);
  }));
  $('ai-speed').addEventListener('change', event => setAISpeed(event.target.value));
  $('headless').addEventListener('change', event => setHeadless(event.target.checked));
  $('auto-restart').addEventListener('change', event => { autoRestart = event.target.checked; });
  $('start').addEventListener('click', primaryAction);
  $('restart').addEventListener('click', start);
  $('pause').addEventListener('click', togglePause);
  $('language').addEventListener('change', event => setLanguage(event.target.value));
  $('shop-open').addEventListener('click', openShop);
  $('shop-close').addEventListener('click', () => $('skin-shop').close());
  document.querySelectorAll('[data-shop-player]').forEach(button => button.addEventListener('click', () => selectShopPlayer(Number(button.dataset.shopPlayer))));
  document.querySelectorAll('[data-skin]').forEach(button => button.addEventListener('click', () => buySkin(button.dataset.skin)));
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  for (const player of players) {
    $('score-' + player.id).addEventListener('animationend', event => {
      if (event.animationName === 'score-pop') $('score-' + player.id).classList.remove('score-pop');
    });
    $('play-' + player.id).addEventListener('click', primaryAction);
  }

  const localHTTP = () => globalThis.location?.protocol === 'http:' && ['127.0.0.1','localhost'].includes(globalThis.location.hostname);
  let trainingPoll = null, trainingBusy = false;
  let availableModels=[];
  function updateTrainingSource(selectScheme=false) {
    const source=availableModels.find(model=>model.name===$('training-model').value);
    $('training-seed').disabled=trainingBusy || Boolean($('training-model').value);
    if(selectScheme)$('training-reward').value=source?.reward_profile || 'classic';
  }
  function renderTraining(data) {
    trainingBusy = ['starting','running','stopping'].includes(data.state);
    $('training-start').disabled = trainingBusy || !localHTTP();
    $('training-stop').disabled = !trainingBusy;
    for (const id of ['training-model','training-reward','training-episodes','training-save-every','training-seed']) $(id).disabled = trainingBusy;
    updateTrainingSource();
    $('training-progress').max = Math.max(1,(data.target_episode || 0)-(data.start_episode || 0));
    $('training-progress').value = Math.max(0,(data.episode || 0)-(data.start_episode || 0));
    $('training-status').textContent = data.state === 'idle' ? t('trainingIdle') : data.state === 'failed' ? t('trainingFailed',{error:data.error}) :
      t('trainingRunning',{state:data.state,episode:data.episode??0,target:data.target_episode??'—',score:data.score??'—',
        average:data.moving_average_score?.toFixed(1)??'—',epsilon:data.epsilon?.toFixed(3)??'—',saved:data.saved_model||t('notSaved')}) +
        (data.source_model ? '\n'+t(data.replay_reset_for_reward_change?'rewardReset':data.exact_resume?'resumeFull':'resumedLegacy') : '') + (data.reward_profile ? '\n'+data.reward_profile : '');
  }
  async function refreshModels() {
    if (!localHTTP()) { $('local-status').textContent=t('localOffline'); return; }
    try {
      const data=await globalThis.SnakeLocalAI.request('/api/models');
      if (!Array.isArray(data.models)) throw Error('Invalid model list from local service');
      availableModels=data.models;
      for (const id of ['dqn-model','training-model']) {
        const select=$(id), selected=select.value;
        select.replaceChildren();
        if (id==='training-model') {
          const option=new Option(t('newModel'),'');
          option.dataset.i18n='newModel';
          select.add(option);
        }
        for (const model of data.models) select.add(new Option(model.name+' · '+model.episodes+' episodes · '+model.reward_profile,model.name));
        if ([...select.options].some(o=>o.value===selected)) select.value=selected;
      }
      players.forEach(player => player.agent.agent?.invalidate?.());
      updateTrainingSource();
      $('local-status').textContent=data.models.length ? t('localOnline',{count:data.models.length}) : t('noModels');
    } catch(error) { $('local-status').textContent=t('localOffline')+'\n'+error.message; }
  }
  async function pollTraining() {
    if (!localHTTP()) { renderTraining({state:'idle'}); return; }
    try {
      const wasBusy=trainingBusy, data=await globalThis.SnakeLocalAI.request('/api/training');
      if(wasBusy && !['starting','running','stopping'].includes(data.state)) await refreshModels();
      renderTraining(data);
    } catch(error) { $('training-status').textContent=error.message; }
    trainingPoll=setTimeout(pollTraining,1500);
  }
  $('refresh-models').addEventListener('click',refreshModels);
  $('training-model').addEventListener('change',()=>updateTrainingSource(true));
  $('ai-safety').addEventListener('change',event=>{safetyEnabled=event.target.checked; players.forEach(p=>p.agent.guard?.reset());});
  $('dqn-model').addEventListener('change',()=>{state='ready';resetPlayers();renderStatus();players.forEach(draw);});
  $('training-start').addEventListener('click',async()=>{
    if(trainingBusy) return;
    try {
      $('training-start').disabled=true;
      const data=await globalThis.SnakeLocalAI.request('/api/training/start',{
        model:$('training-model').value,reward_profile:$('training-reward').value,episodes:Number($('training-episodes').value),
        save_every:Number($('training-save-every').value),seed:Number($('training-seed').value)});
      renderTraining(data);
    } catch(error) { $('training-status').textContent=error.message; $('training-start').disabled=false; }
  });
  $('training-stop').addEventListener('click',async()=>{
    try { await globalThis.SnakeLocalAI.request('/api/training/stop',{}); $('training-stop').disabled=true; }
    catch(error) { $('training-status').textContent=error.message; }
  });
  if (typeof fetch === 'function') { refreshModels(); pollTraining(); }
  else { $('local-status').textContent=t('localOffline'); $('training-start').disabled=true; }

  resetPlayers(); setLanguage(language); players.forEach(draw); requestAnimationFrame(frame);
})();
