# Mega CRM

Sistema que busca os relatórios, tarefas e documentos do **Gestta** e os envia ao **Google Drive**, com uma central de acompanhamento de relatórios, histórico por empresa e competência e a API/envio de extratos bancários. Frontend em **React + Next.js** (que também expõe as rotas de API usadas em produção) e uma API **NestJS** para desenvolvimento local. Interface em português, tema escuro e detalhes em violeta.

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
| `GOOGLE_DRIVE_STATEMENTS_FOLDER` | web | Pasta raiz (privada) dos extratos no Drive; padrão `Mega Contabilidade - Extratos`. |
| `API_URL`                   | web      | Destino do encaminhamento para o Nest; padrão `http://127.0.0.1:3001`.     |
| `PORT`, `WEB_ORIGIN`        | api      | Porta e origem permitida (CORS) da API Nest.                               |

Os arquivos `.env.example` de `apps/web` e `apps/api` servem de ponto de partida.

## O que está implementado

- **Login com sessão**: tela `/login`, cookie `mega_session` assinado com HMAC-SHA256 e válido por 7 dias. O `proxy.ts` (convenção do Next.js 16, antigo `middleware.ts`) redireciona páginas sem sessão para o login e responde `401` nas rotas de API protegidas.
- Navegação em quatro abas: **Painel** (tela inicial), **Relatórios**, **Histórico** e **Integrações**.
- Painel com gráficos de tarefas pendentes e atrasadas, extratos não enviados pelos clientes e situação do Google Drive (ver abaixo).
- Central de relatórios: cada sincronização do Gestta vira um relatório com suas tarefas, documentos pendentes, dúvidas, revisão e download do PDF geral.
- Integração com o Gestta: conexão, sincronização manual e automática e histórico por empresa e competência.
- Integração com o Google Drive via OAuth para armazenar os relatórios, PDFs e anexos gerados.
- Captura de extratos bancários do Gestta, conversão PDF → OFX, API com token para outras plataformas e envio ao CRM-MEGA.
- Estados de carregamento, erro e vazio; layout responsivo e diálogos com foco e navegação por teclado.

## Dados

O sistema inicia vazio, sem relatórios ou atividades fictícias. Com Supabase configurado, os dados são persistidos no banco e os PDFs gerados vão para o bucket `reports` do Storage. Sem Supabase, a aplicação roda em modo memória: relatórios, tarefas, atividades e histórico ficam vazios (sem banco, a sincronização não registra relatórios nem histórico). Consultar um banco vazio não cria registros automaticamente.

O acesso é por uma senha única da plataforma; ainda não há isolamento de dados por usuário.

As tabelas `opportunities` e as colunas ligadas a elas continuam no banco (dados antigos do CRM comercial), mas não são mais lidas nem gravadas pela aplicação web.

## Painel

Tela inicial com a situação do escritório, montada só com o que está no Supabase (não chama o Gestta ao abrir). A rota é `GET /api/dashboard`, com os parâmetros opcionais `competencias` (padrão 6), `empresa` (código), `responsavel` e `refresh=1` (ignora o cache de 60 segundos).

- **Números principais:** tarefas em aberto, atrasadas, concluídas, percentual concluído no prazo, clientes sem nenhum extrato (tarefa vencida) e extratos com cópia no Drive.
- **Evolução por competência:** barras empilhadas com concluídas no prazo, concluídas com atraso, em aberto no prazo e atrasadas, com dica ao passar o mouse e versão em tabela. As cores passaram no validador de daltonismo contra o fundo do app.
- **Empresas e responsáveis com mais atrasos.**
- **Extratos não enviados pelos clientes:** por tarefa de extratos em aberto, separa "nenhum enviado" de "parcial". Tarefas concluídas pelo escritório não entram, porque itens sem arquivo ali não se aplicavam ao cliente. Itens vencidos são os de tarefa com vencimento anterior a hoje, no fuso de Brasília.
- **Situação do Drive e dos envios:** extratos com e sem cópia, convertidos, envio ao CRM-MEGA, tarefas com PDF no Drive e as últimas sincronizações.

Os dados vêm de um retrato gravado pela captura de extratos (`gestta_tasks` e `gestta_document_requests`; migração `20261111000003…`). A cada execução, a captura já percorre todas as tarefas da janela e grava esse retrato, e o Painel considera só a varredura mais recente. Competências e vencimentos são calculados no fuso de Brasília.

## Acompanhamento de relatórios

Na aba **Relatórios**, consulte os relatórios disponíveis, documentos pendentes, dúvidas sem solução e a última atualização. A busca filtra pelo nome; os filtros **Com pendências** e **Com novidades** ajudam a priorizar o trabalho. O botão **Sincronizar Gestta** abre a sincronização (ou leva a **Integrações** se o Gestta não estiver conectado).

Os registros de cada relatório são as **tarefas do Gestta** gravadas em `gestta_history_records` com o `report_id` daquela sincronização. `GET /api/workspace` devolve os relatórios, as atividades recentes e as tarefas vinculadas a algum relatório (sem o `raw_data`). Ao abrir um relatório, a tabela de tarefas mostra empresa, tarefa, competência, status (**Concluída**, **Em aberto** ou **Atrasada**), vencimento, se a tarefa é nova ou alterada desde a revisão e o link do PDF no Drive, com busca e filtro por status. Como o histórico faz upsert por `gestta_task_id`, uma tarefa que aparece em várias sincronizações fica ligada à mais recente; relatórios antigos podem ficar sem tarefas.

Abra um relatório para solicitar documentos, marcar recebimento, registrar dúvidas e responder na mesma conversa. Cada dúvida pode apontar para uma tarefa do relatório e uma página, seção ou referência. Autor, data e contexto (rótulo "empresa · tarefa · competência") são preservados, inclusive se a tarefa deixar de pertencer ao relatório. Responder não resolve automaticamente a dúvida; use **Marcar como resolvida** ou **Reabrir dúvida**.

**Marcar como revisado** define uma referência compartilhada pela equipe. Tarefas criadas depois dela aparecem como novas; tarefas atualizadas (por exemplo, numa nova sincronização) aparecem como alteradas. A revisão não encerra documentos pendentes nem dúvidas abertas. O histórico anterior continua disponível.

O acompanhamento é persistido no campo `reports.metadata.workflow`. Por compatibilidade com o formato já salvo e com a API Nest, a dúvida guarda a tarefa no campo `opportunityId` (agora com o id de `gestta_history_records`). A gravação compara `updated_at` para evitar sobrescrever alterações simultâneas; em caso de conflito, atualize a lista e reenvie seu texto, que permanece no formulário. Na interface, o autor vem da sessão autenticada.

Documentos pendentes são registrados e conferidos manualmente.

## Integração com o Gestta

Conecte a conta pelo diálogo de integração (ou pelas variáveis `GESTTA_*`).

A **sincronização** busca as tarefas do período e, para cada uma:

1. registra um relatório e uma atividade;
2. organiza no Google Drive a estrutura `Mega Contabilidade - Gestta / Empresa / Competência / Tarefa`;
3. gera e envia o PDF da tarefa, um `.txt`, o JSON completo e os anexos da tarefa no Gestta;
4. gera por competência um PDF consolidado e um CSV de resumo;
5. gera um **Relatório Geral de Sincronização** em PDF, salvo no Drive e no Supabase Storage;
6. grava cada tarefa em `gestta_history_records` (upsert por `gestta_task_id`), com os links do Drive e o `report_id` do relatório.

A sincronização pode ser disparada manualmente na interface ou por `POST /api/cron/gestta-sync`. `GET` na mesma rota inicia o agendamento em processo, que roda a cada 10 minutos e ignora disparos enquanto um ciclo está em andamento. Como o agendamento vive na memória do processo, em ambiente serverless ele depende de chamadas externas periódicas.

A aba **Histórico** agrupa as tarefas sincronizadas por empresa e competência, com busca, filtro por competência e status (incluindo atrasadas) e links para PDF e JSON no Drive.

Sem o Google Drive conectado, a sincronização ainda registra o relatório, mas não gera a estrutura de pastas nem o histórico (e, portanto, o relatório fica sem tarefas).

## Integração com o Google Drive

Em **Integrações**, conecte uma conta Google via OAuth. Os tokens ficam na tabela de integrações do Supabase. Há rotas para verificar o status, testar o acesso e desconectar.

## API de extratos (OFX e PDF) para outras plataformas

Plataformas externas buscam os extratos bancários anexados às tarefas do Gestta usando um **token de API** emitido pelo CRM.

**Captura** (`apps/web/src/lib/gestta-statements.ts`): no Gestta, os clientes enviam os extratos nas tarefas **"Envio de Extratos Bancários e Documentos Contábeis"**, pela solicitação de documentos da tarefa. A captura:

1. varre as tarefas de **todos os responsáveis** com vencimento entre 90 dias atrás e 45 dias à frente;
2. em cada tarefa de extratos, lê os itens da solicitação que começam com "Extratos" (conta corrente, aplicações, empréstimos, cotas de capital) e ignora "Demais Documentos" e itens desconsiderados;
3. baixa cada arquivo novo (`POST accounting/pendency/document/download`, que devolve um link temporário do S3);
4. guarda OFX (identificado pelo conteúdo, `OFXHEADER`/`<OFX>`) e PDF; outros formatos (rar, zip, xlsx, imagens) são ignorados e listados no resumo;
5. completa o CNPJ/CPF pela listagem de clientes, já que a tarefa não traz esse dado;
6. com o Google Drive conectado, envia uma cópia para `Mega Contabilidade - Extratos / Empresa / Competência AAAA-MM / arquivo [id].ofx|pdf`. O sufixo `[id]` evita que dois arquivos com o mesmo nome se sobrescrevam. Extratos capturados enquanto o Drive estava desconectado são enviados na próxima execução. Essa raiz é **separada e privada**, porque a pasta "Mega Contabilidade - Gestta" da sincronização é compartilhada com qualquer pessoa com o link. O nome pode ser trocado com `GOOGLE_DRIVE_STATEMENTS_FOLDER`.

**Conversão de PDF para OFX** (`apps/web/src/lib/pdf-to-ofx.ts`): quando o cliente envia **somente PDF** no item "Extratos de Conta Corrente" de uma tarefa (nenhum OFX), o sistema gera o OFX a partir do PDF:

- lê as linhas do PDF e interpreta os layouts mais comuns: Banco do Brasil (dois modelos), Bradesco, Ailos/Viacredi, PagSeguro e Mercado Pago;
- **só gera o OFX quando os lançamentos lidos fecham com os saldos impressos no PDF**; se não fecharem, nada é gerado e o motivo fica no resumo (`conversions.failed`);
- PDFs escaneados (imagem, sem texto), relatórios de vendas, demonstrativos de aplicação e PDFs só com saldos não são convertidos;
- o arquivo gerado se chama `<nome do PDF> (arquivo convertido do PDF).ofx`, recebe no Drive a descrição "Arquivo convertido automaticamente do PDF …" e aparece na API com `convertido: true`, `convertidoDe` (id do PDF) e `observacao`.

Ela roda a cada ciclo do agendamento (`/api/cron/gestta-sync`) e sob demanda em `POST /api/integrations/gestta/statements/sync` (corpo opcional: `startDate`, `endDate`, `maxTasks`). Os arquivos vão para o bucket privado `statements` e os metadados para `gestta_statement_files`. A chave é o id do arquivo no Gestta, então rodar de novo não duplica. As migrações `20261110000000…` e `20261110000001…` criam tabelas e bucket **sem políticas para anon**, então a funcionalidade exige `SUPABASE_SERVICE_ROLE_KEY`.

**Tokens**: em **Integrações → Tokens de API**, informe o nome da plataforma e a validade e clique em **Gerar token**. O token (`mega_…`) é exibido **uma única vez**; o banco guarda só o hash SHA-256. A lista mostra status, expiração e último uso, e a revogação vale imediatamente.

**Uso pela plataforma** (`Authorization: Bearer <token>` ou `X-API-Key: <token>`):

```sh
# Listar (filtros opcionais)
curl -H "Authorization: Bearer mega_..." \
  "https://<dominio>/api/public/v1/extratos?formato=ofx&competencia=2026-10&cnpj=12345678000190&desde=2026-11-01T00:00:00Z&pagina=1&limite=50"

# Baixar o arquivo (downloadUrl de cada item da listagem)
curl -H "Authorization: Bearer mega_..." -OJ "https://<dominio>/api/public/v1/extratos/<id>/download"
```

| Parâmetro     | Formato                                            |
| ------------- | -------------------------------------------------- |
| `formato`     | `ofx` ou `pdf`                                     |
| `competencia` | `AAAA-MM`                                          |
| `cnpj`        | 14 dígitos (ou 11 para CPF), com ou sem máscara    |
| `desde`       | Data ISO 8601; retorna o que foi sincronizado a partir dela (útil para busca incremental) |
| `pagina`, `limite` | Inteiros; `limite` entre 1 e 200 (padrão 50)  |

A resposta traz `dados` (id, formato, nomeArquivo, contentType, tamanho, sha256, competencia, tipoDocumento, empresa, tarefa, enviadoEm, sincronizadoEm, downloadUrl) e `paginacao`. O download devolve o arquivo com `Content-Disposition` e o cabeçalho `X-Content-SHA256`. Erros: `401` para token ausente, inválido, expirado ou revogado; `403` para escopo insuficiente; `400` para parâmetros inválidos; `404` para extrato inexistente.

## Envio de extratos para o CRM-MEGA

Além da API de consulta, o CRM pode **enviar** os extratos para uma plataforma que recebe arquivos, como o CRM-MEGA (`POST /api/extratos`, multipart com arquivo, CNPJ, código e nome da empresa e competência, autenticado por `Authorization: Bearer <token>`). O token é gerado em **Integrações → Tokens de API** e cadastrado no destino em "Tokens de outras plataformas".

Como o destino não evita duplicidade, cada envio passa por uma deduplicação (`apps/web/src/lib/delivery/dedupe.ts`):

- **"mesmo extrato"** significa mesma empresa, mesma competência e mesma conta (quando a conta é conhecida dos dois lados), com pelo menos 50% dos lançamentos iguais (data e valor com sinal). Contas diferentes nunca são o mesmo extrato;
- **OFX e PDF do mesmo extrato:** vai só um, nesta ordem de preferência: OFX do cliente, OFX convertido, PDF;
- **arquivo idêntico** enviado mais de uma vez pelo cliente: vai uma vez;
- **o destino já tem** (veio por outro caminho, como o SCI Web): não vai. A consulta é feita no banco do destino com um usuário somente leitura (`EXTRATOS_DATABASE_URL`). Sem essa variável, o envio fica bloqueado;
- **na dúvida** (ex.: PDF ilegível sem conta identificada num grupo que já tem OFX), não envia;
- empresa que o destino não reconhece fica **aguardando**, sem ser descartada, até ser cadastrada lá;
- cada arquivo é enviado **uma única vez**, com reserva antes do envio para que execuções simultâneas não mandem duas vezes. O resultado (id do extrato criado ou o erro) fica em `gestta_statement_files.delivery_*`, e os erros são tentados de novo até 3 vezes. Se a resposta se perder depois de o destino gravar, a nova tentativa detecta que o destino já tem o extrato e não reenvia;
- a conta e os lançamentos de cada arquivo ficam guardados em `fingerprint`, para as execuções seguintes não precisarem baixar e reler os arquivos. A análise anda em lotes de empresa e competência e para quando atinge o limite de envios.

Os testes (`npm test`) cobrem as regras, a identificação da empresa no destino e o fluxo completo com armazenamento, destino e servidor simulados, incluindo falhas de rede, reenvio, limite e execuções simultâneas.

Configuração: `EXTRATOS_DESTINO_URL` (endereço do destino), `EXTRATOS_DESTINO_TOKEN` (o token cadastrado lá) e `EXTRATOS_ENVIO_AUTOMATICO` (`true` para enviar a cada ciclo do agendamento; o padrão é desligado). O envio manual fica em `POST /api/integrations/extratos/envio`, com corpo opcional `limit`, `ids` e `dryRun` (este último só mostra o que seria enviado).

## Organização

```text
apps/web            Next.js App Router, interface, rotas de API, login, integrações Gestta/Google
apps/api            NestJS legado (desenvolvimento local; ainda mantém as rotas do antigo CRM comercial)
packages/contracts  Tipos e validação Zod compartilhados
supabase/migrations Tabelas de relatórios, storage e integrações Gestta/Google Drive
```

Principais módulos em `apps/web/src/lib`: `auth.ts` (sessão), `crm-backend.ts` (relatórios, tarefas e acompanhamento com Supabase ou memória), `report-tasks.ts` (tipo e leitura das tarefas dos relatórios), `gestta.ts` (cliente da API Gestta), `gestta-sync.ts` (sincronização e histórico), `gestta-cron.ts` (agendamento), `gestta-pdf.ts` (geração de PDFs com `pdf-lib`) e `google.ts` (OAuth e Drive).

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
| GET             | `/workspace`                                | Relatórios, atividades e tarefas do Gestta vinculadas |
| PATCH           | `/reports/:id`                              | Registrar documentos, conversas, resolução e revisão  |
| GET             | `/reports/:id/download`                     | Baixar o arquivo do relatório                         |
| POST            | `/integrations/gestta/connect`              | Conectar a conta do Gestta                            |
| GET             | `/integrations/gestta/status`               | Status da conexão com o Gestta                        |
| POST            | `/integrations/gestta/disconnect`           | Desconectar o Gestta                                  |
| GET/POST        | `/integrations/gestta/sync`                 | Consultar / executar a sincronização Gestta → Drive   |
| GET             | `/dashboard`                                | Painel (`competencias`, `empresa`, `responsavel`, `refresh`) |
| GET             | `/gestta/history`                           | Histórico agrupado (`search`, `competence`, `status`) |
| GET/POST        | `/cron/gestta-sync`                         | Iniciar agendamento / disparar sincronização (pública) |
| GET             | `/integrations/google/connect`              | Iniciar o OAuth do Google                             |
| GET             | `/integrations/google/status`               | Status da conexão com o Drive                         |
| POST            | `/integrations/google/test`                 | Testar o acesso ao Drive                              |
| POST            | `/integrations/google/disconnect`           | Desconectar o Google Drive                            |
| GET             | `/integrations/google/callback`             | Retorno do OAuth (pública)                            |
| GET/POST        | `/api-tokens`                               | Listar / gerar tokens de API                          |
| DELETE          | `/api-tokens/:id`                           | Revogar token de API                                  |
| POST            | `/integrations/gestta/statements/sync`      | Capturar extratos enviados no Gestta                  |
| GET             | `/public/v1/extratos`                       | Listar extratos OFX/PDF (token de API)                |
| GET             | `/public/v1/extratos/:id/download`          | Baixar extrato (token de API)                         |

As rotas `/google/*` são aliases antigos das rotas `/integrations/google/*`. A API Nest local expõe ainda `GET /health` e as rotas do antigo CRM comercial (oportunidades e importação CSV), que não são mais usadas pela interface; como o Next encaminha ao Nest os caminhos `/api/*` sem rota própria, elas só respondem em desenvolvimento com o Nest rodando.
