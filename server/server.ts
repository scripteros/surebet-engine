import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = parseInt(process.env.PORT || '3009');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// ============================================================
// BOOKMAKERS - Brazilian market, fully manageable
// ============================================================
const BOOKMAKERS_PATH = path.join(__dirname, 'bookmakers.json');

function loadBookmakers(): any[] {
  try {
    if (fs.existsSync(BOOKMAKERS_PATH)) {
      return JSON.parse(fs.readFileSync(BOOKMAKERS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return getDefaultBookmakers();
}

function saveBookmakers(data: any[]) {
  try {
    fs.writeFileSync(BOOKMAKERS_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erro ao salvar bookmakers:', e);
  }
}

function getDefaultBookmakers() {
  return [
    { id: 1, nome: 'Betano', key: 'betano', ativo: true, imagem: '' },
    { id: 2, nome: 'KingPanda', key: 'kingpanda', ativo: true, imagem: '' },
    { id: 3, nome: 'Bet365', key: 'bet365', ativo: true, imagem: '' },
    { id: 4, nome: 'Sportingbet', key: 'sportingbet', ativo: true, imagem: '' },
    { id: 5, nome: 'KTO', key: 'kto', ativo: true, imagem: '' },
    { id: 6, nome: 'EstrelaBet', key: 'estrelabet', ativo: true, imagem: '' },
    { id: 7, nome: 'BETesporte', key: 'betesporte', ativo: true, imagem: '' },
    { id: 8, nome: 'Superbet', key: 'superbet', ativo: true, imagem: '' },
    { id: 9, nome: 'PixBet', key: 'pixbet', ativo: true, imagem: '' },
    { id: 10, nome: 'BR4Bet', key: 'br4bet', ativo: true, imagem: '' },
    { id: 11, nome: 'Bodog', key: 'bodog', ativo: true, imagem: '' },
    { id: 12, nome: 'Bet7k', key: 'bet7k', ativo: true, imagem: '' },
    { id: 13, nome: 'Rivalo', key: 'rivalo', ativo: true, imagem: '' },
    { id: 14, nome: 'Betmotion', key: 'betmotion', ativo: true, imagem: '' },
    { id: 15, nome: 'LeoVegas', key: 'leovegas', ativo: true, imagem: '' },
    { id: 16, nome: 'Betway', key: 'betway', ativo: true, imagem: '' },
    { id: 17, nome: 'Pinnacle', key: 'pinnacle', ativo: true, imagem: '' },
    { id: 18, nome: 'Bwin', key: 'bwin', ativo: true, imagem: '' },
    { id: 19, nome: 'Betfair', key: 'betfair', ativo: true, imagem: '' },
    { id: 20, nome: 'Betano BR', key: 'betano_br', ativo: true, imagem: '' },
  ];
}

// ============================================================
// THE ODDS API PROXY
// ============================================================
function getApiKey(): string {
  const envKey = process.env.ODDS_API_KEY;
  if (envKey) return envKey;
  try {
    const configPath = path.join(__dirname, '..', 'api_key.txt');
    if (fs.existsSync(configPath)) {
      return fs.readFileSync(configPath, 'utf-8').trim();
    }
  } catch (e) {}
  return '04e307cabb5ec3e7b3596faa06c3e00b';
}

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const API_KEY = getApiKey();

// Proxy: list sports
app.get('/api/odds/sports', async (req, res) => {
  try {
    const resp = await fetch(`${ODDS_API_BASE}/sports/?apiKey=${API_KEY}`);
    const data = await resp.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy: get odds for a sport
app.get('/api/odds/sport/:sport', async (req, res) => {
  try {
    const { sport } = req.params;
    const regions = String(req.query.regions || 'us,eu,uk,au,br,cl');
    const markets = String(req.query.markets || 'h2h,totals,spreads');
    const dateFormat = String(req.query.dateFormat || 'iso');
    const oddsFormat = String(req.query.oddsFormat || 'decimal');
    
    const url = `${ODDS_API_BASE}/sports/${sport}/odds/`
      + `?apiKey=${API_KEY}&regions=${regions}&markets=${markets}`
      + `&oddsFormat=${oddsFormat}&dateFormat=${dateFormat}`;
    
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy: get events for a sport
app.get('/api/odds/sport/:sport/events', async (req, res) => {
  try {
    const { sport } = req.params;
    const dateFormat = String(req.query.dateFormat || 'iso');
    const url = `${ODDS_API_BASE}/sports/${sport}/events/?apiKey=${API_KEY}&dateFormat=${dateFormat}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// BOOKMAKERS CRUD
// ============================================================
app.get('/api/bookmakers', (req, res) => {
  res.json({ ok: true, bookmakers: loadBookmakers() });
});

app.post('/api/bookmakers', (req, res) => {
  const { nome, key, imagem } = req.body;
  if (!nome || !key) {
    return res.status(400).json({ ok: false, error: 'Nome e key são obrigatórios' });
  }
  const list = loadBookmakers();
  const maxId = list.reduce((max, b) => Math.max(max, b.id), 0);
  const novo = { id: maxId + 1, nome, key, ativo: true, imagem: imagem || '' };
  list.push(novo);
  saveBookmakers(list);
  res.json({ ok: true, bookmaker: novo, bookmakers: list });
});

app.put('/api/bookmakers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const list = loadBookmakers();
  const idx = list.findIndex(b => b.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Bookmaker não encontrado' });
  
  if (req.body.nome !== undefined) list[idx].nome = req.body.nome;
  if (req.body.key !== undefined) list[idx].key = req.body.key;
  if (req.body.ativo !== undefined) list[idx].ativo = req.body.ativo;
  if (req.body.imagem !== undefined) list[idx].imagem = req.body.imagem;
  
  saveBookmakers(list);
  res.json({ ok: true, bookmaker: list[idx], bookmakers: list });
});

app.delete('/api/bookmakers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const list = loadBookmakers();
  const idx = list.findIndex(b => b.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Bookmaker não encontrado' });
  
  list.splice(idx, 1);
  saveBookmakers(list);
  res.json({ ok: true, message: 'Bookmaker removido', bookmakers: list });
});

// ============================================================
// SPA FALLBACK
// SPA FALLBACK - must be LAST
app.get(/^\/(?!api\/).*/, (req, res) => {
  const indexPath = path.join(frontendDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).json({ ok: true, message: 'Surebet Engine - API no ar' });
  }
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`\n🎯 Surebet Engine Brasileiro rodando em http://localhost:${PORT}`);
  console.log(`📡 Proxy API: The Odds API (chave configurada)`);
  console.log(`📊 Bookmakers cadastrados: ${loadBookmakers().length}`);
  console.log(`💰 Moeda: BRL (R$)`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`📋 Endpoints:`);
  console.log(`   GET /api/odds/sports        → Listar esportes`);
  console.log(`   GET /api/odds/sport/:sport  → Odds de um esporte`);
  console.log(`   GET /api/bookmakers          → Listar casas`);
  console.log(`   POST /api/bookmakers         → Adicionar casa`);
  console.log(`   PUT /api/bookmakers/:id      → Editar casa`);
  console.log(`   DELETE /api/bookmakers/:id   → Remover casa\n`);
});
