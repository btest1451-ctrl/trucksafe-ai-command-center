'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// ======================================================
// CONFIGURAÇÃO
// ======================================================

const ROOT = __dirname;
const MAX_BODY_SIZE = 1_000_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_TEXT = 4000;
const MAX_PROMPT_TEXT = 8000;

// Carrega o .env antes de ler as configurações.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index < 1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY || '';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT inválida. Use uma porta entre 1 e 65535.');
}

const INDEX_PATH = path.join(ROOT, 'index.html');
const SESSIONS_PATH = path.join(ROOT, 'sessions-addon.js');

if (!fs.existsSync(INDEX_PATH)) {
  throw new Error('Arquivo index.html não encontrado.');
}

const html = fs.readFileSync(INDEX_PATH);

// ======================================================
// RESPOSTAS HTTP
// ======================================================

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  if (res.writableEnded || res.destroyed) return;

  res.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });

  if (Buffer.isBuffer(body) || typeof body === 'string') {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

function sendError(res, status, message) {
  return send(res, status, { error: message });
}

// ======================================================
// LEITURA SEGURA DO JSON
// ======================================================

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    req.on('data', chunk => {
      if (settled) return;

      raw += chunk.toString('utf8');

      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_SIZE) {
        fail(Object.assign(
          new Error('Requisição muito grande. Limite de 1 MB.'),
          { status: 413 }
        ));

        req.resume();
      }
    });

    req.on('end', () => {
      if (settled) return;

      try {
        const data = raw ? JSON.parse(raw) : {};

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('O corpo deve ser um objeto JSON.');
        }

        settled = true;
        resolve(data);
      } catch {
        fail(Object.assign(
          new Error('JSON inválido.'),
          { status: 400 }
        ));
      }
    });

    req.on('error', error => fail(error));
    req.on('aborted', () => {
      fail(Object.assign(
        new Error('A requisição foi interrompida.'),
        { status: 400 }
      ));
    });
  });
}

// ======================================================
// HISTÓRICO DAS CONVERSAS
// ======================================================

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const messages = history
    .filter(item =>
      item &&
      (item.role === 'user' || item.role === 'model') &&
      typeof item.text === 'string' &&
      item.text.trim().length > 0
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map(item => ({
      role: item.role,
      parts: [{
        text: item.text.trim().slice(0, MAX_HISTORY_TEXT)
      }]
    }));

  // O histórico precisa começar com uma mensagem do usuário.
  while (messages.length && messages[0].role !== 'user') {
    messages.shift();
  }

  // Evita turnos consecutivos com o mesmo papel.
  const normalized = [];

  for (const message of messages) {
    const previous = normalized[normalized.length - 1];

    if (previous && previous.role === message.role) {
      previous.parts[0].text += '\n\n' + message.parts[0].text;
      previous.parts[0].text =
        previous.parts[0].text.slice(0, MAX_HISTORY_TEXT * 2);
    } else {
      normalized.push(message);
    }
  }

  return normalized;
}

// ======================================================
// INTEGRAÇÃO COM GEMINI
// ======================================================

async function askModel(
  instructions,
  prompt,
  maxOutputTokens = 1200,
  history = []
) {
  if (!API_KEY) {
    throw Object.assign(
      new Error(
        'GEMINI_API_KEY não configurada. Configure a chave no arquivo .env.'
      ),
      { status: 503 }
    );
  }

  const safePrompt = String(prompt || '').trim().slice(0, MAX_PROMPT_TEXT);

  if (!safePrompt) {
    throw Object.assign(
      new Error('A mensagem está vazia.'),
      { status: 400 }
    );
  }

  const safeHistory = sanitizeHistory(history);

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(MODEL)}:generateContent`;

  const contents = [
    ...safeHistory,
    {
      role: 'user',
      parts: [{ text: safePrompt }]
    }
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: instructions }]
      },
      contents,
      generationConfig: {
        maxOutputTokens,
        temperature: 0.7
      }
    }),
    signal: AbortSignal.timeout(60000)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      result.error?.message ||
      `A API Gemini retornou HTTP ${response.status}.`;

    const status =
      response.status === 400 ? 400 :
      response.status === 403 ? 502 :
      response.status === 404 ? 502 :
      response.status === 429 ? 429 :
      response.status === 401 ? 502 :
      502;

    throw Object.assign(new Error(detail), { status });
  }

  const answer = (result.candidates?.[0]?.content?.parts || [])
    .filter(part => typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();

  if (!answer) {
    const reason = result.promptFeedback?.blockReason;

    throw Object.assign(
      new Error(
        reason
          ? `O Gemini bloqueou a solicitação: ${reason}.`
          : 'O Gemini retornou uma resposta vazia.'
      ),
      { status: 502 }
    );
  }

  return answer;
}

// ======================================================
// INSTRUÇÕES DO COORDENADOR
// ======================================================

const coordinatorInstructions = `
Você é o Coordenador Técnico do TruckSafe, um aplicativo Flutter
de navegação e segurança para caminhoneiros.

Responda em português brasileiro, de forma direta e técnica.

Diferencie fatos confirmados de hipóteses.
Não afirme que acessou arquivos, executou testes, corrigiu código
ou verificou algo que não aconteceu.

Ajude a transformar solicitações em planos práticos com:
- objetivo;
- especialistas ou agentes sugeridos;
- arquivos que precisam ser analisados;
- testes recomendados;
- riscos e aprovações humanas;
- próximo passo.

Não invente resultados e nunca solicite chaves secretas.
`;

const taskInstructions = `
Você coordena uma central de planejamento técnico para o TruckSafe.

Produza um plano em português brasileiro, organizado em:
RESUMO
AGENTES E RESPONSABILIDADES
ARQUIVOS A ANALISAR
TESTES
APROVAÇÕES
PRÓXIMO PASSO

O sistema não tem acesso automático ao repositório.
Não confirme causas nem alegue que editou ou executou código
sem que isso realmente tenha ocorrido.

Os perfis de agentes na interface não significam que agentes
independentes estejam executando tarefas em paralelo.

Seja conciso e tecnicamente útil.
`;

// ======================================================
// SERVIDOR E ROTAS
// ======================================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    // --------------------------------------------------
    // STATUS DO BACKEND
    // --------------------------------------------------

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        service: 'TruckSafe AI Command',
        provider: 'Gemini',
        apiConfigured: Boolean(API_KEY),
        model: API_KEY ? MODEL : null,
        repoConnected: false,
        note: 'A integração com o repositório ainda não foi implementada.'
      });
    }

    // --------------------------------------------------
    // CHAT DO COORDENADOR
    // --------------------------------------------------

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJson(req);
      const prompt = String(body.message || '').trim();

      if (!prompt) {
        return sendError(res, 400, 'Escreva uma mensagem.');
      }

      const history = Array.isArray(body.history)
        ? body.history
        : [];

      const answer = await askModel(
        coordinatorInstructions,
        prompt,
        1000,
        history
      );

      return send(res, 200, {
        answer,
        model: MODEL,
        executed: false
      });
    }

    // --------------------------------------------------
    // CRIAÇÃO E PLANEJAMENTO DE TAREFAS
    // --------------------------------------------------

    if (req.method === 'POST' && url.pathname === '/api/task') {
      const body = await readJson(req);
      const task = String(body.task || '').trim();

      if (!task) {
        return sendError(res, 400, 'A tarefa está vazia.');
      }

      const context = String(
        body.context ||
        'Não há repositório conectado nem arquivos disponibilizados.'
      ).slice(0, MAX_PROMPT_TEXT);

      const project = String(body.project || 'TruckSafe')
        .slice(0, 100);

      const prompt = [
        `Projeto: ${project}`,
        `Tarefa: ${task.slice(0, MAX_PROMPT_TEXT)}`,
        `Contexto informado: ${context}`,
        '',
        'Crie o plano solicitado. Não diga que executou a tarefa.'
      ].join('\n');

      const history = Array.isArray(body.history)
        ? body.history
        : [];

      const answer = await askModel(
        taskInstructions,
        prompt,
        1600,
        history
      );

      return send(res, 200, {
        answer,
        model: MODEL,
        executed: false,
        repositoryConnected: false
      });
    }

    // --------------------------------------------------
    // ARQUIVOS ESTÁTICOS DA INTERFACE
    // --------------------------------------------------

    if (
      req.method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/index.html')
    ) {
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    if (
      req.method === 'GET' &&
      url.pathname === '/sessions-addon.js'
    ) {
      if (!fs.existsSync(SESSIONS_PATH)) {
        return sendError(
          res,
          404,
          'Arquivo sessions-addon.js não encontrado.'
        );
      }

      const addon = fs.readFileSync(SESSIONS_PATH);

      return send(
        res,
        200,
        addon,
        'text/javascript; charset=utf-8'
      );
    }

    // --------------------------------------------------
    // ROTAS DESCONHECIDAS
    // --------------------------------------------------

    if (url.pathname.startsWith('/api/')) {
      return sendError(res, 404, 'Endpoint não encontrado.');
    }

    return sendError(res, 404, 'Página não encontrada.');

  } catch (error) {
    if (res.writableEnded || res.destroyed) return;

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return sendError(
        res,
        504,
        'O Gemini demorou demais para responder.'
      );
    }

    const status = Number.isInteger(error.status)
      ? error.status
      : 500;

    if (status >= 500) {
      console.error('[TruckSafe AI]', error.message);
    }

    return sendError(
      res,
      status,
      status >= 500
        ? (error.message || 'Falha interna do servidor.')
        : error.message
    );
  }
});

// Limites adicionais para conexões HTTP.
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;

server.on('error', error => {
  console.error('[TruckSafe AI] Erro no servidor:', error.message);
  process.exitCode = 1;
});

// ======================================================
// INICIALIZAÇÃO
// ======================================================

server.listen(PORT, HOST, () => {
  console.log(`TruckSafe AI Command disponível em http://${HOST}:${PORT}`);
  console.log(`Provedor: Gemini (${MODEL})`);
  console.log(`API: ${API_KEY ? 'chave configurada' : 'chave não configurada'}`);
  console.log('Repositório conectado: não');
});
