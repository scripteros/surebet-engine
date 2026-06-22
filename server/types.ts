export interface MatchOdds {
  id: string
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  startTime: string
  bookmaker: string
  markets: Market[]
}

export interface Market {
  key: string
  name: string
  outcomes: Outcome[]
}

export interface Outcome {
  name: string
  price: number
  point?: number
}

export interface SurebetOpportunity {
  id: string
  match: string
  league: string
  startTime: string
  market: string
  profitPercent: number
  totalInvestment: number
  guaranteedProfit: number
  legs: SurebetLeg[]
  bookmakers: string[]
  source: string
}

export interface SurebetLeg {
  outcome: string
  bookmaker: string
  odds: number
  stake: number
  payout: number
}

export interface ProviderResult {
  bookmaker: string
  matches: MatchOdds[]
  error?: string
}

export interface ProviderConfig {
  name: string
  enabled: boolean
  priority: number
  config: Record<string, any>
}
