export const RANKINGS = [
  { id:'best', name:'最佳单手', column:'best_hand', field:'bestHand' },
  { id:'total', name:'累计得分', column:'total_score', field:'totalScore' },
  { id:'rounds', name:'最多回合', column:'rounds', field:'rounds' },
];
export const DEFAULT_RANKING_LIMIT = 20;
export const MAX_RANKING_LIMIT = 1000;
export function rankingFor(value = 'best') {
  const ranking=RANKINGS.find(item=>item.id===value);
  if (!ranking) throw new Error('Invalid ranking metric');
  return ranking;
}
