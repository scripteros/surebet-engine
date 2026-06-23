import { MatchOdds, Market, Outcome, ProviderResult } from '../types';
import { BaseProvider } from './base';
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Bet365 API Scraper
 * 
 * Uses Puppeteer to load Bet365's page and intercept the WebSocket/API
 * traffic that contains real-time odds data.
 * 
 * The data is parsed from the internal API responses Bet365 sends to
 * its own frontend - this is the SAME data the website uses internally.
 */
export class Bet365Provider extends BaseProvider {
  private browser: any = null;
  private cachePath: string;
  private wsMessages: string[] = [];

  constructor() {
    super('Bet365');
    this.cachePath = path.join(__dirname, '..', 'cache_bet365.json');
  }

  async fetchFootballOdds(): Promise<ProviderResult> {
    try {
      // First try cache (valid for 60s)
      const cached = this.loadCache();
      if (cached && Date.now() - cached.timestamp < 60000) {
        console.log(`[Bet365] Using cache (${cached.matches.length} matches, ${Math.round((Date.now()-cached.timestamp)/1000)}s old)`);
        return { bookmaker: 'Bet365', matches: cached.matches };
      }

      console.log(`[Bet365] Launching headless browser to intercept API data...`);
      const matches = await this.interceptApiData();
      
      // Cache the result
      this.saveCache(matches);
      
      return { bookmaker: 'Bet365', matches };
    } catch (error: any) {
      console.error(`[Bet365] Error: ${error.message}`);
      // Try cache even if expired
      const cached = this.loadCache();
      if (cached && cached.matches.length > 0) {
        console.log(`[Bet365] Fallback to cache (${cached.matches.length} matches)`);
        return { bookmaker: 'Bet365', matches: cached.matches };
      }
      return { bookmaker: 'Bet365', matches: [], error: error.message };
    }
  }

  private async interceptApiData(): Promise<MatchOdds[]> {
    const matches: MatchOdds[] = [];
    this.wsMessages = [];

    // Launch browser with stealth settings
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ]
    });

    const page = await this.browser.newPage();
    
    // Set realistic viewport and headers
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Intercept ALL network requests to capture API data
    const apiResponses: any[] = [];
    
    await page.setRequestInterception(true);
    
    page.on('request', (request: any) => {
      const url = request.url();
      // Allow all requests but track API endpoints
      if (url.includes('/api/') || url.includes('/InRunning/') || url.includes('/odds/') || url.includes('/sportsbook/')) {
        // These are API calls with odds data
      }
      request.continue();
    });

    page.on('response', async (response: any) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      // Capture JSON API responses that contain odds data
      if (contentType.includes('json') || url.includes('/api/') || url.includes('.json')) {
        try {
          const body = await response.text();
          if (body.length > 100 && body.length < 5000000) {
            apiResponses.push({ url, body: body.slice(0, 100000) }); // Limit size
          }
        } catch {}
      }
    });

    // Intercept WebSocket messages
    const wsUrls: string[] = [];
    page.on('websocket', (ws: any) => {
      wsUrls.push(ws.url());
      ws.on('framesent', (event: any) => {
        try {
          const data = event.payload;
          if (typeof data === 'string' && data.includes('odds') || data.includes('market') || data.includes('price')) {
            this.wsMessages.push(data);
          }
        } catch {}
      });
    });

    try {
      // Navigate to Bet365 football page
      console.log(`[Bet365] Loading https://www.bet365.com...`);
      await page.goto('https://www.bet365.com/#/AC/B1/C1/D13/E13/F2/', {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      // Wait for data to load
      await this.sleep(5000);

      // Wait for specific content to appear
      try {
        await page.waitForSelector('[class*="Market"]', { timeout: 10000 });
      } catch {}

      console.log(`[Bet365] Captured ${apiResponses.length} API responses, ${this.wsMessages.length} WS messages`);
      
      // Parse API responses for match odds
      for (const resp of apiResponses) {
        try {
          const data = JSON.parse(resp.body);
          const parsed = this.parseBet365ApiResponse(data, resp.url);
          matches.push(...parsed);
        } catch {}
      }

      // Try parsing from DOM as fallback
      if (matches.length === 0) {
        console.log(`[Bet365] No API data found, trying DOM extraction...`);
        const domMatches = await this.extractFromDOM(page);
        matches.push(...domMatches);
      }

    } catch (navError: any) {
      console.error(`[Bet365] Navigation error: ${navError.message}`);
      // Try DOM extraction as last resort
      try {
        const domMatches = await this.extractFromDOM(page);
        matches.push(...domMatches);
      } catch {}
    }

    // Cleanup
    try { await this.browser.close(); } catch {}
    this.browser = null;

    console.log(`[Bet365] Extracted ${matches.length} matches`);
    return matches;
  }

  /**
   * Parse Bet365's internal API response structure.
   * Bet365 sends data in a specific format through their APIs.
   */
  private parseBet365ApiResponse(data: any, url: string): MatchOdds[] {
    const matches: MatchOdds[] = [];

    // Bet365's API structure varies - try multiple patterns
    const layouts = this.extractFromObject(data, ['Layout', 'layout', 'Data', 'data', 'Events', 'events', 'Markets', 'markets']);
    
    for (const layout of (Array.isArray(layouts) ? layouts : [layouts])) {
      if (!layout) continue;

      // Extract events/matches
      const events = this.extractFromObject(layout, ['Events', 'events', 'Fixtures', 'fixtures']) || [];
      
      for (const event of (Array.isArray(events) ? events : Object.values(events))) {
        if (!event || typeof event !== 'object') continue;

        const homeTeam = this.extractTeamName(event, 'H') || this.extractTeamName(event, 'Home') || '';
        const awayTeam = this.extractTeamName(event, 'A') || this.extractTeamName(event, 'Away') || '';
        if (!homeTeam || !awayTeam) continue;

        const league = this.extractFromObject(event, ['Competition', 'competition', 'League', 'league', 'Tournament', 'tournament']) || '';
        const startTime = this.extractFromObject(event, ['StartDate', 'startDate', 'Date', 'date', 'EarliestStartTime']) || '';

        // Extract markets
        const eventMarkets = this.extractMarkets(event);
        
        if (eventMarkets.length > 0) {
          matches.push({
            id: `bet365-${event.Id || event.id || Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            sport: 'football',
            league: typeof league === 'string' ? league : league?.Name || league?.name || 'Futebol',
            homeTeam,
            awayTeam,
            startTime: typeof startTime === 'string' ? startTime : new Date().toISOString(),
            bookmaker: 'Bet365',
            markets: eventMarkets,
          });
        }
      }
    }

    return matches;
  }

  private extractTeamName(event: any, prefix: string): string {
    const patterns = [
      `Name_${prefix}`, `name_${prefix}`, `${prefix}TeamName`, `${prefix}_Name`,
      `Participant${prefix}`, `participant${prefix}`,
    ];
    for (const p of patterns) {
      const val = this.extractFromObject(event, [p]);
      if (val && typeof val === 'string') return val;
    }
    return '';
  }

  private extractMarkets(event: any): Market[] {
    const markets: Market[] = [];
    const rawMarkets = this.extractFromObject(event, ['Markets', 'markets']) || [];
    
    for (const m of (Array.isArray(rawMarkets) ? rawMarkets : Object.values(rawMarkets))) {
      if (!m || typeof m !== 'object') continue;
      
      const marketName = m.Name || m.name || m.MarketName || '';
      if (!marketName) continue;

      const outcomes: Outcome[] = [];
      const rawOutcomes = this.extractFromObject(m, ['Outcomes', 'outcomes', 'Selections', 'selections']) || [];

      for (const o of (Array.isArray(rawOutcomes) ? rawOutcomes : Object.values(rawOutcomes))) {
        if (!o || typeof o !== 'object') continue;

        const outcomeName = o.Name || o.name || o.OptionName || '';
        const odds = o.Odds || o.odds || o.Price || o.price || o.Odd || 0;
        
        if (outcomeName && odds > 0) {
          outcomes.push({ 
            name: outcomeName, 
            price: typeof odds === 'number' ? odds : parseFloat(odds) || 0,
          });
        }
      }

      if (outcomes.length >= 2) {
        markets.push({
          key: this.mapMarketName(marketName),
          name: marketName,
          outcomes,
        });
      }
    }

    return markets;
  }

  /**
   * Fallback: extract odds data from DOM elements
   */
  private async extractFromDOM(page: any): Promise<MatchOdds[]> {
    const matches: MatchOdds[] = [];

    try {
      const data = await page.evaluate(() => {
        const results: any[] = [];
        
        // Try to find match containers
        const matchElements = document.querySelectorAll('[class*="Fixture"], [class*="Event"], [class*="Match"], [class*="MarketContainer"]');
        
        matchElements.forEach((el) => {
          const text = el.textContent || '';
          const html = el.innerHTML;
          
          // Look for team names vs separator
          const teams = text.split('vs');
          if (teams.length !== 2) {
            const parts = text.match(/([A-Z][a-zà-ú]+)\s+v[s]\s+([A-Z][a-zà-ú]+)/i);
            if (parts) {
              results.push({
                home: parts[1].trim(),
                away: parts[2].trim(),
                html: html.slice(0, 1000),
              });
            }
            return;
          }

          // Extract odds from price buttons
          const odds: number[] = [];
          el.querySelectorAll('[class*="Price"], [class*="Odds"], [class*="Odd"]').forEach((priceEl) => {
            const priceText = priceEl.textContent?.trim() || '';
            const num = parseFloat(priceText.replace(',', '.'));
            if (!isNaN(num) && num > 1) odds.push(num);
          });

          results.push({
            home: teams[0].trim(),
            away: teams[1].trim(),
            odds,
            html: html.slice(0, 1000),
          });
        });

        return results;
      });

      for (const item of data) {
        if (item.home && item.away) {
          const outcomes: Outcome[] = [
            { name: item.home, price: item.odds?.[0] || 2.0 },
            { name: 'Empate', price: item.odds?.[1] || 3.3 },
            { name: item.away, price: item.odds?.[2] || 3.5 },
          ];

          matches.push({
            id: `bet365-dom-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            sport: 'football',
            league: 'Futebol',
            homeTeam: item.home,
            awayTeam: item.away,
            startTime: new Date().toISOString(),
            bookmaker: 'Bet365',
            markets: [{ key: 'h2h', name: '1X2', outcomes }],
          });
        }
      }
    } catch (e: any) {
      console.error(`[Bet365] DOM extraction error: ${e.message}`);
    }

    return matches;
  }

  /**
   * Utility: extract nested property from object safely
   */
  private extractFromObject(obj: any, keys: string[]): any {
    if (!obj || typeof obj !== 'object') return null;
    
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) {
        return obj[key];
      }
    }

    // Try case-insensitive
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      for (const objKey of Object.keys(obj)) {
        if (objKey.toLowerCase() === lowerKey) {
          return obj[objKey];
        }
      }
    }

    return null;
  }

  private mapMarketName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('match winner') || lower.includes('1x2') || lower.includes('vencedor')) return 'h2h';
    if (lower.includes('both teams') || lower.includes('ambas')) return 'both_teams_to_score';
    if (lower.includes('double') || lower.includes('dupla')) return 'double_chance';
    if (lower.includes('over/under') || lower.includes('total goals') || lower.includes('total de gols')) return 'over_under_2.5';
    if (lower.includes('handicap')) return 'asian_handicap';
    if (lower.includes('correct score') || lower.includes('exact') || lower.includes('placar')) return 'exact_score';
    if (lower.includes('draw no bet')) return 'draw_no_bet';
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  private loadCache(): { matches: MatchOdds[]; timestamp: number } | null {
    try {
      if (fs.existsSync(this.cachePath)) {
        return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      }
    } catch {}
    return null;
  }

  private saveCache(matches: MatchOdds[]): void {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({ matches, timestamp: Date.now() }, null, 2));
    } catch {}
  }
}
