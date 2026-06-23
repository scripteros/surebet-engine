import { MatchOdds, Market, Outcome, SurebetOpportunity, SurebetLeg } from '../types';

/**
 * Calcula surebet opportunities across multiple bookmakers for the same match.
 * Uses the formula: 1/odds1 + 1/odds2 + ... < 1 => arbitrage exists
 */
export function findSurebets(allMatches: MatchOdds[]): SurebetOpportunity[] {
  const opportunities: SurebetOpportunity[] = [];

  // Group matches by (homeTeam + awayTeam + round startTime to minute)
  const matchGroups = new Map<string, MatchOdds[]>();

  for (const match of allMatches) {
  const roundedTime = match.startTime ? match.startTime.substring(0, 16) : match.startTime;
  const key = `${match.homeTeam}|${match.awayTeam}|${roundedTime}`;
    const group = matchGroups.get(key) || [];
    group.push(match);
    matchGroups.set(key, group);
  }

  for (const [matchKey, matches] of matchGroups) {
    if (matches.length < 2) continue; // Need at least 2 bookmakers

    const [refMatch] = matches;

    // Get all available markets across all bookmakers
    const marketKeys = new Set<string>();
    for (const m of matches) {
      for (const mk of m.markets) marketKeys.add(mk.key);
    }

    for (const marketKey of marketKeys) {
      // For each market, find the best odds per outcome across bookmakers
      const outcomesMap = new Map<string, { name: string; odds: number; bookmaker: string }>();

      for (const match of matches) {
        const market = match.markets.find(m => m.key === marketKey);
        if (!market) continue;

        for (const outcome of market.outcomes) {
          const existing = outcomesMap.get(outcome.name);
          if (!existing || outcome.price > existing.odds) {
            outcomesMap.set(outcome.name, {
              name: outcome.name,
              odds: outcome.price,
              bookmaker: match.bookmaker,
            });
          }
        }
      }

      if (outcomesMap.size < 2) continue;

      // Calculate arbitrage
      const bestOutcomes = Array.from(outcomesMap.values());
      const sumInverse = bestOutcomes.reduce((sum, o) => sum + (1 / o.odds), 0);

      if (sumInverse >= 1) continue; // No arbitrage

      const profitPercent = ((1 / sumInverse) - 1) * 100;
      const totalInvestment = 100; // Default R$100
      const guaranteedProfit = totalInvestment * (profitPercent / 100);

      // Calculate stakes for each outcome
      const legs: SurebetLeg[] = bestOutcomes.map(outcome => {
        const stake = totalInvestment * ((1 / outcome.odds) / sumInverse);
        // Find the match that provided this best outcome to get its URL
        const sourceMatch = matches.find(m => m.bookmaker === outcome.bookmaker);
        return {
          outcome: outcome.name,
          bookmaker: outcome.bookmaker,
          odds: outcome.odds,
          stake: Math.round(stake * 100) / 100,
          payout: Math.round(stake * outcome.odds * 100) / 100,
          url: sourceMatch?.url || '',
        };
      });

      opportunities.push({
        id: `${matchKey}|${marketKey}|${Date.now()}`,
        match: `${refMatch.homeTeam} vs ${refMatch.awayTeam}`,
        league: refMatch.league,
        startTime: refMatch.startTime,
        market: marketKey,
        profitPercent: Math.round(profitPercent * 100) / 100,
        totalInvestment,
        guaranteedProfit: Math.round(guaranteedProfit * 100) / 100,
        legs,
        bookmakers: [...new Set(bestOutcomes.map(o => o.bookmaker))],
        source: 'api'
      });
    }
  }

  // Sort by profit percent descending
  opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
  return opportunities;
}

/**
 * Find surebets for specific market type
 */
export function findSurebetsByMarket(
  allMatches: MatchOdds[], 
  marketKey: string
): SurebetOpportunity[] {
  return findSurebets(allMatches).filter(s => s.market === marketKey);
}

/**
 * Find surebets for specific team/league
 */
export function findSurebetsByQuery(
  allMatches: MatchOdds[],
  query: string
): SurebetOpportunity[] {
  const q = query.toLowerCase();
  return findSurebets(allMatches).filter(s =>
    s.match.toLowerCase().includes(q) ||
    s.league.toLowerCase().includes(q)
  );
}

export function getAvailableMarkets(): { key: string; name: string }[] {
  return [
    { key: 'h2h', name: '1X2 (Vencedor)' },
    { key: 'h2h_3_way', name: '1X2' },
    { key: 'spreads', name: 'Handicap Asiático' },
    { key: 'over_under', name: 'Over/Under' },
    { key: 'both_teams_to_score', name: 'Ambas Marcam' },
    { key: 'double_chance', name: 'Dupla Chance' },
    { key: 'draw_no_bet', name: 'Draw No Bet' },
    { key: 'exact_score', name: 'Placar Exato' },
    { key: 'first_half_1x2', name: '1° Tempo - 1X2' },
    { key: 'first_half_over_under', name: '1° Tempo - Over/Under' },
    { key: 'asian_handicap', name: 'Handicap Asiático' },
    { key: 'correct_score', name: 'Placar Correto' },
    { key: 'ht/ft', name: 'Intervalo/Final' },
    { key: 'total_goals', name: 'Total de Gols' },
    { key: 'team_to_score', name: 'Time Marca' },
    { key: 'player_goals', name: 'Artilheiro' },
    { key: 'corners', name: 'Escanteios' },
    { key: 'cards', name: 'Cartões' },
  ];
}
