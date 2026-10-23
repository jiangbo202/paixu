export const DEFAULT_RULES = Object.freeze({
  startingMoney: 4, hands: 4, discards: 4, handSize: 8,
  targetScale: 1, skipReward: 5, interestCap: 5,
  commonWeight: 70, uncommonWeight: 25, rareWeight: 5,
  planetChance: 0.5, priceScale: 1, boosterPrice: 6, rerollPrice: 5,
});
export const RULE_BOUNDS = {
  startingMoney: [0, 100, true], hands: [1, 10, true], discards: [0, 10, true], handSize: [5, 12, true],
  targetScale: [0.1, 10], skipReward: [0, 25, true], interestCap: [0, 20, true],
  commonWeight: [0, 100, true], uncommonWeight: [0, 100, true], rareWeight: [0, 100, true],
  planetChance: [0, 1], priceScale: [0.25, 5], boosterPrice: [1, 30, true], rerollPrice: [1, 20, true],
};
export function validateRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid rules');
  if (Object.keys(value).some(k => !Object.hasOwn(RULE_BOUNDS, k))) throw new Error('Unknown rule');
  const result = { ...DEFAULT_RULES, ...value };
  for (const [key, [min, max, integer]] of Object.entries(RULE_BOUNDS)) {
    const n = result[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`Invalid rule: ${key}`);
  }
  if (!result.commonWeight && !result.uncommonWeight && !result.rareWeight) throw new Error('At least one rarity weight must be positive');
  return result;
}
export const rulesFor = state => ({ ...DEFAULT_RULES, ...state.rules });

// Applied once at creation. Runs retain the resulting rules, including after updates.
export const DIFFICULTIES = Object.freeze([
  { id: 'easy', name: '简单', target: .7, growth: 1, money: 4, hands: 1, discards: 1, weights: [.8, 1.4, 2], starter: 'joker', description: '更低目标，赠送微笑小丑，更容易找到高品质小丑。' },
  { id: 'medium', name: '中等', target: 1, growth: 1, money: 0, hands: 0, discards: 0, weights: [1, 1, 1], description: '标准规则，均衡的目标与小丑出现概率。' },
  { id: 'hard', name: '困难', target: 1.15, growth: 1.06, money: 0, hands: 0, discards: -1, weights: [1.1, .85, .6], description: '目标随底注加速增长，少一次弃牌，高品质小丑更少。' },
  { id: 'nightmare', name: '巨难', target: 1.35, growth: 1.12, money: -1, hands: -1, discards: -2, weights: [1.2, .6, .4], description: '更陡的目标曲线，更少出牌和弃牌，考验小丑组合。' },
].map(preset => Object.freeze({ ...preset, weights: Object.freeze(preset.weights) })));
export function validateDifficulty(value = 'medium') {
  if (typeof value !== 'string' || !DIFFICULTIES.some(d => d.id === value)) throw new Error('Invalid difficulty');
  return value;
}
export const difficultyFor = state => DIFFICULTIES.find(d => d.id === (typeof state === 'string' ? state : state?.difficulty)) || DIFFICULTIES[1];
export function difficultySetup(value, difficulty = 'medium') {
  const preset = difficultyFor(validateDifficulty(difficulty)), rules = validateRules(value || {});
  const bounded = (key, amount) => Math.max(RULE_BOUNDS[key][0], Math.min(RULE_BOUNDS[key][1], amount));
  for (const key of ['hands', 'discards']) rules[key] = bounded(key, rules[key] + preset[key]);
  rules.startingMoney = bounded('startingMoney', rules.startingMoney + preset.money);
  rules.targetScale = bounded('targetScale', rules.targetScale * preset.target);
  for (const [i, key] of ['commonWeight', 'uncommonWeight', 'rareWeight'].entries()) {
    rules[key] = rules[key] === 0 ? 0 : Math.max(1, bounded(key, Math.round(rules[key] * preset.weights[i])));
  }
  return { rules: validateRules(rules), targetGrowth: preset.growth, starter: preset.starter };
}
