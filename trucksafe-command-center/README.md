# TruckSafe AI Command — v0.1

Primeira versão da central multiagente do TruckSafe. Interface em HTML/CSS/JS sem bibliotecas externas e backend inicial em Node.js.

## O que funciona nesta versão

- Interface responsiva para celular e computador.
- Chat com modo demonstração explícito.
- Seções de agentes, tarefas, aprovações, atividade e configurações.
- URL de backend configurável e teste de `/api/health`.
- Backend com endpoint `/api/task` que usa a OpenAI Responses API para criar um plano real quando uma chave está configurada.
- Chave de API lida somente no servidor via `.env`, nunca exposta no HTML.

## O que ainda não está implementado

- Conexão com o repositório GitHub ou acesso automático ao seu computador.
- Leitura/edição de arquivos do projeto TruckSafe.
- Execução isolada de código ou testes Flutter.
- Agentes independentes executando em paralelo. Nesta versão, os agentes são funções definidas na interface e o backend realiza o planejamento com um modelo.
- Aprovação persistente no servidor: os controles atuais são apenas de interface/sessão.

## Como iniciar no computador

1. Instale Node.js 18 ou mais recente.
2. Extraia a pasta e abra um terminal dentro dela.
3. Copie `.env.example` para `.env`.
4. Para respostas de IA reais, adicione sua chave em `OPENAI_API_KEY` dentro do `.env`. Se deixar vazia, o servidor inicia, mas as tarefas ficam no modo demonstração/sem chamadas de IA.
5. Execute `npm start`.
6. Abra `http://localhost:3000` no navegador.

A chave de API pode gerar cobrança no provedor. Configure limites de uso no painel do provedor e não envie o `.env` a terceiros.

## Observação sobre celular

O jeito mais simples de usar a interface no celular é hospedar a aplicação numa máquina/servidor acessível na mesma rede ou publicar o backend com HTTPS. Não exponha o servidor sem autenticação à internet pública. O protótipo não tem autenticação de usuário, portanto deve ser usado localmente até a camada de segurança ser implementada.
