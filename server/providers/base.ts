import axios from 'axios';
import { MatchOdds, ProviderResult } from '../types';

/**
 * Base class for all odds providers.
 * Each bookmaker implements its own provider by extending this class.
 */
export abstract class BaseProvider {
  public name: string;
  protected client;

  constructor(name: string, baseURL?: string) {
    this.name = name;
    this.client = axios.create({
      baseURL: baseURL || 'https://www.betano.com',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      }
    });
  }

  abstract fetchFootballOdds(): Promise<ProviderResult>;

  protected parseOdds(oddsStr: string): number {
    const cleaned = oddsStr.replace(/[^\d.,]/g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
