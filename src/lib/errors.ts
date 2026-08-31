/**
 * Erros de aplicação — cada um mapeia para um status HTTP específico no
 * handler de erro global registrado em app.ts. Handlers de rota lançam
 * essas classes em vez de responder diretamente com reply.code(...), o que
 * mantém a lógica de negócio testável sem um objeto `reply` real.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(entidade: string, id: string) {
    super(`${entidade} não encontrado(a): ${id}`, 404, "NOT_FOUND");
  }
}

export class ValidationAppError extends AppError {
  constructor(
    message: string,
    public readonly detalhes?: unknown
  ) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Credenciais inválidas") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para executar esta ação") {
    super(message, 403, "FORBIDDEN");
  }
}
