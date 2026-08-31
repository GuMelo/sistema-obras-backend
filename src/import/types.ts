/**
 * Tipos do pipeline de importação da planilha "CONTROLE E GESTÃO - OBRAS E
 * PROJETOS". Fora de escopo: qualquer coisa relacionada à planilha de
 * notificações — não existe (e não deve existir) nenhum tipo para isso aqui.
 *
 * Pipeline: Excel -> Parser -> RawData -> Validation -> Normalization ->
 * Mapping -> Domain -> Persistence. Cada seta é uma fronteira de tipo neste
 * arquivo, o que é o que torna possível testar cada estágio isoladamente,
 * sem banco e sem arquivo real.
 */

// ------------------------------------------------------------------
// Severidade de um problema encontrado durante a importação.
// ERRO: a linha (ou o arquivo) não pode ser processada com segurança.
// AVISO: a linha é processada, mas algo precisa de revisão humana — nenhuma
//        correspondência foi inventada, o dado original fica preservado.
// ------------------------------------------------------------------
export type Severidade = "ERRO" | "AVISO";

export interface ProblemaImportacao {
  severidade: Severidade;
  codigo: string; // ex.: "STATUS_DESCONHECIDO", "QUADRA_AUSENTE"
  mensagem: string;
  linha?: number; // número da linha na planilha (1-based, contando cabeçalho)
  dadosOriginais?: string;
}

// ------------------------------------------------------------------
// RAW DATA — exatamente o que veio da célula, com o mínimo de interpretação
// (apenas o necessário para separar colunas). Nenhuma validação de negócio
// acontece aqui — só extração posicional.
// ------------------------------------------------------------------
export interface RawLoteRow {
  linha: number; // linha física na planilha, para rastreabilidade em erros
  quadra: unknown;
  lote: unknown;
  m2: unknown;
  endereco: unknown;
  proprietario: unknown;
  arquitetoEngenheiro: unknown;
  status: unknown;
  loteApoio: unknown;
  dataLiberacaoObra: unknown;
  vistoriaPosObra: unknown;
  liberadoParaMudanca: unknown;
  dataMudanca: unknown;
  observacoes: unknown;
}

export interface RawWorkbookResult {
  arquivo: string;
  abaEncontrada: boolean;
  colunasEncontradas: string[];
  colunasFaltantes: string[];
  linhas: RawLoteRow[];
  problemas: ProblemaImportacao[]; // problemas de arquivo/aba/coluna (nível arquivo)
}

// ------------------------------------------------------------------
// VALIDATION — RawLoteRow tipado e checado, mas ainda com valores "crus"
// (string vinda da planilha, Date do Excel, etc.) — só garante que o tipo
// básico está correto e sinaliza duplicatas/incompletude.
// ------------------------------------------------------------------
export interface ValidatedLoteRow {
  linha: number;
  valido: boolean; // false = linha será ignorada na persistência (ERRO bloqueante)
  quadraCodigo: string | null;
  loteNumero: number | null;
  m2: number | null;
  endereco: string | null;
  proprietarioBruto: string | null;
  arquitetoEngenheiroBruto: string | null;
  statusBruto: string | null;
  loteApoioBruto: string | null;
  dataLiberacaoObra: Date | null;
  vistoriaPosObra: Date | null;
  liberadoParaMudanca: boolean | null;
  dataMudanca: Date | null;
  observacoesBruto: string | null;
  problemas: ProblemaImportacao[];
}

// ------------------------------------------------------------------
// NORMALIZATION — strings limpas (trim, espaços colapsados), nomes de
// pessoa separados quando isso é seguro fazer, códigos de lote de apoio
// resolvidos quando reconhecíveis. Nada de banco aqui ainda.
// ------------------------------------------------------------------
export interface PessoaNormalizada {
  nome: string;
  tipoProfissionalSugerido: "ARQUITETO" | "ENGENHEIRO" | null;
}

export interface LoteApoioReferenciaNormalizada {
  quadraCodigo: string;
  loteNumero: number;
}

export interface NormalizedLoteRow {
  linha: number;
  quadraCodigo: string;
  loteNumero: number;
  m2: number | null;
  endereco: string | null;
  proprietarios: PessoaNormalizada[]; // vazio se não separável com segurança
  proprietarioNaoSeparado: string | null; // preenchido quando não foi seguro separar
  responsaveisTecnicos: PessoaNormalizada[];
  responsavelTecnicoNaoSeparado: string | null;
  statusBruto: string | null;
  loteApoioResolvidos: LoteApoioReferenciaNormalizada[];
  loteApoioNaoResolvidos: string[]; // tokens que não bateram no padrão QUADRA+LOTE
  dataLiberacaoObra: Date | null;
  vistoriaPosObra: Date | null;
  liberadoParaMudanca: boolean;
  dataMudanca: Date | null;
  observacoesBruto: string | null;
  problemas: ProblemaImportacao[];
}

// ------------------------------------------------------------------
// MAPPING — decide o que o valor de STATUS significa no domínio (Obra,
// OcupacaoLote ou Lote.emAlerta), consultando o catálogo de mapeamento
// legado (dependência externa, injetada — não é IO direto de banco aqui).
// ------------------------------------------------------------------
export type StatusMapeadoTipo =
  | "OBRA_STATUS" // vira ObraStatusHistorico
  | "OCUPACAO_MORADOR" // vira LoteOcupacaoHistorico
  | "ALERTA" // vira Lote.emAlerta = true
  | "VAZIO" // sem valor — nada é inferido
  | "DESCONHECIDO"; // valor não vazio e não mapeado — AVISO, nada é inferido

export interface StatusMapeado {
  tipo: StatusMapeadoTipo;
  statusObraCodigo: string | null; // preenchido só quando tipo === "OBRA_STATUS"
}

export interface MappedLoteRow extends NormalizedLoteRow {
  statusMapeado: StatusMapeado;
}

// Catálogo de mapeamento legado carregado do banco antes do mapping —
// injetado para manter o mapping puro/testável sem conexão real.
export interface CatalogoStatusObra {
  /** valorOrigem normalizado (trim + collapse espaços) -> código canônico */
  porValorOrigem: Map<string, string>;
}

// ------------------------------------------------------------------
// RESULTADO da persistência de uma linha — usado para montar o relatório.
// ------------------------------------------------------------------
export type ResultadoLinha =
  | "NOVO"
  | "ATUALIZADO"
  | "SEM_ALTERACAO"
  | "IGNORADO"
  | "INVALIDO";

export interface RelatorioLinha {
  linha: number;
  quadraCodigo: string | null;
  loteNumero: number | null;
  resultado: ResultadoLinha;
  problemas: ProblemaImportacao[];
}

export interface RelatorioImportacao {
  importacaoExecucaoId: string | null; // null em dry-run que não persiste nem o registro de execução
  dryRun: boolean;
  arquivo: string;
  totalLinhasNaPlanilha: number;
  totalLinhasProcessaveis: number; // exclui linhas totalmente vazias (separadoras)
  novos: number;
  atualizados: number;
  semAlteracao: number;
  ignorados: number;
  invalidos: number;
  linhas: RelatorioLinha[];
  problemasGerais: ProblemaImportacao[]; // problemas de arquivo/aba/coluna
  totalErros: number;
  totalAvisos: number;
}

export interface OpcoesImportacao {
  caminhoArquivo: string;
  condominioId: string;
  usuarioId: string | null;
  dryRun: boolean;
}
