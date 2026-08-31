-- sistema-obras-backend — migration inicial da Fase 5.
-- Escrita manualmente (equivalente ao que `prisma migrate dev` geraria a
-- partir de prisma/schema.prisma) porque este ambiente de build não tem
-- acesso de rede a binaries.prisma.sh — ver DOMAIN_MODEL.md, seção "Nota
-- sobre geração do Prisma Client neste ambiente".
--
-- Decisão de processo: o histórico de migrations das fases anteriores
-- (init + remoção de notificações, feitos ainda em fase de exploração do
-- modelo) foi descartado nesta migration única, porque a Fase 5 implementa
-- o modelo definitivamente aprovado, estruturalmente diferente do anterior
-- (fusão Pessoa/ResponsávelTécnico, remoção do catálogo StatusLote antigo,
-- introdução de OcupacaoLote/emAlerta). Não há ambiente externo dependendo
-- do histórico anterior — é seguro reiniciar a partir daqui.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE "RoleUsuario" AS ENUM ('ADMIN', 'ANALISTA', 'CONSULTA');
CREATE TYPE "TipoPessoa" AS ENUM ('FISICA', 'JURIDICA');
CREATE TYPE "PapelTitularidade" AS ENUM ('TITULAR', 'COTITULAR');
CREATE TYPE "PapelObraPessoa" AS ENUM ('RESPONSAVEL_TECNICO');
CREATE TYPE "TipoObra" AS ENUM ('CONSTRUCAO_INICIAL', 'REFORMA');
CREATE TYPE "OcupacaoLote" AS ENUM ('DISPONIVEL', 'MORADOR');
CREATE TYPE "TipoDocumento" AS ENUM ('FOTO', 'PDF', 'OUTRO');
CREATE TYPE "OrigemAnotacao" AS ENUM ('MANUAL', 'IMPORTACAO_LEGADO');
CREATE TYPE "StatusImportacao" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDA', 'CONCLUIDA_COM_ERROS', 'FALHOU');

-- ============================================================
-- USUARIOS / AUDITORIA / IMPORTACAO
-- ============================================================
CREATE TABLE "usuarios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "senha_hash" TEXT NOT NULL,
  "role" "RoleUsuario" NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entidade" TEXT NOT NULL,
  "entidade_id" UUID NOT NULL,
  "acao" TEXT NOT NULL,
  "campo_alterado" TEXT,
  "valor_anterior" TEXT,
  "valor_novo" TEXT,
  "usuario_id" UUID,
  "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "observacao" TEXT,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_entidade_entidade_id_idx" ON "audit_logs"("entidade", "entidade_id");
CREATE INDEX "audit_logs_usuario_id_idx" ON "audit_logs"("usuario_id");
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "importacao_execucoes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "origem" TEXT NOT NULL,
  "status" "StatusImportacao" NOT NULL DEFAULT 'EM_ANDAMENTO',
  "total_linhas" INTEGER,
  "linhas_com_sucesso" INTEGER,
  "linhas_com_erro" INTEGER,
  "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizado_em" TIMESTAMP(3),
  "usuario_id" UUID,
  CONSTRAINT "importacao_execucoes_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "importacao_execucoes" ADD CONSTRAINT "importacao_execucoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "importacao_erros" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "importacao_id" UUID NOT NULL,
  "linha" INTEGER,
  "mensagem" TEXT NOT NULL,
  "dados_originais" TEXT,
  CONSTRAINT "importacao_erros_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "importacao_erros_importacao_id_idx" ON "importacao_erros"("importacao_id");
ALTER TABLE "importacao_erros" ADD CONSTRAINT "importacao_erros_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacao_execucoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- CONDOMINIO / QUADRA / LOTE
-- ============================================================
CREATE TABLE "condominios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,
  "cnpj" TEXT,
  "endereco" TEXT,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "condominios_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "condominios_nome_key" ON "condominios"("nome");

CREATE TABLE "quadras" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "condominio_id" UUID NOT NULL,
  "codigo" TEXT NOT NULL,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quadras_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quadras_condominio_id_codigo_key" ON "quadras"("condominio_id", "codigo");
CREATE INDEX "quadras_condominio_id_idx" ON "quadras"("condominio_id");
ALTER TABLE "quadras" ADD CONSTRAINT "quadras_condominio_id_fkey" FOREIGN KEY ("condominio_id") REFERENCES "condominios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lotes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quadra_id" UUID NOT NULL,
  "numero" INTEGER NOT NULL,
  "area_m2" DECIMAL(10,2),
  "endereco_logradouro" TEXT,
  "endereco_numero" TEXT,
  "em_alerta" BOOLEAN NOT NULL DEFAULT false,
  "observacao_legado" TEXT,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lotes_quadra_id_numero_key" ON "lotes"("quadra_id", "numero");
CREATE INDEX "lotes_quadra_id_idx" ON "lotes"("quadra_id");
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_quadra_id_fkey" FOREIGN KEY ("quadra_id") REFERENCES "quadras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- OCUPACAO DO LOTE (historico)
-- ============================================================
CREATE TABLE "lote_ocupacao_historico" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lote_id" UUID NOT NULL,
  "ocupacao" "OcupacaoLote" NOT NULL,
  "data_inicio" TIMESTAMP(3) NOT NULL,
  "data_fim" TIMESTAMP(3),
  "observacao" TEXT,
  "usuario_id" UUID,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lote_ocupacao_historico_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lote_ocupacao_historico_lote_id_idx" ON "lote_ocupacao_historico"("lote_id");
-- No máximo uma ocupação "vigente" (data_fim NULL) por lote:
CREATE UNIQUE INDEX "lote_ocupacao_historico_vigente_uidx" ON "lote_ocupacao_historico"("lote_id") WHERE "data_fim" IS NULL;
ALTER TABLE "lote_ocupacao_historico" ADD CONSTRAINT "lote_ocupacao_historico_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lote_ocupacao_historico" ADD CONSTRAINT "lote_ocupacao_historico_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lote_ocupacao_historico" ADD CONSTRAINT "lote_ocupacao_historico_datas_check" CHECK ("data_fim" IS NULL OR "data_fim" >= "data_inicio");

-- ============================================================
-- STATUS DA OBRA
-- ============================================================
CREATE TABLE "status_obra" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "codigo" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "ordem_exibicao" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "status_obra_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "status_obra_codigo_key" ON "status_obra"("codigo");

CREATE TABLE "status_obra_legacy_map" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "valor_origem" TEXT NOT NULL,
  "status_canonico_id" UUID NOT NULL,
  "observacao" TEXT,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "status_obra_legacy_map_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "status_obra_legacy_map_valor_origem_key" ON "status_obra_legacy_map"("valor_origem");
ALTER TABLE "status_obra_legacy_map" ADD CONSTRAINT "status_obra_legacy_map_status_canonico_id_fkey" FOREIGN KEY ("status_canonico_id") REFERENCES "status_obra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- PESSOA
-- ============================================================
CREATE TABLE "pessoas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,
  "tipo_pessoa" "TipoPessoa" NOT NULL,
  "documento" TEXT,
  "telefone" TEXT,
  "email" TEXT,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pessoas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pessoas_documento_key" ON "pessoas"("documento");

CREATE TABLE "pessoa_dados_profissionais" (
  "pessoa_id" UUID NOT NULL,
  "tipo" TEXT,
  "registro_profissional" TEXT,
  CONSTRAINT "pessoa_dados_profissionais_pkey" PRIMARY KEY ("pessoa_id")
);
CREATE UNIQUE INDEX "pessoa_dados_profissionais_registro_profissional_key" ON "pessoa_dados_profissionais"("registro_profissional");
ALTER TABLE "pessoa_dados_profissionais" ADD CONSTRAINT "pessoa_dados_profissionais_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lote_pessoa" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lote_id" UUID NOT NULL,
  "pessoa_id" UUID NOT NULL,
  "papel" "PapelTitularidade" NOT NULL,
  "data_inicio" TIMESTAMP(3),
  "data_fim" TIMESTAMP(3),
  CONSTRAINT "lote_pessoa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lote_pessoa_lote_id_idx" ON "lote_pessoa"("lote_id");
CREATE INDEX "lote_pessoa_pessoa_id_idx" ON "lote_pessoa"("pessoa_id");
ALTER TABLE "lote_pessoa" ADD CONSTRAINT "lote_pessoa_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lote_pessoa" ADD CONSTRAINT "lote_pessoa_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- OBRA
-- ============================================================
CREATE TABLE "obras" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lote_id" UUID NOT NULL,
  "tipo" "TipoObra",
  "data_liberacao" TIMESTAMP(3),
  "data_vistoria_pos_obra" TIMESTAMP(3),
  "liberado_para_mudanca" BOOLEAN NOT NULL DEFAULT false,
  "data_mudanca" TIMESTAMP(3),
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "obras_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "obras_lote_id_idx" ON "obras"("lote_id");
ALTER TABLE "obras" ADD CONSTRAINT "obras_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "obras" ADD CONSTRAINT "obras_datas_vistoria_check" CHECK ("data_vistoria_pos_obra" IS NULL OR "data_liberacao" IS NULL OR "data_vistoria_pos_obra" >= "data_liberacao");

CREATE TABLE "obra_status_historico" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "obra_id" UUID NOT NULL,
  "status_id" UUID NOT NULL,
  "data_inicio" TIMESTAMP(3) NOT NULL,
  "data_fim" TIMESTAMP(3),
  "observacao" TEXT,
  "usuario_id" UUID,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "obra_status_historico_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "obra_status_historico_obra_id_idx" ON "obra_status_historico"("obra_id");
CREATE INDEX "obra_status_historico_status_id_idx" ON "obra_status_historico"("status_id");
CREATE UNIQUE INDEX "obra_status_historico_vigente_uidx" ON "obra_status_historico"("obra_id") WHERE "data_fim" IS NULL;
ALTER TABLE "obra_status_historico" ADD CONSTRAINT "obra_status_historico_datas_check" CHECK ("data_fim" IS NULL OR "data_fim" >= "data_inicio");
ALTER TABLE "obra_status_historico" ADD CONSTRAINT "obra_status_historico_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "obra_status_historico" ADD CONSTRAINT "obra_status_historico_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "status_obra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "obra_status_historico" ADD CONSTRAINT "obra_status_historico_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "obra_pessoa" (
  "obra_id" UUID NOT NULL,
  "pessoa_id" UUID NOT NULL,
  "papel" "PapelObraPessoa" NOT NULL,
  CONSTRAINT "obra_pessoa_pkey" PRIMARY KEY ("obra_id", "pessoa_id", "papel")
);
ALTER TABLE "obra_pessoa" ADD CONSTRAINT "obra_pessoa_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "obra_pessoa" ADD CONSTRAINT "obra_pessoa_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- LOTE DE APOIO (auto-relacao)
-- ============================================================
CREATE TABLE "lote_apoio" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lote_em_obra_id" UUID NOT NULL,
  "lote_apoio_id" UUID NOT NULL,
  "data_autorizacao" TIMESTAMP(3),
  "data_devolucao_prevista" TIMESTAMP(3),
  "data_devolucao_efetiva" TIMESTAMP(3),
  "observacao" TEXT,
  CONSTRAINT "lote_apoio_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lote_apoio_lote_em_obra_id_idx" ON "lote_apoio"("lote_em_obra_id");
CREATE INDEX "lote_apoio_lote_apoio_id_idx" ON "lote_apoio"("lote_apoio_id");
ALTER TABLE "lote_apoio" ADD CONSTRAINT "lote_apoio_lote_em_obra_id_fkey" FOREIGN KEY ("lote_em_obra_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lote_apoio" ADD CONSTRAINT "lote_apoio_lote_apoio_id_fkey" FOREIGN KEY ("lote_apoio_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lote_apoio" ADD CONSTRAINT "lote_apoio_nao_autoreferente_check" CHECK ("lote_em_obra_id" <> "lote_apoio_id");

-- ============================================================
-- ANOTACAO / DOCUMENTO
-- ============================================================
CREATE TABLE "anotacoes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lote_id" UUID,
  "obra_id" UUID,
  "data" TIMESTAMP(3) NOT NULL,
  "texto" TEXT NOT NULL,
  "autor" TEXT,
  "origem" "OrigemAnotacao" NOT NULL DEFAULT 'MANUAL',
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "anotacoes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "anotacoes_lote_id_idx" ON "anotacoes"("lote_id");
CREATE INDEX "anotacoes_obra_id_idx" ON "anotacoes"("obra_id");
ALTER TABLE "anotacoes" ADD CONSTRAINT "anotacoes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "anotacoes" ADD CONSTRAINT "anotacoes_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "anotacoes" ADD CONSTRAINT "anotacoes_exatamente_um_pai_check" CHECK (
  (CASE WHEN "lote_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "obra_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

CREATE TABLE "documentos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "lote_id" UUID,
  "obra_id" UUID,
  "tipo" "TipoDocumento" NOT NULL,
  "nome_arquivo" TEXT NOT NULL,
  "mime_type" TEXT,
  "tamanho_bytes" INTEGER,
  "storage_provider" TEXT,
  "storage_key" TEXT,
  "checksum_sha256" TEXT,
  "descricao" TEXT,
  "usuario_upload_id" UUID,
  "data_upload" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documentos_lote_id_idx" ON "documentos"("lote_id");
CREATE INDEX "documentos_obra_id_idx" ON "documentos"("obra_id");
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_usuario_upload_id_fkey" FOREIGN KEY ("usuario_upload_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_exatamente_um_pai_check" CHECK (
  (CASE WHEN "lote_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "obra_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
);
