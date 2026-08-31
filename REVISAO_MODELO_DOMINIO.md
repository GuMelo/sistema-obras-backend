# Revisão definitiva do modelo de domínio — Controle de Obras e Projetos

Este documento substitui as revisões anteriores como referência principal.
Ele reexamina o modelo do zero — inclusive questionando decisões que eu
mesmo tinha proposto antes — e é baseado em consultas diretas aos dados reais
da planilha, não em suposição. Onde os dados me fizeram mudar de ideia em
relação à proposta anterior, isso está marcado explicitamente como
**correção**, não escondido.

**Nenhuma alteração de código foi feita ainda.** Este é o documento de
análise pedido antes de qualquer implementação.

---

## 1. Modelo de domínio proposto (visão geral)

A mudança mais importante desta revisão: **a coluna `STATUS` da planilha
mistura duas dimensões independentes que hoje um único enum não consegue
representar sem perda de informação.** Isso ficou evidente ao cruzar `STATUS`
com outros campos (seção 5 tem os números). Por isso, o modelo deixa de ter
"o status do lote" como um conceito monolítico e passa a separar:

1. **Ciclo de vida do projeto de construção** (Obra) — em análise, liberada,
   paralisada, finalizada, vistoriada.
2. **Ocupação do lote** (Lote) — se há morador de fato ou não.
3. **Sinalizador administrativo independente** (Lote) — "em alerta", que pode
   coexistir com qualquer uma das duas dimensões acima.

Isso não é uma preferência estética — é a única forma de representar, por
exemplo, um lote que já tem morador (`MORADOR`) e que ao mesmo tempo está
executando uma reforma (`CASA EM REFORMA`), situação que **acontece de fato
nos dados** (seção 5.3).

---

## 2. Entidades — quais são realmente necessárias

| Entidade | Necessária? | Mudança em relação à proposta anterior |
|---|---|---|
| Condomínio | Sim | Mantida |
| Quadra | Sim | Mantida |
| Lote | Sim | Núcleo do modelo — mantido |
| **Pessoa** | Sim | **Passa a ser a única entidade de pessoa física/jurídica do sistema** — ver seção 6 |
| ~~ResponsávelTécnico~~ | **Proposto remover como tabela separada** | Vira um papel de `Pessoa`, não uma entidade própria — ver seção 6 |
| Obra | Sim | Mantida, mas o vínculo com Lote é reforçado como hipótese, não fato dos dados — ver seção 4 |
| StatusObra + histórico | Sim | Mantida — é aqui que a máquina de estados "real" vive |
| **StatusLote como catálogo de 11 valores** | **Proposto substituir** | Os dados não sustentam 11 estados de *lote* — a maioria dos 14 valores é estado de *obra*, não de lote. Ver seção 5 |
| Ocupação do lote (novo conceito) | Sim, mas mais simples | Enum fechado de 2 valores (`DISPONIVEL`/`MORADOR`), não uma tabela de catálogo completa |
| Alerta do lote (novo conceito) | Sim | Flag booleana + histórico simples, **não** um valor dentro do enum de status |
| LoteApoio | Sim | Mantida sem alteração |
| Anotação | Sim | Mantida, ligada a Lote ou Obra |
| Documento | Sim | Mantida, ligada a Lote ou Obra |
| Usuário | Sim | Mantida |
| AuditLog | Sim | Mantida |
| ImportacaoExecucao / ImportacaoErro | Sim | Mantida |

---

## 3. Relacionamentos e cardinalidades

```
Condominio (1) ──< (N) Quadra (1) ──< (N) Lote

Lote (1) ──< (N) Obra                         [ver seção 4 — hipótese, não fato dos dados]
Lote (1) ──< (N) LoteOcupacaoHistorico
Lote (1) ──< (N) LoteAlertaHistorico (ou AuditLog genérico — ver seção 5.4)
Lote (N) ──< LoteApoio >── (N) Lote            [auto-relação, papéis distintos]
Lote (1) ──< (N) Anotacao
Lote (1) ──< (N) Documento

Obra (1) ──< (N) ObraStatusHistorico
Obra (1) ──< (N) Anotacao
Obra (1) ──< (N) Documento
Obra (N) ──< ObraPessoa >── (N) Pessoa         [papel = RESPONSAVEL_TECNICO, e outros se necessário]

Lote (N) ──< LotePessoa >── (N) Pessoa         [papel = TITULAR / COTITULAR]

Usuario (1) ──< (N) LoteOcupacaoHistorico (quem alterou)
Usuario (1) ──< (N) ObraStatusHistorico (quem alterou)
Usuario (1) ──< (N) AuditLog
Usuario (1) ──< (N) ImportacaoExecucao
```

Nenhuma cardinalidade acima é "1:1" — inclusive `Lote`↔`Obra` é `1:N`
propositalmente, pelo motivo explicado a seguir.

---

## 4. Lote × Obra — análise específica pedida

**O que os dados mostram, literalmente:** cada linha da planilha é um lote, e
cada lote tem exatamente **um** conjunto de colunas de obra (`DATA DE
LIBERAÇÃO DA OBRA`, `VISTORIA PÓS OBRA`, `LIBERADO PARA MUDANÇA?`, `DATA DA
MUDANÇA`). A planilha, estruturalmente, **não tem como representar duas obras
para o mesmo lote simultaneamente** — não existe grupo de colunas repetido,
nem uma segunda linha por lote. Confirmei antes que não há nenhuma duplicata
de `QUADRA`+`LOTE`.

**Portanto, a afirmação "um lote pode ter mais de uma obra ao longo do
tempo" não é um fato observável na estrutura atual da planilha — é uma
hipótese de negócio.** Documento por que acho que ela é razoável mesmo assim:

- 5 lotes com `STATUS = MORADOR` têm, no campo `OBSERVAÇÕES`, menções
  textuais explícitas a uma reforma acontecendo **depois** de o morador já
  estar instalado (ex.: lote N2 23 — *"Novos proprietários já realizaram a
  mudança e estão em reforma"*; lote U2 01 — *"o novo proprietário [...]
  comunicando a reforma que está realizando"*). Isso é evidência **textual**,
  não estrutural, de um segundo ciclo de obra sobre o mesmo lote.
- O próprio valor de status `CASA EM REFORMA` só faz sentido como um segundo
  projeto se o lote já passou por construção inicial — não é a primeira obra
  do lote.

**Decisão proposta, com a hipótese explícita:** modelar `Lote (1) ──< (N)
Obra`, permitindo múltiplas obras por lote ao longo do tempo (construção
inicial, depois reforma), **mas reconhecendo que a planilha atual só
alimenta uma Obra "corrente" por lote na importação inicial**. Uma segunda
`Obra` (reforma) só passaria a existir no sistema a partir do momento em que
alguém a registrar manualmente — a importação da planilha, sozinha, não cria
histórico de obras anteriores, porque esse histórico não existe de forma
estruturada na fonte.

**Onde fica o histórico:** dividido, e a divisão é a resposta à pergunta "os
status pertencem ao lote ou à obra":

- **Na Obra**: o ciclo de vida da construção em si (em análise → liberada →
  paralisada/finalizada → vistoriada). Cada Obra tem seu próprio histórico.
- **No Lote**: só a ocupação (disponível ↔ morador) e o alerta administrativo
  — que são propriedades do lote, sobrevivem a qualquer obra específica, e
  **não resetam** quando uma nova Obra (reforma) começa. É exatamente por
  isso que um lote pode estar `MORADOR` com uma `Obra` de reforma
  simultaneamente `LIBERADA` — são dois relógios diferentes, e essa distinção
  só é possível porque status de obra não vive dentro do lote.

---

## 5. Status — análise específica

### 5.1 Os 14 valores brutos, agora classificados por dimensão real

| Valor bruto | Dimensão | Motivo da classificação |
|---|---|---|
| `EM ANÁLISE` / `EM ANALISE` | **Obra** | Projeto ainda não aprovado — não é sobre o lote em si |
| `LIBERADO MURO E TERRAPLANAGEM` | **Obra** (liberação parcial) | Autorização restrita a uma etapa da obra |
| `OBRA LIBERADA` / `OBRA LIBERADA ` | **Obra** | Autorização total de construção |
| `OBRA LIBERADA NÃO INICIADA` / `OBRA LIBERADA E NÃO INICIADA` | **Obra** (variação de "liberada") | Mesma fase de "liberada", com uma observação operacional de que nada começou ainda |
| `OBRA PARALISADA` | **Obra** | Interrupção do andamento |
| `OBRA FINALIZADA` | **Obra** | Construção concluída |
| `OBRA FINALIZADA VISTORIA OK` | **Obra** (estágio seguinte de "finalizada") | Concluída **e** conferida |
| `CASA EM REFORMA` | **Obra** (de um *segundo* ciclo) | Ver seção 4 — não é estado do lote, é uma obra de reforma em andamento sobre um lote que já tem morador |
| `MORADOR` | **Lote** (ocupação) | Ver seção 5.2 — é sobre quem usa o lote, não sobre a obra |
| `LOTE EM ALERTA` | **Lote**, mas como atributo, não como status de progressão | Ver seção 5.4 |
| *(vazio/NaN)* | Ambíguo — ver seção 5.3 | **Não pode ser tratado automaticamente como "disponível"** |

**Correção em relação à minha proposta anterior:** eu tinha incluído um
valor `DISPONIVEL` mapeado do texto `"0"` como se fizesse parte deste
catálogo de 14 grafias. Ao reconferir agora, **`"0"` não existe na coluna
`STATUS` da aba `CONTROLE DE OBRAS E PROJETOS`** (a aba que é a fonte deste
sistema) — esse valor está na aba auxiliar `Quadra e Lote VERSUS Endereço`,
que é uma tabela de apoio, não a fonte primária. Nesta aba principal, "sem
progresso registrado" é simplesmente uma célula vazia (109 linhas), e a
seção 5.3 mostra por que isso **não** pode ser tratado como sinônimo de
"lote disponível".

### 5.2 Por que `MORADOR` é ocupação, e por que a suposição "morador = data de mudança preenchida" está errada

Cruzei `STATUS = MORADOR` com `DATA DA MUDANÇA`: dos 167 lotes com esse
status, **apenas 18 (10,8%) têm a data de mudança preenchida.** Isso derruba
uma hipótese que eu ia propor (derivar a ocupação automaticamente a partir de
`LIBERADO PARA MUDANÇA? = SIM` + `DATA DA MUDANÇA` preenchida) — os dados
mostram que isso não reflete a prática real de preenchimento. `MORADOR` é,
na prática, um valor lançado independentemente por quem mantém a planilha,
não algo que pode ser inferido com segurança de outros campos.

**Decisão:** `Lote.ocupacao` deve ser um campo com valor **explícito**,
alterado manualmente (com histórico), não um campo calculado a partir de
outras datas.

### 5.3 O problema do status vazio (109 lotes) — não é "disponível"

Cruzei também `STATUS` vazio com `PROPRIETÁRIO` preenchido: **76 dos 109
lotes sem status registrado já têm proprietário.** Ou seja, mais de dois
terços dos lotes "sem status" já foram vendidos — eles não são lotes vazios
esperando comprador, são lotes que **passaram batido pelo processo de
atualização de status** em algum momento. Só os outros 33 (sem proprietário
e sem status) são de fato lotes genuinamente disponíveis.

**Isso é uma inconsistência operacional real da planilha, não um status a
ser modelado.** A recomendação é: a importação **não** deve inferir
"disponível" para status vazio. Ela deve marcar esses 109 registros com uma
observação de importação (`observacao_legado` / linha em `ImportacaoErro`
como aviso, não erro bloqueante) sinalizando "status não informado na
origem — revisar", deixando para um analista humano decidir se cada um é
"disponível" ou "morador não registrado" ou outra coisa.

### 5.4 `LOTE EM ALERTA` — por que não deveria ser um valor de status

Só ocorre 1 vez nos dados, mas o problema é conceitual, não de frequência:
um alerta é algo que pode acontecer **em paralelo** a qualquer fase da obra
ou da ocupação — um lote `MORADOR` pode estar em alerta, um lote com `OBRA
PARALISADA` pode estar em alerta. Se `LOTE_EM_ALERTA` for só mais um valor
dentro do mesmo enum de status, ele **substitui** a informação de fase em
vez de se somar a ela — perde-se "paralisada" quando alguém marca "em
alerta". Por isso a proposta trata isso como `Lote.emAlerta: boolean`,
independente do status de obra e de ocupação.

### 5.5 Proposta de catálogo canônico (revisada)

**StatusObra** (catálogo completo, com histórico e mapeamento legado — é aqui
que a complexidade real está):

| Código canônico | Grafias legadas absorvidas |
|---|---|
| `EM_ANALISE` | `EM ANÁLISE`, `EM ANALISE` |
| `LIBERADA_PARCIAL_MURO_TERRAPLANAGEM` | `LIBERADO MURO E TERRAPLANAGEM` |
| `LIBERADA` | `OBRA LIBERADA`, `OBRA LIBERADA ` |
| `LIBERADA_NAO_INICIADA` | `OBRA LIBERADA NÃO INICIADA`, `OBRA LIBERADA E NÃO INICIADA` |
| `PARALISADA` | `OBRA PARALISADA` |
| `FINALIZADA` | `OBRA FINALIZADA` |
| `FINALIZADA_VISTORIADA` | `OBRA FINALIZADA VISTORIA OK` |
| `REFORMA_EM_ANDAMENTO` | `CASA EM REFORMA` (aplicado a uma **segunda** Obra, tipo `REFORMA`, do mesmo lote — não à obra original) |

**Ocupação do Lote** (enum simples, sem tabela de catálogo — só 2 valores
fechados e sem sinal de que vão crescer):

| Valor | Origem |
|---|---|
| `DISPONIVEL` | Ausência de proprietário — **não** inferido de status vazio (seção 5.3) |
| `MORADOR` | `STATUS = MORADOR` na planilha |

**Alerta do Lote:** `emAlerta: boolean`, `default false`. Quando havia
`LOTE EM ALERTA` na origem, a importação liga essa flag e registra a
observação original em `observacao_legado`.

**Nada disso descarta o texto original** — cada linha da planilha tem seu
`STATUS` bruto preservado em `observacao_legado` do registro de origem (ou
na tabela de mapeamento legado, no caso de `StatusObra`), então é sempre
possível recuperar exatamente o que estava escrito antes da normalização.

---

## 6. Pessoa × ResponsávelTécnico — proposta de fusão

**Pergunta feita: devem ser entidades distintas ou papéis de uma entidade
comum?** Proponho **papéis de uma entidade comum**, por um motivo concreto,
não só elegância: nada nos dados garante que um arquiteto/engenheiro nunca
seja também proprietário de um lote no mesmo condomínio (é uma coincidência
plausível, e mantê-los em tabelas separadas garante que o sistema **nunca
vai perceber** se isso acontecer — cada nome vira um cadastro novo,
duplicado, em uma tabela diferente).

**Modelo proposto:**
- `Pessoa` — única tabela para qualquer pessoa física ou jurídica que
  apareça no domínio: `nome`, `tipoPessoa`, `documento`, `telefone`, `email`.
- `LotePessoa` — papel de **titularidade** (`TITULAR`/`COTITULAR`) ligando
  `Pessoa` a `Lote`.
- `ObraPessoa` — papel de **responsabilidade técnica** ligando `Pessoa` a
  `Obra` (não ao Lote diretamente — porque o profissional responsável é por
  projeto, e cada Obra pode ter um profissional diferente, inclusive numa
  reforma anos depois).
- Dados exclusivos de quem atua como responsável técnico (registro
  profissional CAU/CREA, tipo arquiteto/engenheiro) ficam numa extensão
  opcional `PessoaDadosProfissionais` (1:1 com `Pessoa`, só existe para quem
  já atuou nesse papel) — em vez de poluir `Pessoa` com colunas que só fazem
  sentido para uma fração dos registros.

**Isso é uma mudança estrutural em relação ao que eu tinha implementado**
(que tinha `ResponsavelTecnico` como tabela própria). Não vou aplicar isso
sem confirmação, porque significa reescrever migrations já aplicadas e o
seed. Ver seção 8.

---

## 7. Campos importantes — o que cada um vira, e por que nada é descartado

| Campo na planilha | Destino no modelo | Por que não descarto |
|---|---|---|
| `QUADRA`, `LOTE` | `Quadra.codigo` + `Lote.numero` | Chave de negócio, já validada sem duplicatas |
| `M2` | `Lote.areaM2` | Atributo direto, sem ambiguidade |
| `ENDEREÇO` | `Lote.enderecoLogradouro`/`enderecoNumero` | Preenchido em só 6,8% das linhas nesta aba — ver observação abaixo |
| `PROPRIETÁRIO` | `Pessoa` + `LotePessoa` (papel TITULAR) | Nomes compostos viram múltiplos vínculos quando identificáveis com segurança; quando não, o texto bruto fica em `Lote.observacaoLegado` (não é descartado, só não é decomposto automaticamente) |
| `ARQUITETO / ENGENHEIRO` | `Pessoa` + `ObraPessoa` (papel RESPONSAVEL_TECNICO) | Mesma lógica — nomes compostos/incompletos ficam preservados como texto bruto quando não puderem ser separados com segurança |
| `STATUS` | `StatusObra` (histórico) + `Lote.ocupacao` + `Lote.emAlerta`, conforme seção 5 | Nenhum valor é jogado fora — o texto original fica no mapeamento legado |
| `LOTE APOIO` | `LoteApoio` (auto-relação) | Mantido — texto livre com múltiplos códigos vira múltiplas linhas na tabela associativa |
| `DATA DE LIBERAÇÃO DA OBRA` | `Obra.dataLiberacao` | Direto |
| `VISTORIA PÓS OBRA` | `Obra.dataVistoriaPosObra` | Direto |
| `LIBERADO PARA MUDANÇA?` | `Obra.liberadoParaMudanca` (boolean) | Mantido — mas **não** usado para derivar `Lote.ocupacao` (seção 5.2) |
| `DATA DA MUDANÇA` | `Obra.dataMudanca` | Mantido pelo mesmo motivo — é dado relevante mesmo não sendo confiável como gatilho de ocupação |
| `OBSERVAÇÕES` | `Anotacao` (uma anotação "legada" por lote na importação, com `origem = IMPORTACAO_LEGADO`) | O texto corrido não é quebrado em eventos automaticamente — fica como uma anotação única, disponível para consulta, sem inventar datas que o texto não deixa claras o suficiente para separar com segurança |

**Nota sobre `ENDEREÇO`:** como já registrado na análise de dados original,
o endereço "de verdade" está majoritariamente na aba `Quadra e Lote VERSUS
Endereço`, não nesta aba. Como esta revisão foi pedida "exclusivamente"
sobre a aba `CONTROLE DE OBRAS E PROJETOS`, mantenho os campos de endereço no
`Lote`, mas a importação **desta aba isoladamente** vai deixá-los vazios na
maioria dos casos — isso é esperado, não é perda de dado.

---

## 8. Pontos ainda ambíguos (preciso de confirmação antes de codificar)

1. **Fusão Pessoa/ResponsávelTécnico (seção 6)** — é uma mudança estrutural
   real sobre o que já está implementado. Confirmar se quer que eu aplique.
2. **`LIBERADA_PARCIAL_MURO_TERRAPLANAGEM` como status próprio vs. atributo**
   — alternativa: manter só `LIBERADA` + um campo `Obra.escopoLiberacao`
   (`TOTAL`/`MURO_TERRAPLANAGEM`). Ambas as opções preservam a informação;
   a diferença é só onde ela mora. Qual prefere?
3. **`LIBERADA_NAO_INICIADA` como status próprio vs. derivado** — hoje
   proponho manter como valor canônico próprio (preserva a intenção de quem
   preencheu a planilha), mas poderia ser calculado (liberada + nenhum outro
   sinal de progresso). Confirmar preferência.
4. **Os 109 lotes com `STATUS` vazio (76 já com proprietário)** — confirmar
   se a estratégia de "marcar para revisão humana em vez de inferir
   disponível" é aceitável, ou se existe uma regra de negócio que eu não
   conheço para decidir isso automaticamente.
5. **`Lote.emAlerta`: histórico próprio ou só `AuditLog` genérico?** —
   como só há 1 ocorrência nos dados, não sei se este vai ser um recurso
   usado com frequência suficiente para justificar uma tabela de histórico
   dedicada. Minha recomendação é começar só com `AuditLog` e promover para
   tabela própria se o uso justificar depois.
6. **`Lote (1) ──< (N) Obra` é hipótese, não fato dos dados (seção 4)** —
   preciso de confirmação de que reformas devem mesmo virar uma nova `Obra`,
   e não, por exemplo, um novo `ObraStatusHistorico` na mesma Obra original
   (o que seria mais simples, mas perderia a noção de "projeto novo" com seu
   próprio responsável técnico e datas).

---

## 9. O que eu **não** mudaria

Para deixar claro o que já está bom e não precisa de retrabalho:
Condomínio, Quadra, Lote (como entidade central), LoteApoio, Anotação,
Documento, Usuário, AuditLog e ImportacaoExecucao/ImportacaoErro se mantêm
exatamente como estavam — nenhuma das reconsiderações desta revisão afeta
essas tabelas.
