import { MatchOdds, Market, Outcome, ProviderResult } from '../types';
import { BaseProvider } from './base';

/**
 * Mock Provider - generates realistic fake odds for testing.
 * Demonstrates the surebet system with simulated data.
 * Replace with real scrapers in production.
 */
export class MockProvider extends BaseProvider {
  private teams = [
    { home: 'Flamengo', away: 'Palmeiras', league: 'Brasileirão Série A' },
    { home: 'Corinthians', away: 'São Paulo', league: 'Brasileirão Série A' },
    { home: 'Santos', away: 'Cruzeiro', league: 'Brasileirão Série A' },
    { home: 'Grêmio', away: 'Internacional', league: 'Brasileirão Série A' },
    { home: 'Botafogo', away: 'Fortaleza', league: 'Brasileirão Série A' },
    { home: 'Bahia', away: 'Athletico-PR', league: 'Brasileirão Série A' },
    { home: 'Real Madrid', away: 'Barcelona', league: 'La Liga' },
    { home: 'Manchester City', away: 'Arsenal', league: 'Premier League' },
    { home: 'Bayern Munich', away: 'Borussia Dortmund', league: 'Bundesliga' },
    { home: 'PSG', away: 'Marseille', league: 'Ligue 1' },
    { home: 'River Plate', away: 'Boca Juniors', league: 'Argentino' },
    { home: 'Nacional', away: 'Peñarol', league: 'Uruguaio' },
  ];

  private markets = [
    { key: 'h2h', name: '1X2', outcomes: ['1', 'X', '2'] },
    { key: 'both_teams_to_score', name: 'Ambas Marcam', outcomes: ['Sim', 'Não'] },
    { key: 'double_chance', name: 'Dupla Chance', outcomes: ['1X', '12', 'X2'] },
    { key: 'over_under_2.5', name: 'Over/Under 2.5', outcomes: ['Over 2.5', 'Under 2.5'] },
    { key: 'over_under_1.5', name: 'Over/Under 1.5', outcomes: ['Over 1.5', 'Under 1.5'] },
    { key: 'over_under_3.5', name: 'Over/Under 3.5', outcomes: ['Over 3.5', 'Under 3.5'] },
    { key: 'asian_handicap', name: 'Handicap Asiático', outcomes: ['-0.5', '+0.5', '-1.0', '+1.0'] },
    { key: 'exact_score', name: 'Placar Exato', outcomes: ['1-0', '0-0', '2-0', '1-1', '2-1', '0-1', '0-2', '1-2'] },
    { key: 'draw_no_bet', name: 'Draw No Bet', outcomes: ['1', '2'] },
  ];

  constructor(name: string = 'MockProvider') {
    super(name);
  }

  async fetchFootballOdds(): Promise<ProviderResult> {
    await this.sleep(300); // Simulate API delay
    const matches: MatchOdds[] = [];
    const now = new Date();

    for (let i = 0; i < this.teams.length; i++) {
      const t = this.teams[i];
      const hours = 1 + Math.floor(i / 2);
      const startTime = new Date(now.getTime() + hours * 3600000).toISOString();

      // Generate 1-3 markets per match
      const numMarkets = 2 + Math.floor(Math.random() * 4);
      const shuffledMarkets = [...this.markets].sort(() => Math.random() - 0.5);
      const selectedMarkets = shuffledMarkets.slice(0, numMarkets);

      const markets: Market[] = selectedMarkets.map(m => ({
        key: m.key,
        name: m.name,
        outcomes: m.outcomes.map(o => ({
          name: o,
          price: this.generateOdds(m.key, o),
        }))
      }));

      matches.push({
        id: `mock-${this.name.toLowerCase()}-${i}-${Date.now()}`,
        sport: 'football',
        league: t.league,
        homeTeam: t.home,
        awayTeam: t.away,
        startTime,
        bookmaker: this.name,
        markets,
      });
    }

    return { bookmaker: this.name, matches };
  }

  private generateOdds(marketKey: string, outcomeName: string): number {
    // Generate realistic odds with some variation between providers
    const seed = (marketKey + outcomeName).length;
    
    // Base odds by market type
    const baseOdds: Record<string, number[]> = {
      'h2h': [2.10, 3.40, 3.80],
      'both_teams_to_score': [1.85, 1.95],
      'double_chance': [1.30, 1.22, 1.45],
      'over_under_2.5': [1.90, 1.90],
      'over_under_1.5': [1.45, 2.60],
      'over_under_3.5': [2.75, 1.40],
      'asian_handicap': [2.00, 1.80, 2.10, 1.70],
      'exact_score': [7.00, 6.50, 9.00, 7.50, 11.00, 8.00, 12.00, 10.00],
      'draw_no_bet': [1.60, 2.30],
    };

    const odds = baseOdds[marketKey] || [2.00, 3.00, 3.00];
    const idx = this.calculateIndex(outcomeName, odds.length);
    
    // Add 2-8% variation to create surebet opportunities
    const variation = 0.97 + (Math.random() * 0.06);
    return Math.round(odds[idx] * variation * 100) / 100;
  }

  private calculateIndex(name: string, max: number): number {
    // Deterministic index based on name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i);
    }
    return Math.abs(hash) % max;
  }
}

/**
 * Creates mock providers for each bookmaker with slightly different odds
 * to generate surebet opportunities.
 */
export function createAllMockProviders() {
  return [
    new MockProvider('Betano'),
    new MockProvider('Bet365'),
    new MockProvider('Sportingbet'),
    new MockProvider('KTO'),
    new MockProvider('KingPanda'),
    new MockProvider('EstrelaBet'),
  ];
}
