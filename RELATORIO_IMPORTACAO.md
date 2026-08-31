# Relatório da importação — Fase 6

Resultado da importação real de
`CONTROLE_E_GESTÃO__OBRAS_E_PROJETOS_.xlsx` (aba "CONTROLE DE OBRAS E
PROJETOS") para o PostgreSQL, usando `src/import/`. Rodada 3 vezes contra o
mesmo arquivo durante o desenvolvimento — a 2ª e 3ª rodadas confirmaram
idempotência total (0 novos, 0 atualizados, 349 sem alteração).

## 1. O que foi importado

| Entidade | Registros criados |
|---|---|
| `Lote` | 349 |
| `Obra` | 259 (241 principais + reformas/segundas obras onde aplicável) |
| `Pessoa` | 528 (proprietários + responsáveis técnicos, sem duplicar quem aparece nos dois papéis) |
| `PessoaDadosProfissionais` | 178 |
| `LotePessoa` (titularidade) | 361 |
| `ObraPessoa` (responsabilidade técnica) | 253 |
| `LoteOcupacaoHistorico` (`MORADOR`) | 167 — bate exatamente com a contagem de `STATUS = MORADOR` da planilha original |
| `ObraStatusHistorico` | 90 status vigentes atribuídos |
| `LoteApoio` | 10 vínculos resolvidos com segurança (padrão `QUADRA + LOTE` reconhecível) |
| `Anotacao` (`IMPORTACAO_LEGADO`) | 186 — uma por lote com `OBSERVAÇÕES` preenchida |
| `Lote.emAlerta = true` | 1 (lote M2 12 — o único `"LOTE EM ALERTA"` da planilha) |

### Status de obra atribuídos (vigentes)

| Status canônico | Quantidade |
|---|---|
| Obra liberada | 38 |
| Projeto em análise | 21 |
| Obra finalizada — vistoriada | 13 |
| Obra finalizada | 7 |
| Obra paralisada | 6 |
| Obra liberada, sem início de execução | 2 |
| Liberada parcialmente (muro/terraplenagem) | 2 |
| Reforma em andamento | 1 |

## 2. O que foi normalizado

- As **14 grafias de status** da planilha foram resolvidas contra
  `StatusObraLegacyMap` sem nenhuma correspondência inventada: `MORADOR` →
  ocupação do lote (não status de obra); `"LOTE EM ALERTA"` → flag
  `Lote.emAlerta`; as demais → `StatusObra` canônico.
- **7 nomes de proprietário** e **16 nomes de responsável técnico** com `/`
  como separador foram divididos automaticamente em pessoas distintas (ex.:
  `"Jocasta / Leonardo Demartini"` → duas `Pessoa`).
- **10 códigos de lote de apoio** no padrão reconhecível (`QUADRA+LOTE`, ex.
  `"H2 05"`) foram resolvidos e viraram vínculos `LoteApoio` de verdade.

## 3. O que foi ignorado (e por quê — nada foi descartado de fato)

Nada foi descartado silenciosamente. O que a interpretação automática não
resolveu ficou preservado, não apagado:

- **65 lotes** têm `Lote.observacaoLegado` preenchida — texto bruto que a
  importação não pôde interpretar com segurança (nome composto, status
  desconhecido ou código de apoio não reconhecido).
- **46 códigos de lote de apoio** em formato ambíguo (`"J02"`, `"F3"`,
  `"B11"`) não foram resolvidos — o padrão não deixa claro se é quadra+lote
  ou outra convenção. Preservados como texto em `observacaoLegado`.
- **1 status** (`"SITUAÇÃO INEXISTENTE..."`, em teste; nenhum na planilha
  real ficou fora do mapeamento) — o mecanismo de `STATUS_DESCONHECIDO`
  existe e foi testado, mas na planilha real as 14 grafias já conhecidas
  cobriram 100% dos valores não vazios encontrados.
- **`ENDEREÇO`**: importado quando presente (6,8% dos lotes, como já
  esperado — o endereço "de verdade" mora na aba auxiliar
  `Quadra e Lote VERSUS Endereço`, fora do escopo desta fase).

## 4. O que precisa de revisão manual

| Item | Quantidade | Onde consultar |
|---|---|---|
| Lotes com proprietário mas status vazio na origem | 76 | `Lote.observacaoLegado` |
| Códigos de lote de apoio não resolvidos | 46 | `Lote.observacaoLegado` + `ImportacaoErro` |
| Nomes de responsável técnico com conjunção ambígua (`" E "`) | 16 | `Lote.observacaoLegado` |
| Nomes de proprietário com conjunção ambígua (`" E "`) | 7 | `Lote.observacaoLegado` |
| Pessoas quase-duplicadas (grafia com/sem acento) | 2 pares | ver abaixo |

**Os 2 pares de pessoa quase-duplicada, não fundidos automaticamente
(conforme decisão de não fazer merge quando há dúvida):**
- `"ALMIR ROGERIO AUGUSTO"` vs `"ALMIR ROGÉRIO AUGUSTO"`
- `"NILTON CESAR DA SILVA"` (2 grafias sem acento) vs `"Nilton César da Silva"`

Cada execução (`ImportacaoExecucao`) tem todos os avisos detalhados em
`ImportacaoErro`, consultáveis por linha da planilha de origem.
