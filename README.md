# Mega CRM

CRM comercial em Kanban com acompanhamento de relatórios, integrado ao **Gestta** e ao **Google Drive**. Frontend em **React + Next.js** (que também expõe as rotas de API usadas em produção) e uma API **NestJS** para desenvolvimento local. Interface em português, tema escuro e detalhes em violeta.

Produção: implantado na Vercel (apenas `apps/web`), com dados no Supabase.

## Executar localmente

Requisitos: Node.js 22 ou superior e npm.

```sh
npm install
npm run dev
```

- Aplicação: http://localhost:3000 (redireciona para `/login` sem sessão)
- API Nest: http://127.0.0.1:3001/api
- Saúde da API: http://127.0.0.1:3001/api/health

As rotas de `apps/web/src/app/api` atendem o CRM diretamente. Caminhos `/api/*` sem rota no Next são encaminhados ao NestJS (`API_URL`), sem expor a URL da API no cliente. Configure as variáveis do Next em `apps/web/.env.local`; o Nest usa as variáveis do processo (não carrega arquivos `.env` automaticamente).

## Variáveis de ambiente

| Variável                    | App      | Uso                                                                        |
| --------------------------- | -------- | -------------------------------------------------------------------------- |
| `AUTH_SECRET`               | web      | Chave HMAC que assina o cookie de sessão. **Obrigatória em produção.**     |
| `AUTH_PASSWORD`             | web      | Senha de acesso à plataforma. **Obrigatória em produção.**                 |
| `SUPABASE_URL`              | web, api | Projeto Supabase. Sem ela, os dados ficam em memória.                      |
| `SUPABASE_SERVICE_ROLE_KEY` | web, api | Chave de serviço (ou `SUPABASE_ANON_KEY` como alternativa).                |
| `GESTTA_API_URL`            | web      | Base da API do Gestta; padrão `https://api.gestta.com.br/core`.            |
| `GESTTA_EMAIL`              | web      | Usuário do Gestta para conexão e sincronização automática.                 |
| `GESTTA_PASSWORD`           | web      | Senha do Gestta.                                                           |
| `GOOGLE_CLIENT_ID`          | web      | OAuth do Google Drive.                                                     |
| `GOOGLE_CLIENT_SECRET`      | web      | OAuth do Google Drive.                                                     |
| `GOOGLE_REDIRECT_URI`       | web      | Callback OAuth; padrão `…/api/integrations/google/callback` da produção.   |
| `API_URL`                   | web      | Destino do encaminhamento para o Nest; padrão `http://127.0.0.1:3001`.     |
| `PORT`, `WEB_ORIGIN`        | api      | Porta e origem permitida (CORS) da API Nest.                               |

Os arquivos `.env.example` de `apps/web` e `apps/api` servem de ponto de partida.

## O que está implementado

- **Login com sessão**: tela `/login`, cookie `mega_session` assinado com HMAC-SHA256 e válido por 7 dias. O `proxy.ts` (convenção do Next.js 16, antigo `middleware.ts`) redireciona páginas sem sessão para o login e responde `401` nas rotas de API protegidas.
- Kanban com cinco etapas, arrastar e soltar, visualização em lista, busca e filtros por responsável/prioridade.
- Criação, edição e exclusão de oportunidades; no celular ou teclado, a etapa também pode ser alterada pelo formulário.
- Resumo comercial calculado com os dados da API, pendências de contato e histórico de atividades.
- Contatos vinculados às oportunidades.
- Importação CSV com modelo para download, validação, prévia e confirmação. O mesmo token não pode ser confirmado duas vezes.
- Acompanhamento de relatórios com documentos pendentes, dúvidas, revisão e download.
- Integração com o Gestta: conexão, importação de clientes, sincronização manual e automática, histórico por empresa e competência.
- Integração com o Google Drive via OAuth para armazenar os relatórios gerados.
- Estados de carregamento, erro e vazio; layout responsivo e diálogos com foco e navegação por teclado.

## Dados

O sistema inicia vazio, sem oportunidades, relatórios ou atividades fictícias. Com Supabase configurado, os dados são persistidos no banco e os PDFs gerados vão para o bucket `reports` do Storage. Sem Supabase, alterações, importações e atividades ficam em memória e são perdidas ao reiniciar o processo (inclusive reinícios automáticos em desenvolvimento), e o histórico do Gestta fica vazio. Consultar um banco vazio não cria registros automaticamente.

O acesso é por uma senha única da plataforma; ainda não há isolamento de dados por usuário.

Os totais consideram todas as oportunidades, não um período fictício. A taxa de fechamento é a quantidade de cartões em Fechados dividida pelo total.

## Acompanhamento de relatórios

Na aba **Relatórios**, consulte os relatórios disponíveis, documentos pendentes, dúvidas sem solução e a última atualização. A busca filtra pelo nome; os filtros **Com pendências** e **Com novidades** ajudam a priorizar o trabalho.

Abra um relatório para solicitar documentos, marcar recebimento, registrar dúvidas e responder na mesma conversa. Cada dúvida pode apontar para um registro e uma página, seção ou referência. Autor, data e contexto são preservados, inclusive se o registro associado for removido. Responder não resolve automaticamente a dúvida; use **Marcar como resolvida** ou **Reabrir dúvida**.

**Marcar como revisado** define uma referência compartilhada pela equipe. Registros criados depois dela aparecem como novos; registros modificados aparecem como alterados. A revisão não encerra documentos pendentes nem dúvidas abertas. O histórico anterior continua disponível.

O acompanhamento é persistido no campo `reports.metadata.workflow`. A gravação compara `updated_at` para evitar sobrescrever alterações simultâneas; em caso de conflito, atualize a lista e reenvie seu texto, que permanece no formulário. Na interface, o autor vem da sessão autenticada; chamadas diretas à API Nest local são identificadas como **API local**.

Documentos pendentes são registrados e conferidos manualmente. Os destaques comparam registros vinculados à mesma importação; não comparam automaticamente versões de arquivos do Google Drive ou reimportações distintas.

## Integração com o Gestta

Conecte a conta pelo diálogo de integração (ou pelas variáveis `GESTTA_*`). A partir daí é possível listar e importar clientes do Gestta como oportunidades.

A **sincronização** busca as tarefas do período e, para cada uma:

1. registra um relatório, as tarefas como oportunidades (etapa conforme status e atraso) e uma atividade no CRM;
2. organiza no Google Drive a estrutura `Mega Contabilidade - Gestta / Empresa / Competência / Tarefa`;
3. gera e envia o PDF da tarefa, um `.txt`, o JSON completo e os anexos da tarefa no Gestta;
4. gera por competência um PDF consolidado e um CSV de resumo;
5. gera um **Relatório Geral de Sincronização** em PDF, salvo no Drive e no Supabase Storage;
6. grava cada tarefa em `gestta_history_records` (upsert por `gestta_task_id`), com os links do Drive.

A sincronização pode ser disparada manualmente na interface ou por `POST /api/cron/gestta-sync`. `GET` na mesma rota inicia o agendamento em processo, que roda a cada 10 minutos e ignora disparos enquanto um ciclo está em andamento. Como o agendamento vive na memória do processo, em ambiente serverless ele depende de chamadas externas periódicas.

A aba **Histórico** agrupa as tarefas sincronizadas por empresa e competência, com busca, filtro por competência e status (incluindo atrasadas) e links para PDF e JSON no Drive.

Sem o Google Drive conectado, a sincronização ainda registra os dados no CRM, mas não gera a estrutura de pastas nem o histórico.

## Integração com o Google Drive

Em **Integrações**, conecte uma conta Google via OAuth. Os tokens ficam na tabela de integrações do Supabase. Há rotas para verificar o status, testar o acesso e desconectar.

## CSV inicial

UTF-8, até 2 MB e 500 linhas. Vírgula ou ponto e vírgula são detectados automaticamente. Colunas:

| Coluna      | Obrigatória | Formato                                                             |
| ----------- | ----------- | ------------------------------------------------------------------- |
| empresa     | Sim         | Texto, 2 a 100 caracteres                                           |
| contato     | Sim         | Texto, 2 a 100 caracteres                                           |
| valor       | Sim         | Número não negativo, ponto decimal, sem moeda ou milhar: `18500.00` |
| vencimento  | Sim         | Data válida `AAAA-MM-DD` para o próximo contato                     |
| email       | Não         | E-mail válido ou vazio                                              |
| responsavel | Não         | Um responsável cadastrado; padrão Ana Martins                       |
| prioridade  | Não         | `high`, `medium` ou `low`; padrão `medium`                          |
| observacoes | Não         | Texto de até 2.000 caracteres                                       |

Todos entram em Novos leads. A validação ocorre novamente no servidor. A prévia expira após 15 minutos. Reimportar o mesmo arquivo em uma nova prévia cria novos registros.

## Organização

```text
apps/web            Next.js App Router, interface, rotas de API, login, integrações Gestta/Google
apps/api            NestJS, validação, serviços e importação (desenvolvimento local)
packages/contracts  Tipos e validação Zod compartilhados
supabase/migrations Tabelas de relatórios, storage e integrações Gestta/Google Drive
```

Principais módulos em `apps/web/src/lib`: `auth.ts` (sessão), `crm-backend.ts` (CRM com Supabase ou memória), `gestta.ts` (cliente da API Gestta), `gestta-sync.ts` (sincronização e histórico), `gestta-cron.ts` (agendamento), `gestta-pdf.ts` (geração de PDFs com `pdf-lib`) e `google.ts` (OAuth e Drive).

## Verificações

```sh
npm run build
npm run typecheck
npm test
```

Após o build, execute `npm start` para iniciar a aplicação e a API compiladas. Na Vercel, o build compila apenas `@mega/contracts` e `@mega/web` (ver `vercel.json`).

## Endpoints

Rotas do Next (prefixo `/api`). Exceto as marcadas como públicas, todas exigem sessão.

| Método          | Caminho                                     | Função                                                |
| --------------- | ------------------------------------------- | ----------------------------------------------------- |
| POST            | `/auth/login`                               | Entrar (pública)                                      |
| POST            | `/auth/logout`                              | Sair (pública)                                        |
| GET             | `/auth/session`                             | Usuário da sessão atual (pública)                     |
| GET             | `/workspace`                                | Oportunidades, relatórios e atividades                |
| POST            | `/opportunities`                            | Criar oportunidade                                    |
| PATCH           | `/opportunities/:id`                        | Salvar formulário completo                            |
| PATCH           | `/opportunities/:id/stage`                  | Alterar etapa                                         |
| DELETE          | `/opportunities/:id`                        | Excluir oportunidade                                  |
| POST            | `/imports/preview`                          | Validar `{ name, rows }` e gerar token                |
| POST            | `/imports/:token/commit`                    | Confirmar uma prévia validada                         |
| PATCH           | `/reports/:id`                              | Registrar documentos, conversas, resolução e revisão  |
| GET             | `/reports/:id/download`                     | Baixar o arquivo do relatório                         |
| POST            | `/integrations/gestta/connect`              | Conectar a conta do Gestta                            |
| GET             | `/integrations/gestta/status`               | Status da conexão com o Gestta                        |
| POST            | `/integrations/gestta/disconnect`           | Desconectar o Gestta                                  |
| GET             | `/integrations/gestta/customers`            | Listar clientes do Gestta                             |
| POST            | `/integrations/gestta/import`               | Importar clientes como oportunidades                  |
| GET/POST        | `/integrations/gestta/sync`                 | Consultar / executar a sincronização Gestta → CRM → Drive |
| GET             | `/gestta/history`                           | Histórico agrupado (`search`, `competence`, `status`) |
| GET/POST        | `/cron/gestta-sync`                         | Iniciar agendamento / disparar sincronização (pública) |
| GET             | `/integrations/google/connect`              | Iniciar o OAuth do Google                             |
| GET             | `/integrations/google/status`               | Status da conexão com o Drive                         |
| POST            | `/integrations/google/test`                 | Testar o acesso ao Drive                              |
| POST            | `/integrations/google/disconnect`           | Desconectar o Google Drive                            |
| GET             | `/integrations/google/callback`             | Retorno do OAuth (pública)                            |

As rotas `/google/*` são aliases antigos das rotas `/integrations/google/*`. A API Nest local expõe ainda `GET /health` e o mesmo conjunto de rotas do CRM.
