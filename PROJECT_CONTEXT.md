# PROJECT_CONTEXT.md

> Checkpoint do projeto. Este arquivo documenta o estado **real e
> verificado** do código neste momento — foi escrito lendo o repositório e
> executando os comandos de verificação (typecheck, lint, testes, consultas
> diretas ao Postgres), não de memória. Serve como contexto de partida para
> uma nova sessão (inclusive Claude Code).
>
> Última verificação: suíte completa executada de novo nesta sessão —
> `npx tsc --noEmit` limpo, `npx eslint .` limpo, `npx vitest run` → 80/80
> testes passando (8 arquivos). Contagens de dados e de rotas abaixo foram
> reconferidas contra o Postgres real e o código-fonte, não copiadas de uma
> versão anterior deste documento sem checar.

---

## 1. Objetivo atual do sistema

Sistema de controle e gestão de lotes, obras e projetos de um condomínio
(Rudá), substituindo o controle hoje feito em planilha Excel por um banco de
dados relacional (PostgreSQL) com uma API REST por trás, e um dashboard
(frontend, ainda não iniciado) por cima.

Fluxo geral do projeto: migrar os dados históricos da planilha para o
Postgres **uma vez** (importação); a partir daí, o Postgres é a única fonte
de verdade, e toda alimentação futura de dados acontece via API, consumida
pelo frontend.

---

## 2. Escopo atual

### Incluído
- Gestão de: Condomínio, Quadra, Lote, Pessoa (proprietário e/ou responsável
  técnico), Obra, Lote de Apoio, Status de Obra (com histórico), Ocupação de
  Lote (com histórico), Anotações, Documentos (metadados), Usuários,
  Autenticação, Autorização (RBAC), Auditoria, Importação da planilha de
  Controle de Obras.
- Fonte de dados única: planilha `CONTROLE E GESTÃO - OBRAS E PROJETOS`
  (aba `CONTROLE DE OBRAS E PROJETOS`).

### Explicitamente removido do escopo
- **Módulo de notificações** (planilha `2026 - Controle de Notificações
  Emitidas`) — decisão de negócio consolidada, não uma pendência temporária.
  Não existe no schema, nas migrations ativas, no código ou nos testes
  nenhuma entidade, campo, endpoint ou regra de notificação. O histórico de
  migrations registra que um módulo de notificação chegou a existir e foi
  removido em fases anteriores; esse histórico foi descartado ao reiniciar
  as migrations na Fase 5 (ver seção 9).
- Armazenamento físico de arquivos (upload real de foto/PDF) — só os
  metadados de `Documento` estão implementados.
- Frontend (`sistema-obras-frontend`) — repositório ainda não criado.

---

## 3. Arquitetura atual

```
Excel (.xlsx)
   │  src/import/excelReader.ts
   ▼
RawData → validation.ts → normalization.ts → mapping.ts (resolve STATUS)
   │  src/import/persistence.ts (transacional)
   ▼
PostgreSQL  ◄──────────────  API REST (Fastify)  ◄──────────────  Frontend (não iniciado)
                                    │
                             JWT + RBAC (ADMIN/ANALISTA/CONSULTA)
                             aplicado em toda rota, no backend
```

- Backend: Node.js + TypeScript + Fastify, organizado por módulos de
  domínio (`src/modules/<modulo>/{routes,service}.ts`).
- Acesso a dados: **`pg` (driver cru), não `@prisma/client`** — ver seção 18
  para o motivo. `prisma/schema.prisma` e as migrations continuam sendo a
  fonte de verdade do modelo, só o acesso em runtime não usa o client
  gerado.
- Importação: pipeline síncrono via CLI (`npm run import`) ou via upload
  multipart na API (`POST /importacoes`, só ADMIN).
- Autenticação: JWT (`@fastify/jwt`), emitido em `POST /auth/login`.
- Documentação: OpenAPI 3.0.3 via `@fastify/swagger` + `@fastify/swagger-ui`,
  servida em `/docs`.

---

## 4. Estrutura dos repositórios

### `sistema-obras-backend` (existe, é o repositório atual)
```
prisma/
  schema.prisma
  seed.ts
  migrations/
    migration_lock.toml
    20260826140000_init_fase5/migration.sql
src/
  app.ts                # monta o Fastify app (plugins, swagger, error handler, módulos)
  server.ts              # entrypoint (listen)
  lib/
    db.ts                 # Pool do pg (singleton)
    errors.ts             # classes de erro de aplicação (AppError e subclasses)
    pagination.ts          # paginação/ordenação segura
    schemas.ts             # fragmentos JSON Schema comuns (erro, paginação)
  plugins/
    db.ts                  # decora fastify.pg
    auth.ts                # JWT + authenticate/authorize (RBAC)
  modules/
    auth/ users/ condominios/ quadras/ lotes/ pessoas/
    responsaveis-tecnicos/ obras/ anotacoes/ documentos/
    historico/ importacoes/ dashboard/ auditoria/
      routes.ts + service.ts (cada um)
  import/
    types.ts validation.ts normalization.ts mapping.ts
    excelReader.ts persistence.ts importer.ts report.ts cli.ts
test/
  health.test.ts
  constraints.test.ts
  api/ (auth-rbac, lotes, obras-pessoas-documentos + helpers.ts)
  import/ (excelReader, pipeline-puro, importacao-integracao + helpers.ts)
DOMAIN_MODEL.md              # justificativa das decisões de modelagem (Fase 5)
REVISAO_MODELO_DOMINIO.md    # análise que fundamentou o modelo (Fase 4)
RELATORIO_IMPORTACAO.md      # resultado real da importação (Fase 6)
README.md                    # setup, scripts, módulos, RBAC
```

### `sistema-obras-frontend`
**Não existe ainda.** Nenhum arquivo, nenhum diretório, nenhuma decisão de
stack foi tomada para o frontend em nenhuma fase até aqui. Só foi
mencionado como repositório separado que consumirá a API via HTTP e nunca
acessará o banco diretamente.

---

## 5. Stack utilizada

### Backend (implementada e em uso)
Node.js · TypeScript (strict) · Fastify 5 · `pg` (driver Postgres cru) ·
PostgreSQL 16 · `@fastify/jwt` · `@fastify/swagger` + `@fastify/swagger-ui` ·
`@fastify/multipart` · `@fastify/cors` · `@fastify/sensible` · `bcryptjs` ·
`exceljs` (leitura do `.xlsx`) · Vitest · ESLint (flat config) ·
Prisma (só `schema.prisma`/migrations como fonte de modelo — client não gerado).

**Observação:** `zod` está no `package.json` como dependência, mas **não é
usado em nenhum arquivo de `src/`** — a validação de request é feita via
JSON Schema nativo do Fastify. Isso é um resíduo a limpar ou decidir usar de
fato (ver seção 20).

### Frontend
Não definida — nenhuma decisão de stack foi tomada.

---

## 6. Modelo de domínio atual

Entidades e papéis (nomes exatamente como estão no schema):

- **Condominio** → **Quadra** → **Lote** (núcleo do sistema).
- **Lote**: tem `emAlerta` (boolean, flag independente) e
  `observacaoLegado` (texto bruto não normalizável preservado). **Não** tem
  campo de status direto.
- **Obra**: `Lote (1) ──< (N) Obra` — um lote pode ter mais de uma obra ao
  longo do tempo (`tipo`: `CONSTRUCAO_INICIAL` ou `REFORMA`). Isso é uma
  **hipótese de design**, não um fato observado na estrutura da planilha
  original (que só tem uma obra "corrente" por linha) — ver seção 15.
- **StatusObra** + **ObraStatusHistorico** + **StatusObraLegacyMap**: ciclo
  de vida da construção, com histórico (`dataInicio`/`dataFim`, só um
  registro vigente por obra) e mapeamento auditável do texto legado da
  planilha para o status canônico.
- **OcupacaoLote** (enum `DISPONIVEL`/`MORADOR`) + **LoteOcupacaoHistorico**:
  ocupação do lote, independente do status da obra. Ausência de registro =
  "não informado" (nunca inferido como disponível).
- **Pessoa**: única entidade de pessoa física/jurídica do domínio — serve
  tanto para proprietário quanto para responsável técnico, evitando
  duplicar cadastro de quem exerce os dois papéis.
  - **PessoaDadosProfissionais**: extensão 1:1, só existe para quem já atuou
    como responsável técnico (`tipo`, `registroProfissional`).
  - **LotePessoa**: papel `TITULAR`/`COTITULAR`, liga Pessoa a Lote.
  - **ObraPessoa**: papel `RESPONSAVEL_TECNICO`, liga Pessoa a Obra.
- **LoteApoio**: auto-relação em Lote (`loteEmObraId` ≠ `loteApoioId`,
  reforçado por `CHECK` no banco).
- **Anotacao** e **Documento**: ligados a **Lote OU Obra** (exatamente um
  dos dois, reforçado por `CHECK` no banco) — nunca a notificação.
  `Documento` tem campos de metadado prontos para armazenamento físico
  futuro (`storageProvider`, `storageKey`, `checksumSha256`), todos nulos
  hoje.
- **Usuario**: `role` = enum fechado `ADMIN`/`ANALISTA`/`CONSULTA`.
- **AuditLog**: auditoria genérica (entidade, entidadeId, ação, campo,
  valor anterior/novo, usuário, data/hora, observação).
- **ImportacaoExecucao** + **ImportacaoErro**: rastreio de cada rodada de
  importação e cada erro/aviso por linha.

Documentos de referência completos: `REVISAO_MODELO_DOMINIO.md` (análise) e
`DOMAIN_MODEL.md` (justificativa final de cada decisão).

---

## 7. Estrutura atual do banco de dados

Verificado agora, contra o Postgres real (`sistema_obras`, local):
**19 tabelas**, todas com UUID como PK, timestamps (`criado_em`/
`atualizado_em` onde aplicável), FKs com `ON DELETE RESTRICT` nas
obrigatórias, `ON DELETE SET NULL` nas de usuário/auditoria.

| Tabela | Registros hoje (banco de desenvolvimento) |
|---|---|
| condominios | 1 |
| quadras | 20 |
| lotes | 349 |
| obras | 259 |
| pessoas | 528 |
| pessoa_dados_profissionais | 178 |
| lote_pessoa | 361 |
| obra_pessoa | 253 |
| lote_ocupacao_historico | 167 |
| status_obra | 8 |
| status_obra_legacy_map | 11 |
| obra_status_historico | 90 |
| lote_apoio | 10 |
| anotacoes | 186 |
| documentos | 0 |
| usuarios | 3 |
| audit_logs | 5 (inclui 4 registros órfãos deixados por testes que criam e depois apagam um Lote de teste — ver seção 20) |
| importacao_execucoes | 83 (mistura as 3 importações reais + execuções geradas pelos testes automatizados, que não limpam essa tabela de propósito) |
| importacao_erros | 500 |

Constraints notáveis, todas testadas e validadas por execução real:
- Índice único **parcial** (`WHERE data_fim IS NULL`) em
  `lote_ocupacao_historico` e `obra_status_historico` — no máximo um
  registro vigente por lote/obra.
- `CHECK` em `lote_apoio`: `lote_em_obra_id <> lote_apoio_id`.
- `CHECK` em `anotacoes` e `documentos`: exatamente um entre `lote_id`/
  `obra_id` preenchido.
- `UNIQUE (quadra_id, numero)` em `lotes`; `UNIQUE (condominio_id, codigo)`
  em `quadras`.

---

## 8. Schema Prisma e principais entidades

Arquivo: `prisma/schema.prisma`. Datasource `postgresql`, generator
`prisma-client-js` (client **não gerado** neste ambiente — ver seção 18).

9 enums: `RoleUsuario`, `TipoPessoa`, `PapelTitularidade`, `PapelObraPessoa`,
`TipoObra`, `OcupacaoLote`, `TipoDocumento`, `OrigemAnotacao`,
`StatusImportacao`.

19 models (idênticos às 19 tabelas da seção 7, com os nomes em PascalCase):
`Usuario`, `AuditLog`, `ImportacaoExecucao`, `ImportacaoErro`, `Condominio`,
`Quadra`, `Lote`, `LoteOcupacaoHistorico`, `StatusObra`,
`StatusObraLegacyMap`, `ObraStatusHistorico`, `Pessoa`,
`PessoaDadosProfissionais`, `LotePessoa`, `Obra`, `ObraPessoa`, `LoteApoio`,
`Anotacao`, `Documento`.

O schema usa `@map`/`@@map` para nomes de coluna/tabela em snake_case no
banco, mantendo camelCase no lado TypeScript/Prisma.

---

## 9. Migrations existentes

**Uma única migration ativa**: `prisma/migrations/20260826140000_init_fase5/migration.sql`
(328 linhas de SQL puro). Cria todas as 19 tabelas, enums, índices
(inclusive os únicos parciais) e `CHECK` constraints do zero.

Escrita **manualmente**, não gerada por `prisma migrate dev` (ver seção 18).
Validada por aplicação real, do zero, em um banco de teste separado, mais de
uma vez ao longo do projeto.

**Decisão de processo já tomada**: o histórico de migrations de fases
anteriores (que incluíam um módulo de notificação criado e depois removido,
e o modelo antigo com `StatusLote`/`ResponsavelTecnico` como tabela própria)
foi **descartado** em favor desta migration `init` única, por decisão
explícita registrada em `DOMAIN_MODEL.md` — não há ambiente externo
dependendo do histórico anterior.

**Importante**: como as migrations foram aplicadas via `psql` diretamente
(não via `prisma migrate deploy`), **não existe a tabela `_prisma_migrations`**
no banco atual. Se alguém rodar `npx prisma migrate deploy` ou
`npx prisma migrate dev` contra este mesmo banco sem tratar isso antes,
o Prisma vai tentar recriar as tabelas do zero e falhar (já existem). Ver
pendência na seção 20.

---

## 10. Estado atual da implementação

| Fase | Entregue |
|---|---|
| Análise de dados das planilhas | ✅ Completa |
| Modelo de domínio (proposto, revisado, aprovado) | ✅ Completo |
| Fase 5 — Schema Prisma + migration + seed | ✅ Completo |
| Fase 6 — Importador da planilha (pipeline completo) | ✅ Completo, com dados reais importados 3x |
| Fase 7 — API REST (14 módulos, RBAC, OpenAPI, testes) | ✅ Completo |
| Frontend | ❌ Não iniciado |

Validação mais recente confirmada nesta sessão: `npx tsc --noEmit` limpo,
`npx eslint .` limpo, `npx vitest run` → **80/80 testes passando** em 8
arquivos de teste.

---

## 11. O que já foi concluído

- Análise de dados da planilha original (quantidade de registros,
  duplicatas, inconsistências de nomenclatura, campos calculados).
- Modelo de domínio revisado (separação Obra/Ocupação/Alerta; unificação de
  Pessoa/ResponsávelTécnico; Lote 1:N Obra).
- Schema Prisma completo (19 models, 9 enums) e migration aplicada e
  validada.
- Seed idempotente (condomínio, quadras, catálogo de status de obra +
  mapeamento legado, 3 usuários — um por papel).
- Pipeline de importação completo (parser → validação → normalização →
  mapeamento de status → persistência transacional), com CLI e testes.
  Rodado 3 vezes contra a planilha real, com idempotência comprovada
  (2ª e 3ª rodadas: 0 novos, 0 atualizados).
- API REST com 14 módulos, **39 caminhos únicos / 51 operações HTTP**
  (verificado por contagem direta no código-fonte desta sessão, mais
  `/health` e `/health/db`) documentadas em OpenAPI, RBAC aplicado
  em cada rota no backend.
- Suíte de testes: 80 testes (unitários dos estágios puros do importador,
  integração do importador contra Postgres real, integração da API via
  `app.inject()` contra Postgres real, incluindo RBAC, paginação/filtros,
  histórico preservado em updates de status/ocupação).

---

## 12. O que está sendo implementado neste momento

Nada em andamento — a Fase 7 foi concluída e validada antes deste
checkpoint. Este documento (`PROJECT_CONTEXT.md`) é a própria tarefa em
execução no momento.

---

## 13. O que ainda falta implementar

- **Frontend** (`sistema-obras-frontend`) — 100% pendente, nenhuma decisão
  de stack tomada ainda.
- **Armazenamento físico de documentos** (upload real de arquivo) — hoje só
  o metadado é persistido.
- **Refresh token / expiração mais robusta de sessão** — hoje o JWT expira
  em 8h fixas, sem mecanismo de refresh.
- **Rate limiting** — não implementado.
- **Permissões mais granulares** — o modelo já prevê evolução (`RoleUsuario`
  isolado em `Usuario.role`), mas nenhuma tabela de permissões por
  ação/entidade existe.
- **Endpoint de troca de senha pelo próprio usuário** (hoje só ADMIN pode
  alterar senha de qualquer usuário via `PATCH /users/:id`).
- **Resolução da tabela `_prisma_migrations`** para permitir uso normal do
  fluxo `prisma migrate` no futuro (ver seção 20).
- Qualquer coisa relacionada a notificações — **fora de escopo por
  decisão**, não uma pendência.

---

## 14. Decisões arquiteturais importantes já tomadas

1. **Acesso a banco via `pg` cru, não `@prisma/client`**, porque o ambiente
   de build usado neste projeto não tem acesso de rede a
   `binaries.prisma.sh` (necessário para `prisma generate`/`prisma migrate
   dev` baixarem o engine). `schema.prisma` continua sendo a fonte de
   verdade do modelo; a troca para o client gerado, quando possível, fica
   isolada em `src/lib/db.ts`.
2. **Migrations escritas manualmente**, equivalentes ao que `prisma migrate
   dev` geraria, pelo mesmo motivo acima. Aplicadas e validadas via `psql`
   diretamente.
3. **Histórico de migrations reiniciado na Fase 5** — migrations anteriores
   (com módulo de notificação e modelo antigo) descartadas em favor de uma
   `init` única, por não haver ambiente externo dependente.
4. **Separação de três dimensões que a planilha misturava em uma só coluna
   `STATUS`**: ciclo de obra (`StatusObra`), ocupação do lote
   (`OcupacaoLote`) e alerta administrativo (`Lote.emAlerta`) — evidenciado
   por lotes reais com `STATUS = MORADOR` e reforma em andamento
   simultaneamente.
5. **`Lote (1) ──< (N) Obra`** — permite múltiplos ciclos de obra por lote
   (construção inicial + reforma), assumido como necessário mesmo sem
   evidência estrutural direta na planilha (que só registra uma obra
   corrente por linha). Ver seção 15 para o status desta hipótese.
6. **Fusão de Pessoa e ResponsávelTécnico em uma única entidade** (`Pessoa`
   + extensão `PessoaDadosProfissionais`), para não duplicar cadastro de
   quem for proprietário e responsável técnico ao mesmo tempo.
7. **`RoleUsuario` como enum fechado de 3 valores**, não uma tabela de
   papéis configurável — corresponde exatamente aos 3 perfis definidos até
   agora (ADMIN/ANALISTA/CONSULTA).
8. **RBAC aplicado inteiramente no backend**, nunca confiando no frontend —
   `fastify.authenticate` (JWT) + `fastify.authorize(...roles)` em cada
   rota que precisa.
9. **Dry-run de importação via transação com `ROLLBACK` garantido**, não uma
   flag de aplicação — o mesmo código de persistência roda, e a reversão é
   uma garantia de banco.
10. **Deduplicação de Pessoa só por igualdade exata de nome normalizado**,
    nunca fuzzy matching; nomes compostos com conjunção ambígua (`" E "`)
    nunca são separados automaticamente — preservados como texto bruto para
    revisão manual.
11. **Resposta de rota Fastify nunca declarada como `{ type: "object" }`
    sem `properties`** — descoberto que isso faz o serializador descartar
    todos os campos da resposta; o padrão adotado é
    `additionalProperties: true` quando o schema de resposta não é fixo.

---

## 15. Regras de negócio importantes descobertas

- A coluna `STATUS` da planilha original mistura três conceitos
  independentes (ver decisão 4 acima) — confirmado empiricamente: 5 lotes
  com `STATUS = MORADOR` têm menção textual a reforma em andamento nas
  `OBSERVAÇÕES`.
- `MORADOR` **não pode** ser inferido a partir de `LIBERADO PARA MUDANÇA?` +
  `DATA DA MUDANÇA` — só 18 dos 167 lotes `MORADOR` reais tinham essa data
  preenchida. A ocupação precisa ser um valor lançado explicitamente.
- Status vazio na planilha **não significa** "lote disponível" — 76 dos 109
  lotes com status vazio já tinham proprietário preenchido. A importação
  nunca infere `DISPONIVEL` nesse caso; marca para revisão manual.
- `"LOTE EM ALERTA"` é um sinalizador que pode coexistir com qualquer status
  de obra ou ocupação — não é um estágio de progressão.
- Nomes de proprietário/responsável técnico com `/` são separáveis com
  segurança (padrão sem ambiguidade real nos dados); nomes com `" E "`
  maiúsculo não são (pode ser conjunção real ou parte de abreviação/nome
  próprio) — tratados como não separáveis.
- Códigos de "lote de apoio" só são resolvidos quando seguem exatamente o
  padrão `LETRA + "2"` + número (ex. `"H2 05"`); formatos como `"J02"` ou
  `"F3"` são ambíguos e não resolvidos automaticamente.

---

## 16. Regras que ainda estão indefinidas

Estes pontos foram resolvidos com uma **decisão de implementação padrão**
para destravar as fases seguintes, mas **nunca receberam confirmação
explícita do responsável pelo negócio** — continuam abertos:

1. `Lote (1) ──< (N) Obra` é uma hipótese assumida (ver decisão 5, seção 14)
   para permitir reformas como novo ciclo de obra — não confirmado que essa
   seja de fato a regra de negócio correta (alternativa seria um novo
   `ObraStatusHistorico` na mesma Obra).
2. `LIBERADA_PARCIAL_MURO_TERRAPLANAGEM` foi implementado como status
   canônico próprio; alternativa seria `LIBERADA` + um atributo de escopo —
   não confirmado qual é preferível a longo prazo.
3. `LIBERADA_NAO_INICIADA` foi implementado como status canônico próprio;
   alternativa seria um valor derivado (liberada sem outro sinal de
   progresso) — não confirmado.
4. Se `Lote.emAlerta` deveria ter uma tabela de histórico própria (hoje só
   é registrado via `AuditLog` genérico) — decisão de esperar o uso real
   crescer antes de promover.

---

## 17. Como executar o projeto localmente

```bash
cd sistema-obras-backend
cp .env.example .env      # ajustar DATABASE_URL/JWT_SECRET se necessário
npm install

# Banco (ambiente com rede normal):
npx prisma migrate deploy   # ver seção 20 sobre a ausência de _prisma_migrations
# OU, se a tabela de controle não existir e as tabelas já estiverem criadas:
#   aplicar prisma/migrations/20260826140000_init_fase5/migration.sql via psql

npm run seed                # popula condomínio, quadras, status de obra, usuários

npm run dev                 # sobe o servidor em http://localhost:3000
# Swagger UI: http://localhost:3000/docs

# Importar a planilha real (ADMIN):
npm run import -- --file "/caminho/CONTROLE_E_GESTÃO__OBRAS_E_PROJETOS_.xlsx" --dry-run
npm run import -- --file "/caminho/CONTROLE_E_GESTÃO__OBRAS_E_PROJETOS_.xlsx"

# Validação:
npm run typecheck
npm run lint
npm test
```

Usuários de teste (senha padrão via `SEED_ADMIN_PASSWORD`, default
`TrocarEssaSenha!123` — trocar antes de qualquer ambiente real):
`admin@ruda.local` (ADMIN), `analista@ruda.local` (ANALISTA),
`consulta@ruda.local` (CONSULTA).

---

## 18. Como o Prisma/PostgreSQL está configurado

- `DATABASE_URL` em `.env`, formato
  `postgresql://usuario:senha@host:porta/banco?schema=public`.
- `prisma/schema.prisma`: `datasource db { provider = "postgresql" }`,
  `generator client { provider = "prisma-client-js" }`.
- **O Prisma Client nunca foi gerado com sucesso neste ambiente de
  desenvolvimento** — `npx prisma generate` falha com
  `Failed to fetch the engine file at https://binaries.prisma.sh/... - 403
  Forbidden`, porque o ambiente de build usado não tem acesso de rede a
  `binaries.prisma.sh`. Existe uma pasta `node_modules/.prisma/client` com
  arquivos `.d.ts`/`.js` pequenos (~4KB), que é um stub incompleto deixado
  pelo `npm install` do pacote `@prisma/client` — **não é um client
  funcional** (confirmado nesta sessão: tentar gerar de novo reproduz o
  mesmo erro 403).
- Por isso, todo acesso a banco em runtime (`src/lib/db.ts`, todos os
  `service.ts` dos módulos, `prisma/seed.ts`, `src/import/persistence.ts`)
  usa **`pg` (driver cru)** com SQL parametrizado, não o client do Prisma.
- Em qualquer ambiente com rede irrestrita até `binaries.prisma.sh`,
  `npx prisma generate` deve funcionar normalmente, e a partir daí é
  possível voltar a usar `@prisma/client` e o fluxo `prisma migrate dev`
  para novas migrations — a troca fica concentrada em `src/lib/db.ts`.
- Banco local usado durante o desenvolvimento: PostgreSQL 16, banco
  `sistema_obras`, usuário `postgres`/senha `postgres` (`localhost:5432`) —
  valores de desenvolvimento, não de produção.

---

## 19. Prisma MCP

**Não está configurado nem sendo utilizado.** Não existe nenhum arquivo de
configuração de MCP (`.mcp.json` ou similar) no repositório, e nenhuma
ferramenta MCP do Prisma foi usada em nenhuma fase deste projeto até agora.
Toda interação com o schema/migrations foi feita editando
`prisma/schema.prisma` e os arquivos `.sql` de migration diretamente, e
toda execução de SQL foi feita via `psql`/driver `pg`.

---

## 20. Problemas conhecidos ou pendências

1. **Ausência da tabela `_prisma_migrations`** — como as migrations foram
   aplicadas via `psql` direto, o Postgres atual não tem o registro de
   controle que o Prisma Migrate usa. Rodar `prisma migrate deploy`/`dev`
   contra este banco sem reconciliar isso primeiro vai falhar (tentará
   recriar tabelas já existentes). Precisa, no mínimo, de
   `npx prisma migrate resolve --applied 20260826140000_init_fase5` assim
   que o Prisma Client puder rodar neste ambiente.
2. **Dependência `zod` não utilizada** — está no `package.json` mas nenhum
   arquivo em `src/` a importa. Validação de request é 100% via JSON Schema
   nativo do Fastify. Decidir entre remover a dependência ou migrar a
   validação para Zod.
3. **Resíduo de dados de teste no banco de desenvolvimento**:
   - `audit_logs` tem **4 registros órfãos** (verificado nesta sessão via
     query direta) — referenciam um `Lote` já apagado pelo `afterAll` do
     teste `test/api/lotes.test.ts` ("edita um lote e registra auditoria").
     `entidade_id` não tem FK real (é um campo polimórfico), então não há
     erro de integridade, mas o dado é lixo de teste.
   - `importacao_execucoes`/`importacao_erros` acumulam execuções geradas
     pela suíte de testes de integração (`test/import/importacao-integracao.test.ts`,
     `test/api/importacoes` indiretamente via módulo), misturadas com as 3
     importações reais da planilha. Isso é esperado (o teste de rollback
     depende de o registro de falha persistir), mas deixa o banco de
     desenvolvimento com histórico "sujo" para quem for inspecionar
     manualmente.
4. **`node_modules/.prisma/client` com stub incompleto** — pode confundir
   quem verificar `node_modules` achando que o client foi gerado; não foi.
5. **Sem teste automatizado do fluxo de upload multipart de importação**
   (`POST /importacoes`) — o pipeline em si tem 30 testes (Fase 6), e a
   rota HTTP foi testada manualmente por `curl` durante a Fase 7, mas não
   há teste automatizado cobrindo especificamente o multipart parsing desta
   rota.
6. **Sem endpoint de logout/invalidação de token** — JWT stateless, expira
   em 8h; não há blacklist nem refresh token.

---

## 21. Próxima tarefa recomendada

Duas frentes possíveis, a depender da prioridade do responsável pelo
projeto:

**A. Fechar pendências técnicas do backend antes de avançar:**
1. Resolver a reconciliação do Prisma Migrate (`migrate resolve`) assim que
   `prisma generate` puder rodar num ambiente com rede irrestrita, e migrar
   `src/lib/db.ts` (e os demais pontos que usam `pg` cru) para
   `@prisma/client`.
2. Decidir o destino da dependência `zod` (remover ou adotar).
3. Adicionar teste automatizado do upload multipart de `POST /importacoes`.

**B. Iniciar o `sistema-obras-frontend`:**
Nenhuma decisão de stack foi tomada ainda — esse seria o primeiro passo
(escolha de framework, autenticação contra a API JWT já existente, consumo
do Swagger em `/docs/json` como contrato). A API já está completa e
documentada o suficiente para o frontend começar a ser construído em
paralelo às pendências técnicas do item A.
