/** O prefixo profissional ("Arq.", "Arquiteto", "Eng.", "Engenheiro" etc.) é
 * mantido de propósito em `Pessoa.nome` — decisão explícita para refletir
 * fielmente o que está na planilha de origem (ver src/import/normalization.ts).
 * Mas nas respostas da API que já expõem o cargo de forma estruturada
 * (`papel`/`tipo`: "ARQUITETO"/"ENGENHEIRO", a partir de
 * `PessoaDadosProfissionais.tipo`), repetir o prefixo dentro do texto do nome
 * é redundante e atrapalha quem precisa só do nome — então essas respostas
 * removem o prefixo aqui, sem alterar o valor armazenado no banco.
 */
export function removerPrefixoProfissional(nome: string): string {
  return nome
    .replace(/\bARQUITET[OA](?!\w)\.?\s*/gi, "")
    .replace(/\bENGENHEIR[OA](?!\w)\.?\s*/gi, "")
    .replace(/\bARQ(?!\w)\.?\s*/gi, "")
    .replace(/\bENG(?!\w)\.?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
