# sistema-obras-backend

Backend do sistema de gestão de lotes, obras e projetos (condomínio Rudá).
Repositório independente do frontend — expõe apenas API HTTP.

**Escopo:** exclusivamente a planilha "CONTROLE E GESTÃO - OBRAS E
PROJETOS". A planilha "2026 - Controle de Notificações Emitidas" está fora
do escopo atual do sistema — decisão de escopo consolidada.

**Modelo de domínio (Fase 5):** ver `DOMAIN_MODEL.md` (justificativas) e
`REVISAO_MODELO_DOMINIO.md` (análise que fundamentou as decisões — Lote 1:N
Obra, separação Obra/Ocupação/Alerta, fusão Pessoa/ResponsávelTécnico).

## Stack

Node.js · TypeScript · Fastify · Prisma (schema/migrations) · PostgreSQL · Zod · Vitest · ESLint

## Nota importante sobre este build

Este repositório foi montado em um ambiente sem acesso de rede a
`binaries.prisma.sh`, o que impede `npx prisma generate` e
`npx prisma migrate dev` de baixar o engine do Prisma. Por isso, **neste
commit**:

- as migrations em `prisma/migrations/` foram escritas manualmente (SQL puro,
  equivalente ao que o Prisma Migrate geraria a partir de `schema.prisma`) e
  **aplicadas de fato** contra um Postgres real durante o desenvolvimento;
- o acesso a banco em `src/lib/db.ts` e `prisma/seed.ts` usa `pg` cru em vez
  de `@prisma/client`.

Em qualquer ambiente com rede normal (dev local, CI, etc.), rode:

```bash
npm install
npx prisma generate
```

e o `@prisma/client` fica disponível normalmente. A partir daí, `schema.prisma`
volta a ser a única fonte a editar — novas migrations podem ser geradas com
`npx prisma migrate dev --name <nome>` em vez de escritas à mão.

## Setup

```bash
cp .env.example .env   # ajuste DATABASE_URL
npm install
npx prisma migrate deploy   # aplica as migrations existentes (ambiente com rede normal)
npm run seed
npm run dev
```

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | sobe o servidor com reload (tsx watch) |
| `npm run build` | compila TypeScript para `dist/` |
| `npm start` | roda o build compilado |
| `npm test` | roda a suíte Vitest (inclui testes de constraint contra o Postgres real) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | popula catálogos de status, quadras e usuários iniciais |
| `npm run prisma:generate` | gera o Prisma Client (precisa de rede irrestrita) |
| `npm run prisma:migrate:dev` | fluxo normal de migration em desenvolvimento |
| `npm run prisma:migrate:deploy` | aplica migrations pendentes em produção/CI |

## Estrutura

```
prisma/
  schema.prisma           # fonte de verdade do modelo de dados
  migrations/              # histórico de migrations (SQL) — init único da Fase 5
  seed.ts                  # dados iniciais (catálogo de status de obra, mapeamento
                            # legado, quadras, usuários)
src/
  app.ts                   # construção do Fastify app (testável via inject)
  server.ts                # entrypoint (listen)
  lib/db.ts                # acesso a banco (pg cru — ver nota acima)
test/
  health.test.ts           # healthcheck HTTP + conexão real com o banco
  constraints.test.ts      # valida as constraints críticas do schema (Postgres real)
DOMAIN_MODEL.md             # justificativa de cada decisão de modelagem
REVISAO_MODELO_DOMINIO.md   # análise que fundamentou o modelo da Fase 5
```

## Modelo implementado (resumo)

19 tabelas. Núcleo: `Condominio` → `Quadra` → `Lote` → `Obra` (1:N — um lote
pode ter mais de uma obra ao longo do tempo, ex. construção inicial + reforma
posterior). `Pessoa` é a única entidade de pessoa física/jurídica do domínio;
atua como titular de `Lote` (via `LotePessoa`) e/ou responsável técnico de
`Obra` (via `ObraPessoa`), sem duplicar cadastro. O antigo status único de 14
grafias foi separado em três conceitos independentes: `StatusObra` (ciclo da
construção, com histórico e mapeamento legado auditável), `OcupacaoLote`
(disponível/morador, historizado) e `Lote.emAlerta` (flag independente).
`Anotacao` e `Documento` se ligam apenas a `Lote` ou `Obra`.

## Usuários iniciais (seed)

Três usuários de teste, um por papel, com a mesma senha (definida via
`SEED_ADMIN_PASSWORD`, com padrão de desenvolvimento — troque antes de
qualquer ambiente real):

- `admin@ruda.local` — ADMIN
- `analista@ruda.local` — ANALISTA
- `consulta@ruda.local` — CONSULTA

Autenticação (JWT) e as regras de autorização por papel ainda não foram
implementadas nesta fase — o schema já modela `Usuario.role`, mas os guards
de rota ficam para a próxima fase, junto com o importador da planilha.

## Próximos passos (fora do escopo desta fase)

- Rotas REST de CRUD para Lote/Obra/Pessoa.
- Autenticação (JWT) e guards de autorização por `RoleUsuario`.
- Armazenamento físico de documentos (metadados já modelados em
  `Documento.storageProvider`/`storageKey`).
- Fila/agendamento de importação (hoje é um comando CLI síncrono).

## Fase 7 — API REST

Servidor Fastify com 14 módulos, documentação OpenAPI em `/docs` (Swagger UI)
e autorização por papel aplicada em cada rota (nunca confiando no frontend).

```bash
npm run dev
# Swagger UI:  http://localhost:3000/docs
# Login:       POST /auth/login  { "email": "...", "senha": "..." }
```

### Módulos e prefixos

| Módulo | Prefixo | Observação |
|---|---|---|
| Auth | `/auth` | login (público), `/auth/me` (autenticado) |
| Users | `/users` | somente ADMIN |
| Condomínios | `/condominios` | leitura geral, escrita só ADMIN |
| Quadras | `/quadras` | leitura geral, escrita só ADMIN |
| Lotes | `/lotes` | busca, filtros (`ocupacao`, `emAlerta`, `statusObraCodigo`, `quadraCodigo`), paginação, ordenação; sub-rotas `/ocupacao`, `/historico-ocupacao`, `/obras`, `/pessoas`, `/anotacoes`, `/documentos` |
| Pessoas | `/pessoas` | única entidade para proprietário e responsável técnico |
| Responsáveis Técnicos | `/responsaveis-tecnicos` | visão sobre `Pessoa` + `PessoaDadosProfissionais`, não uma tabela própria |
| Obras | `/obras` | filtros (`loteId`, `quadraCodigo`, `statusCodigo`, `tipo`, `liberadoParaMudanca`); status com histórico (`/status`, `/historico-status`), responsáveis técnicos, anotações, documentos |
| Status de Obra | `/status-obra` | catálogo fechado (8 registros), leitura geral |
| Anotações | `/anotacoes` | ligadas a lote OU obra (nunca notificação) |
| Documentos | `/documentos` | metadados only — sem armazenamento físico nesta fase |
| Histórico | `/historico` | agregador (mesmos dados de `/lotes/:id/historico-ocupacao` e `/obras/:id/historico-status`) |
| Importações | `/importacoes` | somente ADMIN; upload multipart do `.xlsx`, reaproveita o pipeline da Fase 6; `/importacoes/:id/erros` lista os erros por linha |
| Dashboard | `/dashboard/resumo`, `/dashboard/indicadores`, `/dashboard/evolucao` | indicadores 100% agregados via SQL — nunca carrega a lista completa de lotes; `/indicadores` e `/evolucao` aceitam filtros (`quadraId`, `statusObraId`, `ocupacao`, `dataInicio`, `dataFim`, `granularidade`) |
| Auditoria | `/auditoria` | somente ADMIN |

### Autorização (RBAC)

Aplicada em cada rota via `fastify.authenticate` (JWT) +
`fastify.authorize(...roles)` — nunca no frontend. CONSULTA só lê; ANALISTA
lê e opera dados do dia a dia (lotes, obras, pessoas, anotações, documentos);
Users/Importações/Auditoria e a criação de Condomínios/Quadras são
exclusivos de ADMIN.

### Cuidado ao declarar `response` schema no Fastify

Descoberto durante o desenvolvimento desta fase: declarar
`response: { 200: { type: "object" } }` sem `properties` faz o
serializador do Fastify (fast-json-stringify) **descartar todos os campos**
da resposta (a rota volta a funcionar normalmente, só o corpo vem vazio).
Todas as rotas que devolvem um objeto/array sem schema fixo (ex.: resumo do
dashboard, histórico) usam `additionalProperties: true` para evitar isso —
ver `lib/schemas.ts` e o padrão repetido nos módulos.

## Fase 6 — Importador da planilha de Obras

```bash
npm run import -- --file "/caminho/CONTROLE_E_GESTÃO__OBRAS_E_PROJETOS_.xlsx" --dry-run
npm run import -- --file "/caminho/CONTROLE_E_GESTÃO__OBRAS_E_PROJETOS_.xlsx"
```

Pipeline em `src/import/`: `excelReader.ts` (Excel → RawData) →
`validation.ts` → `normalization.ts` → `mapping.ts` (resolve `STATUS` contra
`StatusObraLegacyMap`) → `persistence.ts` (Domain → Postgres, transacional) →
`importer.ts` (orquestrador, registra `ImportacaoExecucao`/`ImportacaoErro`).
`--dry-run` roda o pipeline inteiro dentro de uma transação e sempre dá
`ROLLBACK` no final — garantia de banco, não uma flag de aplicação.

Decisões de deduplicação (documentadas nos comentários do próprio código):
`Lote` por `(quadra, número)`; `Pessoa` só por igualdade exata de nome
normalizado, nunca fuzzy; nomes compostos com conjunção ambígua (`" E "`)
nunca são separados automaticamente — ficam em `Lote.observacaoLegado` para
revisão manual. Ver `RELATORIO_IMPORTACAO.md` para o resultado da primeira
importação real.
