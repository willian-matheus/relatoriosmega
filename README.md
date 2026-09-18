# Mega CRM

CRM comercial em Kanban com **React + Next.js** no frontend e **NestJS** na API. Interface em português, tema escuro e detalhes em violeta inspirados nas referências fornecidas.

## Executar localmente

Requisitos: Node.js 22 ou superior e npm.

```sh
npm install
npm run dev
```

- Aplicação: http://localhost:3000
- API: http://127.0.0.1:3001/api
- Saúde da API: http://127.0.0.1:3001/api/health

O frontend encaminha `/api/*` para o NestJS, sem expor uma URL de API no cliente. Os arquivos `.env.example` mostram as configurações opcionais. No Next, copie para `apps/web/.env.local`; o Nest usa as variáveis do processo (não carrega arquivos `.env` automaticamente).

## O que está implementado

- Kanban com cinco etapas, arrastar e soltar, visualização em lista, busca e filtros por responsável/prioridade.
- Criação, edição e exclusão de oportunidades; no celular ou teclado, a etapa também pode ser alterada pelo formulário.
- Resumo comercial calculado com os dados da API, pendências de contato e histórico de atividades da sessão.
- Contatos vinculados às oportunidades.
- Importação CSV com modelo para download, validação, prévia e confirmação. O mesmo token não pode ser confirmado duas vezes.
- Estados de carregamento, erro e vazio; layout responsivo e diálogos com foco e navegação por teclado.

## Dados e escopo desta primeira versão

O sistema inicia vazio, sem oportunidades, relatórios ou atividades fictícias. Com Supabase configurado, os dados são persistidos no banco. Sem Supabase, alterações, importações e atividades ficam em memória e são perdidas ao reiniciar a API (inclusive reinícios automáticos em desenvolvimento). Consultar um banco vazio não cria registros automaticamente.

Não há autenticação ou isolamento por usuário. O servidor está limitado a `127.0.0.1` e foi preparado para demonstração local. Login, banco, regras comerciais definitivas, formatos reais de relatórios e integração com Google Drive serão implementados posteriormente.

Os totais consideram todas as oportunidades da sessão, não um período fictício. A taxa de fechamento é a quantidade de cartões em Fechados dividida pelo total. Os responsáveis da demonstração são Ana Martins, Bruno Costa e Camila Lima.

## Acompanhamento de relatórios

Na aba **Relatórios**, consulte os relatórios disponíveis, documentos pendentes, dúvidas sem solução e a última atualização. A busca filtra pelo nome; os filtros **Com pendências** e **Com novidades** ajudam a priorizar o trabalho.

Abra um relatório para solicitar documentos, marcar recebimento, registrar dúvidas e responder na mesma conversa. Cada dúvida pode apontar para um registro e uma página, seção ou referência. Autor, data e contexto são preservados, inclusive se o registro associado for removido. Responder não resolve automaticamente a dúvida; use **Marcar como resolvida** ou **Reabrir dúvida**.

**Marcar como revisado** define uma referência compartilhada pela equipe. Registros criados depois dela aparecem como novos; registros modificados aparecem como alterados. A revisão não encerra documentos pendentes nem dúvidas abertas. O histórico anterior continua disponível.

O acompanhamento é persistido no campo existente `reports.metadata.workflow`, sem migração de esquema. A gravação compara `updated_at` para evitar sobrescrever alterações simultâneas; em caso de conflito, atualize a lista e reenvie seu texto, que permanece no formulário. Na interface, o autor vem da sessão autenticada; chamadas diretas à API Nest local são identificadas como **API local**. Sem Supabase, o acompanhamento permanece apenas na memória do processo.

Documentos pendentes são registrados e conferidos manualmente. Os destaques comparam registros vinculados à mesma importação; não comparam automaticamente versões de arquivos do Google Drive ou reimportações distintas.

## CSV inicial

UTF-8, até 2 MB e 500 linhas. Vírgula ou ponto e vírgula são detectados automaticamente. Colunas:

| Coluna      | Obrigatória | Formato                                                             |
| ----------- | ----------- | ------------------------------------------------------------------- |
| empresa     | Sim         | Texto, 2 a 100 caracteres                                           |
| contato     | Sim         | Texto, 2 a 100 caracteres                                           |
| valor       | Sim         | Número não negativo, ponto decimal, sem moeda ou milhar: `18500.00` |
| vencimento  | Sim         | Data válida `AAAA-MM-DD` para o próximo contato                     |
| email       | Não         | E-mail válido ou vazio                                              |
| responsavel | Não         | Um responsável da demonstração; padrão Ana Martins                  |
| prioridade  | Não         | `high`, `medium` ou `low`; padrão `medium`                          |
| observacoes | Não         | Texto de até 2.000 caracteres                                       |

Todos entram em Novos leads. A validação ocorre novamente no servidor. A prévia expira após 15 minutos. Reimportar o mesmo arquivo em uma nova prévia cria novos registros; regras de deduplicação dependem do identificador dos relatórios reais. Este contrato inicial está isolado para ser adaptado depois.

## Organização

```text
apps/web       Next.js App Router, React, interface e parser CSV
apps/api       NestJS, validação, serviços em memória e importação
packages/contracts  Tipos e validação Zod compartilhados
```

O `CrmService` concentra o armazenamento temporário e deverá passar a usar um repositório persistente na fase de banco de dados. Nenhuma credencial externa é necessária nesta versão.

## Verificações

```sh
npm run build
npm run typecheck
npm test
```

Após o build, execute `npm start` para iniciar a aplicação e a API compiladas. O frontend usa DM Sans e Manrope do Google Fonts, com fallback local sem bloquear a aplicação.

## Endpoints

| Método | Caminho (prefixo `/api`)   | Função                                 |
| ------ | -------------------------- | -------------------------------------- |
| GET    | `/health`                  | Saúde e tipo de armazenamento          |
| GET    | `/workspace`               | Oportunidades, relatórios e atividades |
| POST   | `/opportunities`           | Criar oportunidade                     |
| PATCH  | `/opportunities/:id`       | Salvar formulário completo             |
| PATCH  | `/opportunities/:id/stage` | Alterar etapa                          |
| DELETE | `/opportunities/:id`       | Excluir oportunidade                   |
| POST   | `/imports/preview`         | Validar `{ name, rows }` e gerar token |
| POST   | `/imports/:token/commit`   | Confirmar uma prévia validada          |
| PATCH  | `/reports/:id`             | Registrar documentos, conversas, resolução e revisão |
