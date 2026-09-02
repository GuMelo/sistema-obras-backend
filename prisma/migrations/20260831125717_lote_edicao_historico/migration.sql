-- Adiciona o valor "EDICAO_SISTEMA" ao enum OrigemAnotacao: histórico
-- funcional gerado automaticamente pelo backend ao editar um Lote (PATCH
-- /lotes/:id), distinto de MANUAL (texto do usuário) e IMPORTACAO_LEGADO
-- (texto preservado da planilha). Aditivo — não afeta linhas existentes.
ALTER TYPE "OrigemAnotacao" ADD VALUE 'EDICAO_SISTEMA';
