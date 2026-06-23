import express from 'express';
import cors from 'cors';
import path from 'path';
import { MatchOdds, SurebetOpportunity } from './types';
import { findSurebets, getAvailableMarkets } from './engine/surebet';
import { createAllMockProviders } from './providers/mock';

const app = express();
const PORT = process.env.PORT || 3009;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

let oddsCache: MatchOdds[] = [];
let surebetCache: SurebetOpportunity[] = [];
let lastUpdate = 0;
const CACHE_TTL = 60_000;

// Mock providers only (stable, fast, real-looking data)
const providers = createAllMockProviders();

async function refreshData() {
  if (providers.length === 0) return;
  console.log(`[${new Date().toLocaleTimeString()}] Fetching odds from ${providers.length} providers...`);

  const allMatches: MatchOdds[] = [];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const result = await provider.fetchFootballOdds();
      allMatches.push(...result.matches);
      if (result.error) errors.push(`${provider.name}: ${result.error}`);
      console.log(`  ${result.matches.length > 0 ? '✅' : '⚠️'} ${provider.name}: ${result.matches.length} matches`);
    } catch (e: any) {
      errors.push(`${provider.name}: ${e.message}`);
      console.log(`  ❌ ${provider.name}: ${e.message}`);
    }
  }

  oddsCache = allMatches;
  surebetCache = findSurebets(allMatches);
  lastUpdate = Date.now();

  console.log(`\n✅ ${allMatches.length} total matches`);
  console.log(`🎯 ${surebetCache.length} surebet opportunities`);
  if (surebetCache.length > 0) {
    surebetCache.slice(0, 3).forEach(s =>
      console.log(`   ${s.match} → ${s.profitPercent}% (${s.market})`)
    );
  }
  if (errors.length > 0) console.log(`⚠️  ${errors.length} errors`);
  console.log('');
}

// Update every 60s
setInterval(refreshData, CACHE_TTL);
refreshData();

// === API ROUTES ===

app.get('/api/matches', (req, res) => {
  const { bookmaker, league, market } = req.query;
  let filtered = [...oddsCache];
  if (bookmaker) filtered = filtered.filter(m => m.bookmaker.toLowerCase() === String(bookmaker).toLowerCase());
  if (league) filtered = filtered.filter(m => m.league.toLowerCase().includes(String(league).toLowerCase()));
  if (market) filtered = filtered.filter(m => m.markets.some(mk => mk.key === market));
  res.json({ ok: true, total: filtered.length, matches: filtered.slice(0, 200), lastUpdate });
});

app.get('/api/surebets', (req, res) => {
  const { minProfit, market, query, limit } = req.query;
  let filtered = [...surebetCache];
  if (minProfit) filtered = filtered.filter(s => s.profitPercent >= Number(minProfit));
  if (market) filtered = filtered.filter(s => s.market === market);
  if (query) {
    const q = String(query).toLowerCase();
    filtered = filtered.filter(s => s.match.toLowerCase().includes(q) || s.league.toLowerCase().includes(q));
  }

  const seen = new Set<string>();
  const deduped = filtered.filter(s => {
    const key = `${s.match}|${s.market}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json({
    ok: true,
    total: deduped.length,
    totalRaw: surebetCache.length,
    opportunities: deduped.slice(0, Number(limit) || 100),
    lastUpdate,
    providers: providers.map(p => p.name),
  });
});

app.get('/api/stats', (req, res) => {
  const byBookmaker: Record<string, number> = {};
  const byLeague: Record<string, number> = {};
  const byMarket: Record<string, number> = {};

  oddsCache.forEach(m => {
    byBookmaker[m.bookmaker] = (byBookmaker[m.bookmaker] || 0) + 1;
    byLeague[m.league] = (byLeague[m.league] || 0) + 1;
    m.markets.forEach(mk => { byMarket[mk.key] = (byMarket[mk.key] || 0) + 1; });
  });

  res.json({
    ok: true,
    stats: {
      totalMatches: oddsCache.length,
      totalSurebets: surebetCache.length,
      totalProviders: providers.length,
      providers: providers.map(p => p.name),
      matchesByBookmaker: byBookmaker,
      matchesByLeague: byLeague,
      marketsByCount: byMarket,
      avgProfit: surebetCache.length > 0
        ? Math.round(surebetCache.reduce((s, o) => s + o.profitPercent, 0) / surebetCache.length * 100) / 100 : 0,
      bestProfit: surebetCache.length > 0 ? Math.max(...surebetCache.map(o => o.profitPercent)) : 0,
      lastUpdate,
    },
    availableMarkets: getAvailableMarkets(),
  });
});

app.post('/api/refresh', async (req, res) => {
  await refreshData();
  res.json({ ok: true, message: 'Dados atualizados' });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎯 Surebet Engine rodando em http://localhost:${PORT}`);
  console.log(`📊 ${providers.length} bookmakers configurados:`);
  providers.forEach(p => console.log(`   - ${p.name}`));
  console.log(`⚽ Mercados: ${getAvailableMarkets().map(m => m.name).join(', ')}`);
  console.log(`\n📋 Endpoints:`);
  console.log(`   GET /api/matches     → Todas as odds`);
  console.log(`   GET /api/surebets    → Oportunidades de surebet`);
  console.log(`   GET /api/stats       → Estatísticas`);
  console.log(`   POST /api/refresh    → Forçar atualização\n`);
});
