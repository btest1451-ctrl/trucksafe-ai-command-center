
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

// Carrega variáveis do arquivo .env sem dependências externas.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const ix = trimmed.indexOf('=');
    if (ix < 1) continue;

    const key = trimmed.slice(0, ix).trim();
    let value = trimmed.slice(ix + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, '.env'));

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY || '';

const html = fs.readFileSync(
  path.join(ROOT, 'index.html')
);

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(
    contentType.startsWith('application/json')
      ? JSON.stringify(body)
      : body
  );
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', chunk => {
      raw += chunk;

      if (raw.length > 1_000_000) {
        reject(Object.assign(new Error('Requisição muito grande.'), {
          status: 413
        }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), {
          status: 400
        }));
      }
    });

    req.on('error', reject);
  });
}


async function askModel(
  instructions,
  prompt,
  maxOutputTokens = 1200,
  history = []
) {
  if (!API_KEY) {
    throw Object.assign(
      new Error("GEMINI_API_KEY não configurada."),
      { status: 503 }
    );
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;

  const safeHistory = Array.isArray(history)
    ? history
        .filter(
          item =>
            item &&
            ["user", "model"].includes(item.role) &&
            typeof item.text === "string"
        )
        .slice(-20)
        .map(item => ({
          role: item.role,
          parts: [{ text: item.text.slice(0, 4000) }]
        }))
    : [];

  const contents = [
    ...safeHistory,
    {
      role: "user",
      parts: [{ text: String(prompt).slice(0, 8000) }]
    }
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY
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

    const status = [400, 403, 404, 429].includes(response.status)
      ? response.status
      : 502;

    throw Object.assign(new Error(detail), { status });
  }

  const answer = (result.candidates?.[0]?.content?.parts || [])
    .filter(part => typeof part.text === "string")
    .map(part => part.text)
    .join("\n")
    .trim();

  if (!answer) {
    throw Object.assign(
      new Error("O Gemini retornou uma resposta vazia."),
      { status: 502 }
    );
  }

  return answer;
}

  if (!API_KEY) {
    throw Object.assign(
      new Error('GEMINI_API_KEY não configurada. Configure a chave no .env do servidor.'),
      { status: 503 }
    );
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;

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
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
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
      response.status === 400 || response.status === 403 ||
      response.status === 404 || response.status === 429
        ? response.status
        : response.status === 401 ? 502 : 502;

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
      new Error(reason
        ? `O Gemini bloqueou a solicitação: ${reason}.`
        : 'O Gemini retornou uma resposta vazia.'),
      { status: 502 }
    );
  }

  return answer;
}

const coordinatorInstructions = `
Você é o Coordenador Técnico do TruckSafe, um aplicativo Flutter de navegação e segurança para caminhoneiros.

Responda em português brasileiro, de forma direta e técnica.
Diferencie fatos confirmados de hipóteses.
Você não tem acesso automático ao repositório ou aos arquivos do projeto nesta versão.
Nunca afirme que abriu arquivos, executou testes, corrigiu código ou verificou algo que não aconteceu.

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
Você coordena uma central de planejamento técnico multiagente para o TruckSafe.

Produza um plano em português brasileiro, organizado em:
RESUMO
AGENTES E RESPONSABILIDADES
ARQUIVOS A ANALISAR
TESTES
APROVAÇÕES
PRÓXIMO PASSO

Sem acesso real ao repositório ou aos arquivos, não confirme causas nem alegue que editou ou executou código.
Seja conciso e tecnicamente útil.
`;

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      service: 'TruckSafe AI Command',
      provider: 'Gemini',
      apiConfigured: Boolean(API_KEY),
      model: API_KEY ? MODEL : null,
      repoConnected: false,
      note: 'A integração com o repositório ainda não está implementada.'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readJson(req);
      const prompt = String(body.message || '').trim();

      if (!prompt) {
        return send(res, 400, { error: 'Escreva uma mensagem.' });
      }

      const answer = await askModel(
        coordinatorInstructions,
        prompt,
        1000
      );

      return send(res, 200, { answer, model: MODEL });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        return send(res, 504, { error: 'O Gemini demorou demais para responder.' });
      }

      return send(res, error.status || 500, {
        error: error.message || 'Falha ao processar a mensagem.'
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/task') {
    try {
      const body = await readJson(req);
      const task = String(body.task || '').trim();

      if (!task) {
        return send(res, 400, { error: 'A tarefa está vazia.' });
      }

      const context = String(
        body.context ||
        'Não há repositório conectado nem arquivos de código disponibilizados.'
      );

      const prompt = [
        'Projeto: TruckSafe',
        `Tarefa: ${task}`,
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
    } catch (error) {
      if (error.name === 'TimeoutError') {
        return send(res, 504, { error: 'O Gemini demorou demais para responder.' });
      }

      return send(res, error.status || 500, {
        error: error.message || 'Falha ao planejar a tarefa.'
      });
    }
  }

  if (
    req.method === 'GET' &&
    (url.pathname === '/' || url.pathname === '/index.html')
  ) {
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  if (url.pathname.startsWith('/api/')) {
    return send(res, 404, { error: 'Endpoint não encontrado.' });
  }

  return send(res, 404, { error: 'Página não encontrada.' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TruckSafe AI Command disponível na porta ${PORT}`);
  console.log(`Provedor: Gemini (${MODEL})`);
  console.log(
    `API: ${API_KEY ? 'chave configurada' : 'chave não configurada'}`
  );
});
