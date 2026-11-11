# Relatório de implementação — Extratos bancários: captura no Gestta, conversão de PDF para OFX, Google Drive, API com token e envio ao CRM-MEGA

Data: novembro de 2026
Branch de trabalho: `auk`

---

## 1. Objetivo

O objetivo foi levar automaticamente os **extratos bancários dos clientes** da Mega Contabilidade, nos formatos **OFX** e **PDF**, do Gestta até a plataforma de conciliação **CRM-MEGA**, sem trabalho manual e **sem duplicidade**.

O fluxo definido foi:

1. Os clientes enviam os extratos pelo **Gestta**.
2. O **Mega CRM** (relatoriosmega) busca esses extratos, guarda os arquivos e organiza tudo.
3. Quando o cliente envia **somente o PDF** do extrato de conta corrente, o CRM **gera o OFX** a partir do PDF.
4. Uma cópia de cada extrato fica no **Google Drive**, organizada por empresa e competência, para consulta da equipe.
5. O CRM **envia** os extratos ao **CRM-MEGA**, autenticado pelo token cadastrado lá, e garante que nenhum extrato chegue duas vezes.
6. Também existe uma **API de consulta** com token, para outras plataformas que preferem buscar os arquivos.

---

## 2. Visão geral do fluxo

**Gestta → captura no CRM → conversão de PDF para OFX (quando necessário) → armazenamento seguro → cópia no Google Drive → deduplicação → envio ao CRM-MEGA**

- **Origem:** tarefas do Gestta chamadas "Envio de Extratos Bancários e Documentos Contábeis".
- **Armazenamento:** os arquivos ficam num espaço privado do Supabase, e os dados de cada extrato (empresa, CNPJ, competência, tipo, datas, situação do envio) ficam numa tabela própria.
- **Cópia para a equipe:** uma pasta privada no Google Drive.
- **Entrega:** envio automático ao CRM-MEGA, com verificação do que ele já tem, e uma API de consulta protegida por token.

---

## 3. Como os extratos chegam no Gestta (descobertas)

### 3.1 Onde os extratos ficam

- Os clientes enviam os extratos nas tarefas **"Envio de Extratos Bancários e Documentos Contábeis"**. Só em outubro e novembro de 2026 havia **552 tarefas** desse tipo.
- Cada tarefa tem uma **solicitação de documentos** com cinco itens:
  - Extratos de Conta Corrente (em OFX e em PDF);
  - Extratos de Aplicações Financeiras;
  - Extratos de Empréstimos e Financiamentos;
  - Extratos de Cotas de Capital;
  - Demais Documentos (recibos, faturas, contratos).
- O cliente anexa os arquivos em cada item. Os quatro primeiros são extratos; "Demais Documentos" não entra.

### 3.2 Problemas encontrados no código que já existia

1. **Busca restrita:** a busca de tarefas filtrava só as **tarefas sem responsável**, e por isso vinham cerca de **11 tarefas em vez de 9.042** no mesmo período. A captura nova busca as tarefas de todos os responsáveis.
2. **Endereço errado de anexos:** o endereço usado para listar os anexos sempre vinha vazio. Os arquivos ficam na solicitação de documentos da tarefa, e passaram a ser lidos de lá.
3. **Download incompleto:** o Gestta devolve um **link temporário**, e não o arquivo. O código antigo salvava essa resposta como se fosse o documento, então os "PDFs" enviados ao Drive eram pequenos arquivos de texto. Isso foi corrigido.
4. **CNPJ ausente:** a tarefa não traz o CNPJ do cliente. A captura passou a completá-lo pela lista de clientes do Gestta.

---

## 4. O que foi implementado

### 4.1 Captura de extratos do Gestta

A cada execução, a captura:

1. percorre as tarefas com vencimento entre **90 dias atrás e 45 dias à frente**;
2. separa as tarefas de envio de extratos;
3. lê os arquivos dos itens de extrato, ignorando "Demais Documentos" e itens desconsiderados;
4. baixa **somente os arquivos novos**;
5. guarda **OFX** (reconhecido pelo conteúdo, não pela extensão) e **PDF**. Outros formatos (RAR, ZIP, planilhas, imagens) são ignorados e listados no resumo;
6. registra empresa, CNPJ, competência, tipo de extrato, data de envio pelo cliente e data da captura;
7. aplica a regra de conversão de PDF para OFX (seção 4.2);
8. envia uma cópia ao Google Drive (seção 4.3).

**Quando roda:** automaticamente a cada ciclo da sincronização agendada e sob demanda por uma rota que exige login.

**Garantias:**
- rodar de novo não duplica nada;
- falha num arquivo não interrompe os outros;
- falha no Drive não impede a captura.

**Correção de falso positivo:** documentos como "Extrato FGTS" e "Conciliação de Impostos" foram excluídos, porque não são extratos bancários.

### 4.2 Conversão de PDF para OFX

**Quando se aplica:** numa tarefa de extratos, o cliente enviou PDF no item "Extratos de Conta Corrente" e **nenhum OFX**.

**O que o sistema faz:**

1. lê o texto do PDF e reconstrói as linhas do extrato;
2. identifica cada lançamento (data, descrição, valor, crédito ou débito) e os saldos impressos;
3. **confere** os lançamentos contra os saldos do próprio PDF: entre dois saldos, a diferença precisa ser igual à soma dos lançamentos;
4. **somente se todos os saldos conferirem**, gera o OFX com banco, agência, conta, período, lançamentos e saldo final;
5. salva o arquivo como **"(nome do PDF) (arquivo convertido do PDF).ofx"**, ligado ao PDF de origem;
6. no Google Drive, grava a descrição **"Arquivo convertido automaticamente do PDF … enviado pelo cliente"**, com quantidade de lançamentos, período e saldos.

**Trava de segurança:** se os lançamentos não fecharem com os saldos, **nenhum OFX é gerado** e o motivo fica registrado. Um OFX errado na contabilidade é pior do que a falta do arquivo.

**Layouts reconhecidos** (todos vistos nos dados reais):
- Banco do Brasil, em dois modelos;
- Bradesco (descrição na linha de cima e lançamentos do mesmo dia sem repetir a data);
- Ailos / Viacredi;
- PagSeguro / PagBank;
- Mercado Pago (datas com hífen, descrição em várias linhas, saldo inicial e final no topo).

**Não são convertidos, com motivo claro:**
- PDFs escaneados (imagem sem texto), que precisariam de OCR;
- relatórios de vendas ou recebimentos;
- demonstrativos de aplicação (resumo mensal sem lançamentos com data);
- PDFs que só mostram saldos;
- extratos de aplicações, empréstimos e cotas de capital, porque o OFX é de conta corrente.

**Ajuste feito durante os testes:** a regra de "linha sem data é do mesmo dia", necessária para o Bradesco, passou a pegar valores de um quadro informativo que o Banco do Brasil imprime depois do extrato. A trava de saldos recusou o arquivo, e a regra foi restringida às linhas que só têm número de documento antes do valor.

### 4.3 Cópia no Google Drive

- Cada extrato ganha uma cópia em **Pasta raiz → Empresa → Competência AAAA-MM → arquivo**.
- Cada arquivo recebe um sufixo curto com o código do Gestta, para que dois arquivos com o mesmo nome não se sobrescrevam.
- Extratos capturados com o Drive desconectado são enviados na próxima execução.

**Decisão de privacidade:** a pasta da sincronização antiga ("Mega Contabilidade - Gestta") está **compartilhada com qualquer pessoa com o link**. Para não expor extratos bancários, eles vão para uma **pasta separada e privada**, "Mega Contabilidade - Extratos".

**Correção na tela de Integrações:** ela mostrava "Drive conectado" mesmo com o acesso expirado no Google. Agora testa o acesso e, se expirou, mostra o botão de conectar.

### 4.4 Tokens de API

- Na tela **Integrações**, o painel **"Tokens de API · Extratos OFX e PDF"** gera um token com nome da plataforma e validade.
- O token completo aparece **uma única vez**. O banco guarda só uma versão criptografada.
- O painel mostra status, validade e último uso, e permite **revogar** um token na hora.
- Foi gerado o token "CRM-MEGA", cadastrado no CRM-MEGA em "Tokens de outras plataformas".

### 4.5 API de consulta

Para plataformas que preferem buscar os arquivos:
- **listar extratos**, com filtros por formato, competência, CNPJ, data ("desde", para buscar só o que é novo) e paginação;
- **baixar** cada arquivo, com código de integridade para conferir que chegou inteiro.

Cada item informa empresa, competência, tipo, datas e se o arquivo foi **convertido de PDF**.

### 4.6 Envio ao CRM-MEGA

O CRM-MEGA **não busca** os extratos: ele espera **receber** os arquivos de outra plataforma, autenticada pelo token cadastrado lá. Por isso foi criado o **envio** do relatoriosmega para o CRM-MEGA.

- Cada envio leva o arquivo e os dados de identificação da empresa: CNPJ, código e nome, além da competência.
- O CRM-MEGA identifica a empresa sozinho. O código da empresa no Gestta é o mesmo do CRM-MEGA na maioria dos casos.
- O resultado de cada envio fica registrado: identificador do extrato criado no CRM-MEGA ou o erro.
- Há envio **manual** (com um modo de simulação que só mostra o que seria enviado) e envio **automático** a cada ciclo. O automático está **desligado** até a liberação.

### 4.7 Deduplicação (nenhum extrato chega duas vezes)

**Por que foi necessária:** o CRM-MEGA não evita duplicidade, e cada envio vira um extrato novo. Além disso, ele já recebe muitos extratos por outro caminho (SCI Web). Das combinações de empresa e mês capturadas que ele reconhece, **67 já existiam lá** e **50 não**.

**O que é "o mesmo extrato":** mesma empresa, mesma competência e mesma conta (quando a conta é conhecida dos dois lados), com pelo menos **metade dos lançamentos iguais** (mesma data e mesmo valor, com o sinal). Contas diferentes nunca são o mesmo extrato.

**Regras aplicadas antes de cada envio:**
1. **OFX e PDF do mesmo extrato:** vai só um, na preferência OFX do cliente, depois OFX convertido, depois PDF.
2. **Arquivo idêntico** enviado duas vezes pelo cliente: vai uma vez.
3. **O CRM-MEGA já tem:** não vai.
4. **Já foi enviado antes:** não vai de novo, nem em outro formato.
5. **Na dúvida** (por exemplo, PDF ilegível sem conta identificada num grupo que já tem OFX), não vai.
6. **Empresa que o CRM-MEGA não reconhece:** fica aguardando, sem ser descartada, até ser cadastrada lá.
7. **Execuções ao mesmo tempo:** cada arquivo é reservado antes do envio, então duas execuções não mandam o mesmo arquivo.
8. **Resposta perdida:** se a resposta se perde depois de o CRM-MEGA gravar, a nova tentativa detecta que ele já tem o extrato e não reenvia.
9. **Erros** são tentados de novo até três vezes.

**Como o relatoriosmega sabe o que o CRM-MEGA já tem:** a API do CRM-MEGA não aceita consulta com token externo. A verificação lê o banco do CRM-MEGA com um **usuário somente leitura**, que só enxerga as tabelas de empresas, bancos, contas, extratos e lançamentos e não altera nada. Sem esse acesso configurado, o envio fica bloqueado.

**Identificação da empresa no CRM-MEGA:** pelo CNPJ (quando ele tem), ou por código e nome juntos, ou só pelo nome. Código igual com nome diferente **não** é aceito, porque códigos podem coincidir entre sistemas.

### 4.8 Desempenho

- A primeira versão do envio analisava todos os arquivos de uma vez, baixando e relendo cada um. Uma simulação completa levou **638 segundos**, acima do limite de 5 minutos da hospedagem.
- Otimizações:
  - a conta e os lançamentos de cada arquivo ficam **guardados** depois da primeira leitura;
  - os arquivos que ainda precisam ser lidos são processados **em paralelo**;
  - a análise anda em **lotes** de empresa e competência e **para quando atinge o limite** de envios da execução.
- Resultado: **139 segundos** na primeira vez e **31 segundos** nas seguintes, com exatamente o mesmo plano de envio.

---

## 5. Alterações no banco de dados (Supabase do CRM)

Todas as alterações foram aplicadas e estão versionadas na pasta de migrações:

1. **Tokens de API:** nome, versão criptografada, permissões, validade, revogação e último uso.
2. **Extratos capturados:** arquivo, empresa, CNPJ, competência, tarefa de origem, local no armazenamento, código de integridade e datas.
3. **Espaço privado de arquivos** para PDF e OFX.
4. **Campos de extrato:** tipo, data de envio pelo cliente e link da cópia no Drive.
5. **Campos de conversão:** PDF de origem e observação da conversão.
6. **Campos de envio:** situação (enviando, enviado, erro, não enviar), tentativas, data e resposta do CRM-MEGA.
7. **Impressão digital:** conta e lançamentos de cada arquivo, guardados para a deduplicação.
8. **Migração da tabela de histórico do Gestta:** a tabela já existia, mas não tinha migração que a criasse. A migração foi escrita para instalações novas.

**Segurança:** as tabelas novas e o espaço de arquivos **não têm acesso pela chave pública**. Só o servidor do CRM lê e grava.

**No banco do CRM-MEGA:** foi criado apenas o usuário somente leitura usado na deduplicação, com permissão restrita às cinco tabelas de extrato. Nenhum dado do CRM-MEGA foi alterado por esse acesso.

---

## 6. Testes realizados

### 6.1 Captura no Gestta (dados reais)
- Em 120 tarefas: **93 extratos** (26 OFX e 67 PDF), de 22 empresas, todos com CNPJ, sem erros.
- Rodar de novo não duplicou nada.
- A captura completa do período já reuniu **636 extratos**.

### 6.2 Conversão de PDF para OFX (dados reais)
- **Comparação com o OFX do próprio cliente:** em três extratos que o cliente enviou nos dois formatos, o OFX gerado do PDF ficou **100% igual** ao do cliente (132 de 132, 37 de 37 e 17 de 17 lançamentos).
- **Casos em que o cliente enviou só PDF:** de 9 arquivos, **5 foram convertidos** com todos os saldos conferidos (um deles com 236 lançamentos e 237 conferências) e 4 foram recusados corretamente (2 escaneados e 2 só com saldos).
- O resultado pode ser visto no Drive, na pasta **"Mega Contabilidade - Teste conversão PDF para OFX"**: PDF original, OFX convertido, OFX do cliente, planilha dos lançamentos e relatório de cada caso.

### 6.3 API e Google Drive
- Tokens, filtros, download e recusa de acessos inválidos funcionaram. Os arquivos baixados são idênticos byte a byte aos originais.
- Extratos reais foram gravados no armazenamento e copiados para a pasta privada do Drive.

### 6.4 Envio ao CRM-MEGA (dados reais)
- **Primeiro envio de teste:** um OFX de agosto/2026 foi recebido pelo CRM-MEGA com os 30 lançamentos, soma idêntica até o centavo e a empresa identificada por código e nome.
- **Simulação com todos os 457 extratos pendentes:** **217** seriam enviados, **233** foram barrados por duplicidade (79 porque o CRM-MEGA já tem o extrato) e **7** aguardam o cadastro da empresa no CRM-MEGA.
- **Envio real de 3 extratos** com a deduplicação ativa. A conferência no banco do CRM-MEGA mostrou **nenhuma duplicidade**. Exemplo: para uma empresa em que o CRM-MEGA já tinha o extrato de uma conta, o sistema barrou o OFX e o PDF dessa conta e enviou só o extrato da outra conta, que ele ainda não tinha.
- **Reenvio:** nenhum arquivo foi enviado de novo.

### 6.5 Testes automatizados
- **86 testes automatizados**, todos passando: 78 do envio e da deduplicação e 8 da API já existente. A verificação de tipos não aponta erros.
- **Cobertura:**
  - todas as regras de deduplicação, com casos extremos de conta (dígito verificador, zeros à esquerda, bancos diferentes);
  - a identificação da empresa e da competência no CRM-MEGA;
  - o fluxo completo de envio com armazenamento, destino e servidor simulados, incluindo erro do servidor, falha de rede, resposta perdida, limite por execução, simulação, execuções simultâneas e cache.
- **Prova de que os testes funcionam:** cada regra importante foi **quebrada de propósito**, uma de cada vez, para confirmar que os testes acusam o problema. **Todas as 12 quebras foram detectadas.** Numa delas (tentativas infinitas) os testes não acusavam de primeira; o teste que faltava foi acrescentado. O código foi restaurado ao original depois de cada quebra.

---

## 7. Configuração realizada

- **Variáveis locais**, no arquivo local que não vai para o repositório: chave de serviço do Supabase, credenciais do Google, conexões do banco, endereço e token do CRM-MEGA, acesso somente leitura ao banco do CRM-MEGA e o liga/desliga do envio automático (desligado).
- **Arquivo de exemplo** (que vai para o repositório): restaurado todas as vezes em que recebeu dados sensíveis por engano.
- **Google Cloud:** cliente OAuth com os endereços de retorno local e de produção. A recomendação foi publicar o app como "Em produção" para o acesso ao Drive não expirar a cada 7 dias.
- **Google Drive:** reconectado com a conta da Mega.
- **Portas locais:**
  - Mega CRM (relatoriosmega): **127.0.0.1:3000**;
  - CRM-MEGA: **porta 3010**, mudada para não disputar o mesmo endereço.

---

## 8. Segurança e privacidade

- Tokens guardados apenas criptografados, exibidos uma vez e revogáveis.
- Extratos em armazenamento privado, acessível só pelo servidor.
- Pasta de extratos no Drive privada, separada da pasta compartilhada por link.
- Acesso ao banco do CRM-MEGA apenas para leitura e restrito às tabelas de extrato.
- Conversão de PDF para OFX só gera arquivo com conferência de saldos.
- Envio com deduplicação: na dúvida, o arquivo não é enviado.
- Envio automático desligado até liberação.

---

## 9. Pendências e recomendações

1. **Ligar o envio automático:** após a liberação, ativar o envio a cada ciclo (até 50 extratos por ciclo). Os cerca de 214 extratos restantes vão em poucos ciclos.
2. **Commit e publicação:** as alterações ainda não foram registradas no Git. Depois do commit, publicar na produção (Vercel) com as mesmas variáveis de ambiente.
3. **Senha de acesso ao CRM:** definir uma senha própria. Sem ela, vale a senha padrão do código.
4. **Senhas expostas:** a senha do Gestta está escrita no código e num script antigo, e a senha do banco passou pelo arquivo de exemplo. Recomenda-se trocá-las.
5. **Duplicidades já existentes no CRM-MEGA:** foram vistos extratos repetidos que vieram do SCI Web antes deste trabalho (por exemplo, três cópias do mesmo extrato de agosto de uma empresa). Vale revisar do lado do CRM-MEGA.
6. **Reconhecimento de reenvio no CRM-MEGA:** como melhoria de longo prazo, o próprio CRM-MEGA poderia recusar extratos repetidos, como segunda camada de proteção.
7. **Empresas aguardando:** 7 extratos esperam o cadastro da empresa no CRM-MEGA.
8. **OCR:** extratos escaneados poderiam ser lidos com reconhecimento de texto, mantendo a mesma conferência de saldos.
9. **Novos bancos:** layouts ainda não vistos podem ser recusados pela trava até o conversor ser ajustado. Nunca é gerado OFX errado.
10. **Sincronização principal:** continua buscando só tarefas sem responsável e merece revisão.
11. **Acesso ao Drive:** o CRM pede acesso a todo o Drive, mas só usa as pastas que cria; dá para reduzir esse acesso.
