import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticationRequiredError,
  ConflictError,
  DatabaseError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from './errors.js';
import { handleError, sanitize, serializeError } from './error-handler.js';

const context = { requestId: 'request-test-123', method: 'POST', path: '/api/auth/register' };

describe('central error handler', () => {
  it.each([
    [new ValidationError('invalid'), 400, 'VALIDATION_ERROR'],
    [new AuthenticationRequiredError(), 401, 'UNAUTHORIZED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
  ])('maps %s to its HTTP status', async (error, status, code) => {
    const response = handleError(error, context);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code, requestId: context.requestId },
    });
  });
  it('maps typed errors to the safe contract with request correlation', async () => {
    const response = handleError(
      new ValidationError('amount is required.', { field: 'amount' }),
      context,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe(context.requestId);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'amount is required.',
        requestId: context.requestId,
        details: { field: 'amount' },
      },
    });
  });
  it('keeps D1 causes in server logs but outside the response', async () => {
    const error = new DatabaseError({
      operation: 'createUser',
      cause: new Error('D1_ERROR: no such table: users'),
    });
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = handleError(error, context);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('no such table: users'));
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error.',
        requestId: context.requestId,
      },
    });
    logger.mockRestore();
  });
  it('redacts sensitive values throughout error metadata', () => {
    expect(
      sanitize({ password: 'p', nested: { authorization: 'Bearer secret' }, ok: 'yes' }),
    ).toEqual({ password: '[redacted]', nested: { authorization: '[redacted]' }, ok: 'yes' });
    expect(serializeError(new Error('failure'))).toMatchObject({
      name: 'Error',
      message: 'failure',
    });
  });
});
