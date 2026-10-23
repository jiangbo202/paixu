// Modes are independent of difficulty; old saves always use classic rules.
export const MODES = [
  { id: 'classic', name: '经典玩法', short: '经典', antes: 8, description: '经典核心玩法：8 底注，自由组合小丑、星球与塔罗。', targets: [300, 800, 2000, 5000, 11000, 20000, 35000, 50000], starters: [], faceChance: 0 },
  { id: 'quick', name: '短局挑战', short: '短局', antes: 3, description: '3 底注快速构筑：额外 4 金币，赠送微笑小丑，常规商品八折，目标增长更快。', targets: [300, 1600, 7000], starters: ['joker'], faceChance: 0 },
  { id: 'six-seat', name: '六席玩法', short: '六席', antes: 5, description: '六个小丑槽位，专注扑克牌与小丑组合。', targets: [250, 750, 2000, 5000, 12000], starters: [], faceChance: 0, jokerSet: 'six-seat-v1', jokersOnly: true, difficultyGrowth: { easy: 1, medium: 1, hard: 1.04, nightmare: 1.08 } },
];
export function validateMode(value = 'classic') {
  if (typeof value !== 'string' || !MODES.some(mode => mode.id === value)) throw new Error('Invalid game mode');
  return value;
}
export function modeFor(value) { return MODES.find(mode => mode.id === (typeof value === 'string' ? value : value?.mode)) || MODES[0]; }
export function modeSetup(value = 'classic') {
  const mode = modeFor(validateMode(value));
  return { antes: mode.antes, targets: [...mode.targets], faceChance: mode.faceChance, ...(mode.jokerSet ? { jokerSet: mode.jokerSet } : {}), ...(mode.jokersOnly ? { jokersOnly: true, difficultyGrowth: { ...mode.difficultyGrowth } } : {}) };
}
export const modeRulesFor = state => state.modeRules || modeSetup(modeFor(state).id);
export const jokersOnly = state => modeFor(state).id === 'six-seat' && modeRulesFor(state).jokersOnly === true;
