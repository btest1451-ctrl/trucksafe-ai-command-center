'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const MAX_BODY_SIZE = 1_000_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_TEXT_LENGTH = 8000;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

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

const API_KEY = process.env.GEMINI_API_KEY || '';
const INDEX_PATH = path.join(ROOT, 'index.html');

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT inválida. Use um valor entre 1 e 65535.');
}

if (!fs.existsSync(INDEX_PATH)) {
  throw new Error('index.html não encontrado na pasta do servidor.');
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  if (res.writableEnded || res.destroyed) return;

  res.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });

  res.end(
    Buffer.isBuffer(body) || typeof body === 'string'
      ? body
      : JSON.stringify(body)
  );
}

function sendError(res, status, message) {
  send(res, status, { error: message });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let finished = false;

    function fail(error) {
      if (finished) return;
      finished = true;
      reject(error);
    }

    req.on('data', chunk => {
      if (finished) return;

      raw += chunk.toString('utf8');

      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_SIZE) {
        fail(Object.assign(
          new Error('Corpo da requisição excede o limite de 1 MB.'),
          { status: 413 }
        ));

        req.resume();
      }
    });

    req.on('end', () => {
      if (finished) return;

      try {
        const body = JSON.parse(raw || '{}');

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('O corpo precisa ser um objeto JSON.');
        }

        finished = true;
        resolve(body);
      } catch {
        fail(Object.assign(
          new Error('JSON inválido.'),
          { status: 400 }
        ));
      }
    });

    req.on('error', fail);
  });
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const result = history
    .filter(item =>
      item &&
      (item.role === 'user' || item.role === 'model') &&
      typeof item.text === 'string' &&
      item.text.trim()
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map(item => ({
      role: item.role,
      parts: [{
        text: item.text.trim().slice(0, MAX_TEXT_LENGTH)
      }]
    }));

  // O histórico precisa começar com uma mensagem do usuário.
  while (result.length && result[0].role !== 'user') {
    result.shift();
  }

  // O Gemini espera alternância entre usuário e modelo.
  const normalized = [];

  for (const item of result) {
    const previous = normalized[normalized.length - 1];

    if (previous && previous.role === item.role) {
      previous.parts[0].text += '\n\n' + item.parts[0].text;
      previous.parts[0].text =
        previous.parts[0].text.slice(0, MAX_TEXT_LENGTH * 2);
    } else {
      normalized.push(item);
    }
  }

  // A última mensagem do histórico deve ser uma resposta do modelo.
  // A mensagem atual do usuário será acrescentada em seguida.
  while (
    normalized.length &&
    normalized[normalized.length - 1].role !== 'model'
  ) {
    normalized.pop();
  }

  return normalized;
}

const systemInstructions = `
Você é um assistente conversacional geral alimentado pelo Gemini,
integrado ao TruckSafe AI Command.

Responda em português brasileiro, de maneira clara, direta e natural.

REGRAS:
- Responda normalmente a perguntas de conhecimento geral.
- Se perguntarem a cor do céu, responda que geralmente parece azul
  durante o dia e explique brevemente por quê.
- Mantenha o contexto da conversa usando o histórico fornecido.
- Não transforme toda mensagem em uma tarefa de programação.
- Não exija conexão com GitHub ou acesso ao repositório para
  perguntas comuns.
- Ajude com programação quando o usuário solicitar.
- Se uma questão depender de arquivos que você não recebeu,
  explique essa limitação com clareza.
- Não diga que acessou arquivos, executou testes ou alterou código
  quando isso não aconteceu.
- Não solicite nem revele chaves secretas.
`;

async function askGemini(message, history = []) {
  if (!API_KEY) {
    throw Object.assign(
      new Error('GEMINI_API_KEY não configurada no arquivo .env.'),
      { status: 503 }
    );
  }

  const prompt = String(message || '').trim().slice(0, MAX_TEXT_LENGTH);

  if (!prompt) {
    throw Object.assign(
      new Error('Digite uma mensagem antes de enviar.'),
      { status: 400 }
    );
  }

  const contents = [
    ...sanitizeHistory(history),
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(MODEL) +
    ':generateContent';

  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstructions }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1500
        }
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw Object.assign(
        new Error('O Gemini demorou demais para responder.'),
        { status: 504 }
      );
    }

    throw Object.assign(
      new Error('Não foi possível conectar à API do Gemini: ' + error.message),
      { status: 502 }
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data.error?.message ||
      `A API do Gemini retornou HTTP ${response.status}.`;

    const status =
      response.status === 400 ? 400 :
      response.status === 429 ? 429 :
      response.status === 403 ? 502 :
      response.status === 404 ? 502 :
      502;

    throw Object.assign(new Error(detail), { status });
  }

  const answer = (data.candidates?.[0]?.content?.parts || [])
    .filter(part => typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();

  if (!answer) {
    const reason = data.promptFeedback?.blockReason;

    throw Object.assign(
      new Error(
        reason
          ? `A resposta foi bloqueada pelo Gemini: ${reason}.`
          : 'O Gemini retornou uma resposta vazia.'
      ),
      { status: 502 }
    );
  }

  return answer;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(
        res,
        200,
        fs.readFileSync(INDEX_PATH),
        'text/html; charset=utf-8'
      );
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        service: 'TruckSafe AI Command',
        provider: 'Gemini',
        model: MODEL,
        apiConfigured: Boolean(API_KEY),
        repoConnected: false
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJson(req);
      const message = String(body.message || '').trim();

      if (!message) {
        return sendError(res, 400, 'Escreva uma mensagem.');
      }

      const answer = await askGemini(
        message,
        Array.isArray(body.history) ? body.history : []
      );

      return send(res, 200, {
        answer,
        model: MODEL,
        provider: 'Gemini'
      });
    }

    return sendError(res, 404, 'Rota não encontrada.');

  } catch (error) {
    if (res.writableEnded || res.destroyed) return;

    const status = Number.isInteger(error.status) ? error.status : 500;

    console.error('[TruckSafe AI]', error.message);

    return sendError(
      res,
      status,
      status >= 500 && status !== 502 && status !== 503 && status !== 504
        ? 'Erro interno do servidor.'
        : error.message
    );
  }
});

server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;

server.on('error', error => {
  console.error('[TruckSafe AI] Erro no servidor:', error.message);
});

server.listen(PORT, HOST, () => {
  console.log(`TruckSafe AI Command disponível na porta ${PORT}`);
  console.log(`Provedor: Gemini (${MODEL})`);
  console.log(`API: ${API_KEY ? 'chave configurada' : 'chave não configurada'}`);
  console.log('Repositório conectado: não (opcional)');
});
