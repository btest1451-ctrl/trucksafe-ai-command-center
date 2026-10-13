
# TruckSafe AI Command — v0.3

Central de planejamento técnico do TruckSafe, com interface web e backend Node.js integrado ao Google Gemini.

## Funcionalidades atuais

- Interface responsiva para celular e computador.
- Chat com modo de demonstração.
- Planejamento de tarefas com o Gemini.
- Seções de agentes, tarefas, aprovações e atividade.
- Verificação de conexão com o backend.
- Chave de API mantida no servidor.

## Limitações atuais

- O repositório GitHub ainda não está integrado automaticamente.
- A central não lê nem edita arquivos do projeto TruckSafe.
- Não executa testes Flutter.
- Os agentes ainda não executam trabalhos independentes em paralelo.
- As aprovações não são persistidas em um banco de dados.
- O sistema ainda não possui autenticação de usuários.

## Requisitos

- Node.js 18 ou superior.
- Uma chave da API Gemini.

## Instalação

1. Entre na pasta `trucksafe-command-center`.
2. Copie `.env.example` para `.env`.
3. Abra o arquivo `.env`.
4. Preencha `GEMINI_API_KEY` com sua chave real.
5. Execute:

   ```bash
   npm start
   ```

6. Abra `http://localhost:3000`.

## Variáveis de ambiente

```dotenv
GEMINI_API_KEY=sua_chave_real
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

Nunca publique o arquivo `.env`, nem compartilhe sua chave de API.

## Segurança

Esta versão ainda não possui autenticação. Não exponha o backend publicamente sem implementar autenticação, limites de requisições e controles de acesso.

Não execute código gerado por IA diretamente em produção. Alterações em arquivos, dependências e infraestrutura devem passar por revisão e aprovação humana.

## Próximas etapas

1. Validar o funcionamento real do Gemini.
2. Corrigir e testar todos os fluxos da interface.
3. Implementar autenticação e limites de uso.
4. Integrar o GitHub com permissões mínimas.
5. Criar execução controlada de testes.
6. Implementar agentes independentes com registros e aprovações.
7. 
