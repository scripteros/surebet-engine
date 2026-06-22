import * as cheerio from 'cheerio';
import { MatchOdds, Market, Outcome, ProviderResult } from '../types';
import { BaseProvider } from './base';

/**
 * Betano Provider - Scrapes odds from Betano.com
 * Uses their public API endpoints for football matches
 */
export class BetanoProvider extends BaseProvider {
  constructor() {
    super('Betano', 'https://www.betano.com');
  }

  async fetchFootballOdds(): Promise<ProviderResult> {
    try {
      // Betano's GraphQL endpoint for live/prematch odds
      const matches = await this.scrapeFromAPI();
      return { bookmaker: this.name, matches };
    } catch (error: any) {
      // Fallback: try scraping the webpage directly
      try {
        const matches = await this.scrapeFromPage();
        return { bookmaker: this.name, matches };
      } catch (err2: any) {
        return {
          bookmaker: this.name,
          matches: [],
          error: `Ambas tentativas falharam: ${error.message} | ${err2.message}`
        };
      }
    }
  }

  private async scrapeFromAPI(): Promise<MatchOdds[]> {
    // Betano uses a GraphQL endpoint
    const query = {
      operationName: 'GetFootballMatches',
      variables: { sportId: 3, marketType: 'standard' },
      query: `
        query GetFootballMatches($sportId: Int!) {
          getSport(sportId: $sportId) {
            competitions {
              id name
              events(status:"PREMATCH") {
                id name startTime
                participants { name type }
                markets(marketType:"standard") {
                  id name
                  outcomes { id name odds }
                }
              }
            }
          }
        }
      `
    };

    const resp = await this.client.post('/api/graphql', query, {
      headers: {
        'Content-Type': 'application/json',
        'x-betano-client': 'web',
      }
    });

    const matches: MatchOdds[] = [];
    const data = resp.data;

    if (!data?.data?.getSport?.competitions) return matches;

    for (const comp of data.data.getSport.competitions) {
      for (const event of (comp.events || [])) {
        const home = event.participants?.find((p: any) => p.type === 'HOME');
        const away = event.participants?.find((p: any) => p.type === 'AWAY');
        if (!home || !away) continue;

        const markets: Market[] = (event.markets || []).map((m: any) => ({
          key: this.mapMarketName(m.name),
          name: m.name,
          outcomes: (m.outcomes || []).map((o: any) => ({
            name: o.name,
            price: o.odds,
          }))
        }));

        if (markets.length === 0) continue;

        matches.push({
          id: `betano-${event.id}`,
          sport: 'football',
          league: comp.name,
          homeTeam: home.name,
          awayTeam: away.name,
          startTime: event.startTime,
          bookmaker: 'Betano',
          markets,
        });
      }
    }

    return matches;
  }

  private async scrapeFromPage(): Promise<MatchOdds[]> {
    // Fallback: scrape the HTML page
    const resp = await this.client.get('/sport/football/');
    const $ = cheerio.load(resp.data);
    const matches: MatchOdds[] = [];

    // Parse match cards from the page
    $('[data-testid="event-card"]').each((_, el) => {
      const $el = $(el);
      const homeTeam = $el.find('[data-testid="participant-home"]').text().trim();
      const awayTeam = $el.find('[data-testid="participant-away"]').text().trim();
      const league = $el.closest('[data-testid="competition"]').find('[data-testid="competition-name"]').text().trim();

      if (!homeTeam || !awayTeam) return;

      const outcomes: Outcome[] = [];
      $el.find('[data-testid="outcome-button"]').each((_, btn) => {
        const $btn = $(btn);
        const name = $btn.find('[data-testid="outcome-name"]').text().trim() || '';
        const price = this.parseOdds($btn.find('[data-testid="outcome-price"]').text().trim());
        if (price > 0) {
          outcomes.push({ name, price });
        }
      });

      if (outcomes.length >= 2) {
        matches.push({
          id: `betano-page-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          sport: 'football',
          league: league || 'Futebol',
          homeTeam,
          awayTeam,
          startTime: $el.attr('data-start-time') || new Date().toISOString(),
          bookmaker: 'Betano',
          markets: [{ key: 'h2h', name: '1X2', outcomes }],
        });
      }
    });

    return matches;
  }

  private mapMarketName(name: string): string {
    const map: Record<string, string> = {
      'Vencedor da Partida': 'h2h',
      '1X2': 'h2h',
      'Match Winner': 'h2h',
      'Ambas Marcam': 'both_teams_to_score',
      'Both Teams to Score': 'both_teams_to_score',
      'Total de Gols': 'over_under',
      'Over/Under': 'over_under',
      'Dupla Chance': 'double_chance',
      'Double Chance': 'double_chance',
      'Handicap': 'asian_handicap',
      'Asian Handicap': 'asian_handicap',
      'Placar Exato': 'exact_score',
      'Correct Score': 'exact_score',
    };
    return map[name] || name.toLowerCase().replace(/\s+/g, '_');
  }

  // Uses base class parseOdds
}
