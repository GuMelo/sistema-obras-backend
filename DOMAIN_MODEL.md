# Modelo de domínio — justificativas

> **Fase 5 — implementação definitiva.** Este documento foi atualizado para
> refletir o modelo de domínio revisado e aprovado em
> `REVISAO_MODELO_DOMINIO.md`, implementado em `prisma/schema.prisma` e na
> migration `20260826140000_init_fase5`. As justificativas de fases
> anteriores sobre notificação (fora de escopo) e sobre `StatusLote`/
> `ResponsavelTecnico` como tabelas separadas (substituídos nesta fase)
> foram removidas deste arquivo — consulte o histórico de versões do
> documento se precisar delas.

## Decisões tomadas nesta fase para destravar a implementação

A Fase 4 (revisão do modelo) terminou com 6 pontos em aberto. Para não travar
a Fase 5, cada um foi resolvido com uma decisão explícita, documentada aqui —
nenhuma foi "inventada" sem análise; todas estão detalhadas em
`REVISAO_MODELO_DOMINIO.md`:

1. **Fusão Pessoa/ResponsávelTécnico** → aplicada. `Pessoa` é a única tabela
   de pessoa física/jurídica; `PessoaDadosProfissionais` é uma extensão 1:1
   só para quem já atuou como responsável técnico; `LotePessoa` (titularidade)
   e `ObraPessoa` (responsabilidade técnica) são os dois papéis possíveis.
2. **`LIBERADA_PARCIAL_MURO_TERRAPLANAGEM`** → mantido como status canônico
   próprio de `StatusObra`, não como atributo — mais simples nesta fase.
3. **`LIBERADA_NAO_INICIADA`** → mesma lógica, status canônico próprio.
4. **Lotes com `STATUS` vazio na planilha (109 casos, 76 já com
   proprietário)** → a importação nunca cria uma linha em
   `LoteOcupacaoHistorico` nesse caso. Ausência de histórico = "não
   informado", nunca inferido como `DISPONIVEL`.
5. **`Lote.emAlerta`** → campo booleano simples, sem tabela de histórico
   dedicada nesta fase; mudanças de valor ficam registradas via `AuditLog`
   genérico. Pode ser promovido a uma tabela própria depois, se o uso
   justificar.
6. **`Lote (1) ──< (N) Obra`** → aplicada. Ver seção 1 abaixo.

## 1. Lote × Obra — por que 1:N, e por que isso é uma hipótese documentada

A estrutura da planilha (uma linha por lote, um único conjunto de colunas de
obra) não comprova, por si só, que um lote tenha mais de uma obra ao longo do
tempo — mas 5 lotes com `STATUS = MORADOR` têm, no texto de `OBSERVAÇÕES`,
menções explícitas a reformas acontecendo depois da mudança do morador. Isso
é evidência textual (não estrutural) de um segundo ciclo de obra sobre o
mesmo lote. `Obra.tipo` (`CONSTRUCAO_INICIAL`/`REFORMA`) existe justamente
para diferenciar esses ciclos. A importação da planilha, sozinha, só cria
**uma** Obra "corrente" por lote — uma segunda Obra de reforma só passa a
existir quando alguém a registrar depois que o sistema estiver em uso.

## 2. Separação de status: Obra × Ocupação do Lote × Alerta do Lote

A coluna `STATUS` da planilha mistura três dimensões independentes — prova
disso: 5 lotes `MORADOR` com reforma em andamento nas observações mostram que
ocupação e ciclo de obra podem estar em fases diferentes ao mesmo tempo. Por
isso:

- **`StatusObra` / `ObraStatusHistorico`**: ciclo de vida da construção (em
  análise → liberada → paralisada/finalizada → vistoriada). Tabela de
  catálogo completa porque genuinamente tem muitas variações e evolui.
- **`OcupacaoLote` (enum) / `LoteOcupacaoHistorico`**: só 2 valores
  (`DISPONIVEL`/`MORADOR`) — não é uma tabela de catálogo porque não há
  evidência de que esse conjunto vá crescer. É historizado (não um campo
  direto em `Lote`) porque a ocupação muda ao longo do tempo e precisa de
  auditoria, assim como o status de obra.
- **`Lote.emAlerta` (boolean)**: um sinalizador administrativo independente
  das outras duas dimensões — pode coexistir com qualquer status de obra e
  qualquer ocupação. Não é um valor dentro de um enum de status porque, se
  fosse, "marcar em alerta" substituiria a fase da obra em vez de se somar a
  ela.

## 3. Estratégia para status legados (mapeamento auditável)

`StatusObraLegacyMap`: `valorOrigem` (texto exato da planilha, ex.
`"EM ANALISE"`, `"OBRA LIBERADA "` com espaço) → FK para o status canônico
de `StatusObra`. A importação nunca decide o mapeamento "na hora" — consulta
essa tabela; se o texto não estiver mapeado, a linha vira `ImportacaoErro`,
não uma adivinhação silenciosa. `MORADOR` e `"LOTE EM ALERTA"` propositalmente
não entram nesta tabela — são tratados por campos próprios
(`OcupacaoLote`/`Lote.emAlerta`), não pelo catálogo de status de obra.

## 4. Estratégia de histórico/auditoria

- **Históricos específicos** (`ObraStatusHistorico`, `LoteOcupacaoHistorico`):
  otimizados para consulta frequente, com `dataInicio`/`dataFim` (não só um
  timestamp de evento).
- **`AuditLog` genérico**: cobre qualquer outra alteração relevante sem
  tabela de histórico dedicada (edição de dados cadastrais de `Lote`,
  `Pessoa`, mudança de `Lote.emAlerta`), com
  `valorAnterior`/`valorNovo`/`usuario`/`data`/`observacao`. Não guarda dado
  sensível desnecessário — nunca senha, nunca documento de identificação
  completo.
- **`ImportacaoExecucao` / `ImportacaoErro`**: cada rodada de importação é
  uma linha em `ImportacaoExecucao`; cada linha de planilha que falhou vira
  um `ImportacaoErro` com o motivo e os dados originais — nada é descartado
  silenciosamente.

## 5. Usuários e papéis

`RoleUsuario` é um enum fechado de 3 valores (`ADMIN`, `ANALISTA`,
`CONSULTA`) — o escopo atual define exatamente esses 3 perfis fixos, não um
sistema de permissões configurável. Evoluir para permissões granulares por
entidade/ação é aditivo (uma tabela `Permissao`/`UsuarioPermissao` ao lado de
`Usuario.role`), não exige remodelar o que já existe. Autorização por rota é
responsabilidade da camada de aplicação, não do schema. `Usuario.senhaHash`
guarda só o hash — a implementação do hashing (bcrypt) e das rotas de login
ficam para a fase de API.

## 6. Documentos — metadados prontos para armazenamento físico futuro

`Documento` já modela `nomeArquivo`, `mimeType`, `tamanhoBytes`,
`storageProvider`, `storageKey` e `checksumSha256`, todos nuláveis. Nenhum
armazenamento físico foi implementado nesta fase — os campos existem para que
a integração futura (local, S3, etc.) seja apenas preencher essas colunas em
vez de exigir uma nova migration.

## 7. Índices importantes

- Toda FK tem índice.
- `(quadraId, numero)` único em `Lote`; `(condominioId, codigo)` único em
  `Quadra`.
- `(entidade, entidadeId)` em `AuditLog`.
- Índices únicos parciais (`WHERE data_fim IS NULL`) em
  `ObraStatusHistorico` e `LoteOcupacaoHistorico`, garantindo no máximo um
  registro vigente por Obra/Lote — expressos na migration SQL manual, já que
  Prisma Schema não tem índice único parcial nesta versão.

## 8. Constraints importantes

- `LoteApoio.loteEmObraId <> LoteApoio.loteApoioId` — `CHECK` manual.
- Em `Anotacao` e `Documento`: exatamente um entre `loteId`/`obraId` — `CHECK`
  manual.
- `Pessoa.documento` e `PessoaDadosProfissionais.registroProfissional`
  únicos quando preenchidos (nuláveis — nem todo registro tem esse dado na
  origem).
- `Usuario.email` único.
- Toda FK obrigatória usa `ON DELETE RESTRICT` — deletar um `Lote` com
  `Obra`s associadas falha explicitamente, não cascateia.

## 9. Nota sobre geração do Prisma Client neste ambiente

O ambiente de build usado para montar este repositório não tem acesso de
rede a `binaries.prisma.sh` (fora da allowlist), de onde `prisma generate`/
`prisma migrate dev` baixam o engine. Por isso, nesta fase também:

- a migration em `prisma/migrations/20260826140000_init_fase5/` foi escrita
  manualmente (SQL equivalente ao que o Prisma Migrate geraria a partir do
  `schema.prisma`) e **aplicada de fato** contra um Postgres real, inclusive
  validada do zero em um banco novo, antes de ser aceita;
- `prisma/seed.ts` usa `pg` cru pelo mesmo motivo;
- em qualquer ambiente com rede irrestrita, `npx prisma generate` deve
  funcionar normalmente, e `src/lib/db.ts` pode ser trocado para usar
  `@prisma/client` — essa troca fica isolada nesse único arquivo.
- **Reinício do histórico de migrations:** as migrations das fases
  anteriores (que criavam e depois removiam o módulo de notificação, e que
  tinham o modelo antigo de `StatusLote`/`ResponsavelTecnico`) foram
  descartadas em favor de uma migration `init` única para a Fase 5, já que
  não há ambiente externo dependendo desse histórico e o modelo mudou
  estruturalmente o suficiente para justificar recomeçar.
