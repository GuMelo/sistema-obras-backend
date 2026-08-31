/**
 * Estágio "Normalization". Função pura: recebe ValidatedLoteRow[] (apenas as
 * válidas), devolve NormalizedLoteRow[].
 *
 * Decisões conservadoras tomadas aqui, documentadas em
 * REVISAO_MODELO_DOMINIO.md e reforçadas nos comentários abaixo — nenhuma é
 * "inventada" sem justificativa:
 *
 * 1. Nomes compostos de PROPRIETÁRIO/ARQUITETO só são separados quando usam
 *    "/" como separador (padrão claro e não ambíguo nos dados). Nomes que
 *    usam " E " maiúsculo como separador (ex. "FULANO E CICLANO") NÃO são
 *    separados automaticamente, porque " E " também aparece dentro de nomes
 *    próprios e abreviações — separar por engano criaria uma Pessoa
 *    inexistente. Ficam como `proprietarioNaoSeparado`/
 *    `responsavelTecnicoNaoSeparado`, preservando o texto original, e geram
 *    um AVISO para revisão humana.
 * 2. LOTE APOIO só é resolvido quando o token bate no padrão exato de código
 *    de quadra conhecido: uma letra + dígito (ex. "H2") seguida, com ou sem
 *    espaço, de um número de lote (ex. "H2 05"). Tokens como "J02" ou "F3"
 *    NÃO são resolvidos — a convenção usada nesses casos é ambígua (não é
 *    claro se "J02" quer dizer quadra J2 lote 2, quadra J lote 02, ou outra
 *    coisa) e adivinhar seria inventar uma correspondência. Ficam em
 *    `loteApoioNaoResolvidos`, com AVISO para revisão humana.
 */
import type {
  LoteApoioReferenciaNormalizada,
  NormalizedLoteRow,
  PessoaNormalizada,
  ProblemaImportacao,
  ValidatedLoteRow,
} from "./types.js";

function colapsarEspacos(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function sugerirTipoProfissional(nome: string): "ARQUITETO" | "ENGENHEIRO" | null {
  const upper = nome.toUpperCase();
  if (/\bARQ\.?\b/.test(upper) || /\bARQUITET[OA]\b/.test(upper)) return "ARQUITETO";
  if (/\bENG\.?\b/.test(upper) || /\bENGENHEIR[OA]\b/.test(upper)) return "ENGENHEIRO";
  return null;
}

/**
 * Separa nomes compostos apenas por "/", que é o único separador observado
 * nos dados sem ambiguidade real. Retorna null (não separado) se o texto
 * contiver o padrão " E " maiúsculo (conjunção ambígua) mesmo depois de
 * dividir por "/", para não persistir metade separada e metade não.
 */
function separarPessoas(
  textoOriginal: string,
  ehResponsavelTecnico: boolean
): { pessoas: PessoaNormalizada[]; naoSeparado: string | null } {
  const contemConjuncaoAmbigua = / E /.test(` ${textoOriginal} `.toUpperCase());

  if (contemConjuncaoAmbigua) {
    return { pessoas: [], naoSeparado: colapsarEspacos(textoOriginal) };
  }

  const partes = textoOriginal
    .split("/")
    .map((p) => colapsarEspacos(p))
    .filter((p) => p.length > 0);

  if (partes.length === 0) {
    return { pessoas: [], naoSeparado: colapsarEspacos(textoOriginal) };
  }

  // O prefixo profissional ("Arq.", "Arquiteto", "Eng.", "Engenheiro" etc.)
  // é mantido no nome de propósito — não é removido/normalizado. Serve só
  // para sugerir tipoProfissionalSugerido; o texto gravado é o da planilha,
  // apenas com espaços colapsados.
  const pessoas: PessoaNormalizada[] = partes.map((parte) => {
    const tipo = ehResponsavelTecnico ? sugerirTipoProfissional(parte) : null;
    const nome = colapsarEspacos(parte);
    return { nome, tipoProfissionalSugerido: tipo };
  });

  return { pessoas, naoSeparado: null };
}

// Padrão de código de quadra conhecido: uma letra + o dígito "2" literal —
// todas as quadras reais do condomínio seguem esse padrão (A2, B2, ..., V2;
// ver documento de análise de dados). Isso é deliberadamente mais estrito
// que "uma letra + um dígito qualquer": aceitar qualquer dígito faria
// "A04" ser lido como quadra "A0" (inexistente) + lote 4, inventando uma
// correspondência que não existe. Só reconhecemos o formato quando ele
// realmente aponta para uma quadra que pode existir.
//
// Exige um separador explícito (espaço ou "/") entre quadra e lote — nunca
// os dois colados sem nada no meio. Sem separador, um código como "J28" é
// estruturalmente ambíguo: pode ser quadra "J2" + lote "8" OU quadra "J2"
// (abreviada como "J") + lote "28", e não há como saber qual sem contexto
// externo. Uma versão anterior deste padrão tentava adivinhar esse segundo
// caso (formato abreviado "letra + número", sem repetir o "2" da quadra) e
// chegou a interpretar "J28" como quadra J2 lote 8 quando a intenção real
// era quadra J2 lote 28 — decisão revertida: a planilha agora sempre escreve
// o separador ("QUADRA2/LOTE", ex.: "J2/28"), então a ambiguidade não existe
// mais na origem e o código não precisa mais adivinhar.
const PADRAO_QUADRA_LOTE = /^([A-Z]2)[\s/]0*(\d{1,3})$/;

function resolverLoteApoio(textoOriginal: string): {
  resolvidos: LoteApoioReferenciaNormalizada[];
  naoResolvidos: string[];
} {
  // Vírgula é o único separador de múltiplos lotes de apoio na mesma célula
  // (ex.: "A2/4, A2/6") — convenção confirmada da planilha atual.
  const tokens = textoOriginal
    .toUpperCase()
    .split(",")
    .map((t) => colapsarEspacos(t))
    .filter((t) => t.length > 0);

  const resolvidos: LoteApoioReferenciaNormalizada[] = [];
  const naoResolvidos: string[] = [];

  for (const token of tokens) {
    const match = token.match(PADRAO_QUADRA_LOTE);
    if (match) {
      resolvidos.push({ quadraCodigo: match[1], loteNumero: Number(match[2]) });
    } else {
      naoResolvidos.push(token);
    }
  }

  return { resolvidos, naoResolvidos };
}

export function normalizarLinhas(validas: ValidatedLoteRow[]): NormalizedLoteRow[] {
  return validas
    .filter((v): v is ValidatedLoteRow & { quadraCodigo: string; loteNumero: number } =>
      Boolean(v.valido && v.quadraCodigo && v.loteNumero !== null)
    )
    .map((v) => {
      const problemas: ProblemaImportacao[] = [...v.problemas];

      let proprietarios: PessoaNormalizada[] = [];
      let proprietarioNaoSeparado: string | null = null;
      if (v.proprietarioBruto) {
        const r = separarPessoas(v.proprietarioBruto, false);
        proprietarios = r.pessoas;
        proprietarioNaoSeparado = r.naoSeparado;
        if (proprietarioNaoSeparado) {
          problemas.push({
            severidade: "AVISO",
            codigo: "PROPRIETARIO_NAO_SEPARADO",
            mensagem: `Nome de proprietário composto não separado automaticamente: "${proprietarioNaoSeparado}". Revisar manualmente.`,
            linha: v.linha,
            dadosOriginais: v.proprietarioBruto,
          });
        }
      }

      let responsaveisTecnicos: PessoaNormalizada[] = [];
      let responsavelTecnicoNaoSeparado: string | null = null;
      if (v.arquitetoEngenheiroBruto) {
        const r = separarPessoas(v.arquitetoEngenheiroBruto, true);
        responsaveisTecnicos = r.pessoas;
        responsavelTecnicoNaoSeparado = r.naoSeparado;
        if (responsavelTecnicoNaoSeparado) {
          problemas.push({
            severidade: "AVISO",
            codigo: "RESPONSAVEL_TECNICO_NAO_SEPARADO",
            mensagem: `Nome de responsável técnico composto não separado automaticamente: "${responsavelTecnicoNaoSeparado}". Revisar manualmente.`,
            linha: v.linha,
            dadosOriginais: v.arquitetoEngenheiroBruto,
          });
        }
      }

      let loteApoioResolvidos: LoteApoioReferenciaNormalizada[] = [];
      let loteApoioNaoResolvidos: string[] = [];
      if (v.loteApoioBruto) {
        const r = resolverLoteApoio(v.loteApoioBruto);
        loteApoioResolvidos = r.resolvidos;
        loteApoioNaoResolvidos = r.naoResolvidos;
        for (const token of loteApoioNaoResolvidos) {
          problemas.push({
            severidade: "AVISO",
            codigo: "LOTE_APOIO_FORMATO_NAO_RECONHECIDO",
            mensagem: `Código de lote de apoio "${token}" não reconhece o padrão QUADRA+LOTE. Revisar manualmente.`,
            linha: v.linha,
            dadosOriginais: v.loteApoioBruto,
          });
        }
      }

      if (v.statusBruto === null && v.proprietarioBruto !== null) {
        problemas.push({
          severidade: "AVISO",
          codigo: "STATUS_VAZIO_COM_PROPRIETARIO",
          mensagem:
            "Lote já tem proprietário registrado, mas nenhum status de progresso foi informado na planilha. Revisar manualmente.",
          linha: v.linha,
        });
      }

      return {
        linha: v.linha,
        quadraCodigo: v.quadraCodigo,
        loteNumero: v.loteNumero,
        m2: v.m2,
        endereco: v.endereco,
        proprietarios,
        proprietarioNaoSeparado,
        responsaveisTecnicos,
        responsavelTecnicoNaoSeparado,
        statusBruto: v.statusBruto,
        loteApoioResolvidos,
        loteApoioNaoResolvidos,
        dataLiberacaoObra: v.dataLiberacaoObra,
        vistoriaPosObra: v.vistoriaPosObra,
        liberadoParaMudanca: v.liberadoParaMudanca ?? false,
        dataMudanca: v.dataMudanca,
        observacoesBruto: v.observacoesBruto,
        problemas,
      };
    });
}
