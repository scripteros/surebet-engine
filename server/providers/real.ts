import * as cheerio from 'cheerio';
import { MatchOdds, Market, Outcome, ProviderResult } from '../types';
import { BaseProvider } from './base';

/**
 * Real provider using HTTP requests (axios + cheerio).
 * Falls back only if JavaScript rendering is required.
 */
export class BetanoRealProvider extends BaseProvider {
  constructor() { super('Betano', 'https://www.betano.com'); }

  async fetchFootballOdds(): Promise<ProviderResult> {
    try {
      const matches: MatchOdds[] = [];
      
      // Try Betano's GraphQL API first
      const query = { operationName: 'getEvents', variables: { sportId: 3 }, query: `query getEvents($sportId:Int){getSport(sportId:$sportId){competitions{id name events(status:"PREMATCH"){id name startTime participants{name type} markets{id name outcomes{id name odds}}}}}}` };
      
      const resp = await this.client.post('/api/graphql', query, {
        headers: { 'Content-Type': 'application/json', 'x-betano-platform': 'web' }
      });
      
      const data = resp.data;
      if (data?.data?.getSport?.competitions) {
        for (const comp of data.data.getSport.competitions) {
          for (const ev of (comp.events || [])) {
            const home = ev.participants?.find((p:any) => p.type === 'HOME');
            const away = ev.participants?.find((p:any) => p.type === 'AWAY');
            if (!home || !away) continue;
            
            const markets: Market[] = (ev.markets || []).map((m:any) => ({
              key: this.normalizeMarket(m.name),
              name: m.name,
              outcomes: (m.outcomes || []).map((o:any) => ({ name: o.name, price: o.odds }))
            }));
            
            if (markets.length > 0) {
              matches.push({
                id: `betano-${ev.id}`, sport: 'football', league: comp.name,
                homeTeam: home.name, awayTeam: away.name,
                startTime: ev.startTime, bookmaker: 'Betano',
                markets, url: `https://www.betano.com/sport/football/${comp.name?.toLowerCase().replace(/\s+/g,'-')}/${ev.id}`
              });
            }
          }
        }
      }
      return { bookmaker: 'Betano', matches };
    } catch (e: any) {
      return { bookmaker: 'Betano', matches: [], error: e.message };
    }
  }

  private normalizeMarket(name: string): string {
    const map: Record<string,string> = {
      'Vencedor da Partida':'h2h','1X2':'h2h','Match Winner':'h2h',
      'Ambas Marcam':'both_teams_to_score','Both Teams to Score':'both_teams_to_score',
      'Total de Gols':'over_under_2.5','Over/Under 2.5':'over_under_2.5',
      'Over/Under 1.5':'over_under_1.5','Over/Under 3.5':'over_under_3.5',
      'Dupla Chance':'double_chance','Double Chance':'double_chance',
      'Handicap Asiático':'asian_handicap','Asian Handicap':'asian_handicap',
      'Placar Exato':'exact_score','Correct Score':'exact_score',
      'Vencedor do 1º Tempo':'first_half_1x2'
    };
    return map[name] || name.toLowerCase().replace(/[\s/]+/g,'_');
  }
}

/**
 * Generic HTML scraper using cheerio for simpler bookmaker pages.
 */
export class HTMLScraperProvider extends BaseProvider {
  private selectors: {
    matchContainer: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    oddsRow: string;
    outcomeName: string;
    outcomeOdds: string;
    matchUrl?: string;
  };
  private baseUrl: string;

  constructor(name: string, entryUrl: string, selectors: typeof HTMLScraperProvider.prototype.selectors) {
    super(name, new URL(entryUrl).origin);
    this.baseUrl = entryUrl;
    this.selectors = selectors;
  }

  async fetchFootballOdds(): Promise<ProviderResult> {
    try {
      const resp = await this.client.get(this.baseUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const $ = cheerio.load(resp.data);
      const matches: MatchOdds[] = [];
      
      $(this.selectors.matchContainer).each((_, el) => {
        const $el = $(el);
        const home = $el.find(this.selectors.homeTeam).text().trim();
        const away = $el.find(this.selectors.awayTeam).text().trim();
        const league = $el.find(this.selectors.league).text().trim() || 'Futebol';
        const matchUrl = this.selectors.matchUrl ? $el.find(this.selectors.matchUrl).attr('href') || '' : '';
        
        if (!home || !away) return;
        
        const outcomes: Outcome[] = [];
        $el.find(this.selectors.oddsRow).each((_, row) => {
          const name = $(row).find(this.selectors.outcomeName).text().trim() || '';
          const priceStr = $(row).find(this.selectors.outcomeOdds).text().trim();
          const price = this.parseOdds(priceStr);
          if (price > 0) outcomes.push({ name, price });
        });
        
        if (outcomes.length >= 2) {
          matches.push({
            id: `${this.name.toLowerCase()}-${matches.length}-${Date.now()}`,
            sport: 'football', league,
            homeTeam: home, awayTeam: away,
            startTime: new Date().toISOString(),
            bookmaker: this.name,
            markets: [{ key: 'h2h', name: '1X2', outcomes }],
            url: matchUrl ? new URL(matchUrl, this.baseUrl).href : this.baseUrl,
          });
        }
      });
      
      return { bookmaker: this.name, matches };
    } catch (e: any) {
      return { bookmaker: this.name, matches: [], error: e.message };
    }
  }
}

/**
 * Puppeteer-based provider for JavaScript-rendered bookmakers.
 */
export class PuppeteerProvider extends BaseProvider {
  private config: {
    url: string;
    waitForSelector: string;
    matchSelector: string;
    homeSelector: string;
    awaySelector: string;
    oddsSelector: string;
    outcomeSelector: string;
    priceSelector: string;
    leagueSelector: string;
    urlSelector?: string;
  };
  private browserPromise: Promise<any> | null = null;

  constructor(name: string, config: typeof PuppeteerProvider.prototype.config) {
    super(name);
    this.config = config;
  }

  private async getBrowser() {
    if (!this.browserPromise) {
      const puppeteer = require('puppeteer');
      this.browserPromise = puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    }
    return this.browserPromise;
  }

  async fetchFootballOdds(): Promise<ProviderResult> {
    let browser: any = null;
    try {
      browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Block images, fonts, etc for speed
      await page.setRequestInterception(true);
      page.on('request', (req: any) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) req.abort();
        else req.continue();
      });
      
      await page.goto(this.config.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector(this.config.waitForSelector, { timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000)); // Extra wait for dynamic content
      
      const matches: MatchOdds[] = await page.evaluate((cfg) => {
        const results: any[] = [];
        const containers = document.querySelectorAll(cfg.matchSelector);
        
        containers.forEach((container: any) => {
          const home = container.querySelector(cfg.homeSelector)?.textContent?.trim();
          const away = container.querySelector(cfg.awaySelector)?.textContent?.trim();
          if (!home || !away) return;
          
          const league = container.closest('[data-league]')?.querySelector(cfg.leagueSelector)?.textContent?.trim() || 'Futebol';
          const matchUrl = cfg.urlSelector ? container.querySelector(cfg.urlSelector)?.getAttribute('href') || '' : '';
          
          const outcomes: {name:string;price:number}[] = [];
          container.querySelectorAll(cfg.oddsSelector).forEach((btn: any) => {
            const name = btn.querySelector(cfg.outcomeSelector)?.textContent?.trim() || '';
            const priceStr = btn.querySelector(cfg.priceSelector)?.textContent?.trim() || '';
            const price = parseFloat(priceStr.replace(/[^\d.,]/g,'').replace(',','.')) || 0;
            if (price > 0) outcomes.push({ name, price });
          });
          
          if (outcomes.length >= 2) {
            results.push({
              id: cfg.bookmaker + '-' + results.length + '-' + Date.now(),
              sport: 'football', league, homeTeam: home, awayTeam: away,
              startTime: new Date().toISOString(),
              bookmaker: cfg.bookmaker,
              markets: [{ key: 'h2h', name: '1X2', outcomes }],
              url: matchUrl || cfg.baseUrl,
            });
          }
        });
        
        return results;
      }, { ...this.config, bookmaker: this.name, baseUrl: this.config.url });
      
      await page.close();
      return { bookmaker: this.name, matches };
    } catch (e: any) {
      if (browser) { try { await browser.close(); } catch {} }
      return { bookmaker: this.name, matches: [], error: e.message };
    }
  }
}
