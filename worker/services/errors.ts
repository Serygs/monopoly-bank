/** Errors crossing a Worker boundary. `message` is deliberately safe for clients. */
export abstract class AppError extends Error {
  readonly code: string; readonly status: number; readonly expose: boolean; readonly details?: Record<string, unknown>;
  constructor(options: { code: string; message: string; status: number; expose?: boolean; details?: Record<string, unknown>; cause?: unknown }) {
    super(options.message, { cause: options.cause }); this.name = new.target.name; this.code = options.code; this.status = options.status; this.expose = options.expose ?? true; this.details = options.details;
  }
}
export class ValidationError extends AppError { constructor(message: string, details?: Record<string, unknown>) { super({ code: 'VALIDATION_ERROR', message, status: 400, details }); } }
export class AuthenticationRequiredError extends AppError { constructor() { super({ code: 'UNAUTHORIZED', message: 'Authentication is required.', status: 401 }); } }
export class InvalidCredentialsError extends AppError { constructor() { super({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.', status: 401 }); } }
export class ForbiddenError extends AppError { constructor(message = 'You are not allowed to perform this operation.') { super({ code: 'FORBIDDEN', message, status: 403 }); } }
/** Intentionally does not disclose whether the game exists. */
export class GameAccessDeniedError extends AppError { constructor() { super({ code: 'GAME_NOT_MEMBER', message: 'You are not allowed to access this game.', status: 403 }); } }
export class GameOwnerRequiredError extends AppError { constructor() { super({ code: 'GAME_OWNER_REQUIRED', message: 'Game owner permission is required.', status: 403 }); } }
export class NotFoundError extends AppError { constructor(code = 'NOT_FOUND', message = 'Resource not found.') { super({ code, message, status: 404 }); } }
export class ResourceNotFoundError extends NotFoundError { readonly resource: string; constructor(resource: string) { super(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} not found.`); this.resource = resource; } }
export class ConflictError extends AppError { constructor(code = 'CONFLICT', message = 'The resource conflicts with the current state.', details?: Record<string, unknown>) { super({ code, message, status: 409, details }); } }
export class InvalidGamePasswordError extends AppError { constructor() { super({ code: 'INVALID_GAME_PASSWORD', message: 'The game password is invalid.', status: 401 }); } }
export class InvalidJoinCodeError extends NotFoundError { constructor() { super('INVALID_JOIN_CODE', 'Game not found.'); } }
export class DuplicateCommandError extends ConflictError { constructor() { super('DUPLICATE_COMMAND', 'This command has already been processed.'); } }
export class DatabaseError extends AppError { readonly operation: string; constructor(options: { operation: string; cause: unknown }) { super({ code: 'DATABASE_ERROR', message: 'Internal server error.', status: 500, expose: false, cause: options.cause }); this.operation = options.operation; } }
export class RealtimeError extends AppError { constructor(cause: unknown) { super({ code: 'REALTIME_ERROR', message: 'Internal server error.', status: 500, expose: false, cause }); } }
export class InternalError extends AppError { constructor(cause?: unknown) { super({ code: 'INTERNAL_ERROR', message: 'Internal server error.', status: 500, expose: false, cause }); } }
export class PersistenceConsistencyError extends InternalError { constructor() { super(); this.message = 'A persisted record could not be loaded.'; } }
export function isUniqueConstraintError(error: unknown): boolean { return error instanceof Error && /unique constraint|constraint failed/i.test(error.message); }
