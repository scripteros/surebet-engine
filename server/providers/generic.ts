import { MatchOdds, Market, Outcome, ProviderResult } from '../types';
import { BaseProvider } from './base';
import * as cheerio from 'cheerio';

/**
 * Generic Scraper Provider - template for adding new bookmakers.
 * Just override the URL, selectors, and parsing logic.
 */
export class GenericScraperProvider extends BaseProvider {
  private config: {
    url: string;
    matchSelector: string;
    homeSelector: string;
    awaySelector: string;
    leagueSelector: string;
    oddsSelector: string;
    outcomeNameSelector: string;
    oddsPriceSelector: string;
  };

  constructor(
    name: string,
    config: {
      url: string;
      matchSelector: string;
      homeSelector: string;
      awaySelector: string;
      leagueSelector: string;
      oddsSelector: string;
      outcomeNameSelector: string;
      oddsPriceSelector: string;
    }
  ) {
    super(name, new URL(config.url).origin);
    this.config = config;
  }

  async fetchFootballOdds(): Promise<ProviderResult> {
    try {
      const resp = await this.client.get(this.config.url);
      const $ = cheerio.load(resp.data);
      const matches: MatchOdds[] = [];

      $(this.config.matchSelector).each((_, el) => {
        const $el = $(el);
        const homeTeam = $el.find(this.config.homeSelector).text().trim();
        const awayTeam = $el.find(this.config.awaySelector).text().trim();
        const league = $el.closest('[data-league]').find(this.config.leagueSelector).text().trim() || 'Futebol';

        if (!homeTeam || !awayTeam) return;

        const outcomes: Outcome[] = [];
        $el.find(this.config.oddsSelector).each((_, btn) => {
          const $btn = $(btn);
          const name = $btn.find(this.config.outcomeNameSelector).text().trim() || '';
          const price = this.parseOdds($btn.find(this.config.oddsPriceSelector).text().trim());
          if (price > 0) {
            outcomes.push({ name, price });
          }
        });

        if (outcomes.length >= 2) {
          matches.push({
            id: `${this.name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            sport: 'football',
            league,
            homeTeam,
            awayTeam,
            startTime: new Date().toISOString(),
            bookmaker: this.name,
            markets: [{ key: 'h2h', name: '1X2', outcomes }],
          });
        }
      });

      return { bookmaker: this.name, matches };
    } catch (error: any) {
      return { bookmaker: this.name, matches: [], error: error.message };
    }
  }
}
