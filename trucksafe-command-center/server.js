'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

// Tiny .env loader so the starter works without third-party packages.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const ix = trimmed.indexOf('=');
    if (ix < 1) continue;
    const key = trimmed.slice(0, ix).trim();
    let value = trimmed.slice(ix + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv(path.join(ROOT, '.env'));

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const API_KEY = process.env.OPENAI_API_KEY || '';
const html = fs.readFileSync(path.join(ROOT, 'index.html'));

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) { reject(new Error('Request body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Corpo JSON inválido')); }
    });
    req.on('error', reject);
  });
}
function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const chunks = [];
  for (const item of data.output || []) for (const part of item.content || []) if (part.type === 'output_text' && part.text) chunks.push(part.text);
  return chunks.join('\n').trim();
}
async function askModel(instructions, input, maxOutputTokens = 1200) {
  if (!API_KEY) throw Object.assign(new Error('OPENAI_API_KEY não configurada no servidor. Copie .env.example para .env e adicione sua chave.'), { status: 503 });
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, instructions, input, max_output_tokens: maxOutputTokens })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result.error?.message || `O provedor retornou HTTP ${response.status}`;
    throw Object.assign(new Error(detail), { status: response.status === 401 ? 502 : response.status });
  }
  const text = extractText(result);
  if (!text) throw Object.assign(new Error('O modelo retornou uma resposta vazia.'), { status: 502 });
  return text;
}
const coordinatorInstructions = `Você é o Coordenador Técnico do TruckSafe, um aplicativo Flutter de navegação e segurança para caminhoneiros. Responda em português brasileiro, seja direto e diferencie fatos de hipóteses. Nesta primeira versão NÃO existe acesso ao repositório nem aos arquivos do projeto, a menos que o usuário os cole explicitamente na mensagem. Nunca afirme que abriu arquivos, executou testes, corrigiu código ou verificou algo que não aconteceu. Seu trabalho é transformar a solicitação em um plano prático com: objetivo, agentes especializados sugeridos, arquivos a solicitar/analisar, testes, riscos e aprovações humanas. Não inclua chaves ou segredos. Marque qualquer diagnóstico como hipótese se não houver evidência do código.`;
const taskInstructions = `Você coordena uma central multiagente para o projeto TruckSafe. Receberá uma tarefa e precisa produzir um plano em português brasileiro. Deixe claro que, sem integração ao repositório ou arquivos anexados, os agentes não conseguem confirmar a causa nem editar código. Organize a resposta em: RESUMO; AGENTES E RESPONSABILIDADES; ARQUIVOS A ANALISAR; TESTES; APROVAÇÕES; PRÓXIMO PASSO. Seja conciso, tecnicamente útil e não invente resultados de execução.`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, service: 'TruckSafe AI Command', apiConfigured: Boolean(API_KEY), model: API_KEY ? MODEL : null, repoConnected: false, note: 'A integração do repositório ainda não está implementada.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readJson(req);
      const prompt = String(body.message || '').trim();
      if (!prompt) return send(res, 400, { error: 'Escreva uma mensagem.' });
      const answer = await askModel(coordinatorInstructions, prompt, 1000);
      return send(res, 200, { answer, model: MODEL });
    } catch (error) { return send(res, error.status || 500, { error: error.message || 'Falha ao processar a mensagem.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/task') {
    try {
      const body = await readJson(req);
      const task = String(body.task || '').trim();
      if (!task) return send(res, 400, { error: 'A tarefa está vazia.' });
      const context = String(body.context || 'Não há repositório conectado nem arquivos do código disponibilizados.');
      const answer = await askModel(taskInstructions, `Projeto: TruckSafe\nTarefa: ${task}\nContexto informado: ${context}\n\nCrie o plano solicitado. Não diga que executou a tarefa.`, 1600);
      return send(res, 200, { answer, model: MODEL, executed: false, repositoryConnected: false });
    } catch (error) { return send(res, error.status || 500, { error: error.message || 'Falha ao planejar a tarefa.' }); }
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, html, 'text/html; charset=utf-8');
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Endpoint não encontrado.' });
  return send(res, 404, { error: 'Página não encontrada.' });
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TruckSafe AI Command disponível em http://localhost:${PORT}`);
  console.log(`Provedor de IA: ${API_KEY ? `configurado (${MODEL})` : 'não configurado — modo local/demo'}`);
});
