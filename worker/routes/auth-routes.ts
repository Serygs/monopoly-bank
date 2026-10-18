import {
  ApiValidationError,
  parseAddAccountEmailRequest,
  parseAuthTokenRequest,
  parseLoginRequest,
  parsePasswordResetConfirmationRequest,
  parsePasswordResetRequest,
  parseRegisterRequest,
  parseUpdateProfileRequest,
  parseUpgradeGuestRequest,
} from '../validation/api-validation.js';
import {
  route,
  success,
  type AuthedRouteContext,
  type PublicRouteContext,
  type Route,
} from './route-support.js';

const PWA_EVENTS = new Set(['UPDATE_AVAILABLE', 'UPDATE_APPLIED', 'OFFLINE_SHELL']);

async function register({ request, dependencies }: PublicRouteContext): Promise<Response> {
  const result = await dependencies.auth.register(await parseRegisterRequest(request));
  return success(result.profile, 201, result.cookie);
}

async function login({ request, dependencies, requestId }: PublicRouteContext): Promise<Response> {
  const result = await dependencies.auth.login(await parseLoginRequest(request), requestId);
  return success(result.profile, 200, result.cookie);
}

async function verifyEmail({ request, dependencies }: PublicRouteContext): Promise<Response> {
  return success(await dependencies.auth.verifyEmail((await parseAuthTokenRequest(request)).token));
}

async function requestPasswordReset({
  request,
  dependencies,
}: PublicRouteContext): Promise<Response> {
  await dependencies.auth.requestPasswordReset((await parsePasswordResetRequest(request)).email);
  return success({ accepted: true }, 202);
}

async function confirmPasswordReset({
  request,
  dependencies,
}: PublicRouteContext): Promise<Response> {
  const body = await parsePasswordResetConfirmationRequest(request);
  await dependencies.auth.resetPassword(body.token, body.password);
  return success(null);
}

async function logout({ request, dependencies }: PublicRouteContext): Promise<Response> {
  return success(null, 200, await dependencies.auth.logout(request));
}

async function revokeAll({ dependencies, actor }: AuthedRouteContext): Promise<Response> {
  return success(null, 200, await dependencies.auth.revokeAll(actor.id));
}

async function upgradeGuest({ request, dependencies, actor }: AuthedRouteContext) {
  const body = await parseUpgradeGuestRequest(request);
  const result = await dependencies.auth.upgradeGuest(actor.id, body.email, body.password);
  return success(result.profile, 200, result.cookie);
}

async function addEmail({ request, dependencies, actor }: AuthedRouteContext): Promise<Response> {
  return success(
    await dependencies.auth.addEmailToLegacyAccount(
      actor.id,
      (await parseAddAccountEmailRequest(request)).email,
    ),
  );
}

async function resendVerification({ dependencies, actor }: AuthedRouteContext): Promise<Response> {
  await dependencies.auth.resendVerification(actor.id);
  return success({ accepted: true }, 202);
}

async function recordPwaTelemetry({ request, dependencies }: AuthedRouteContext) {
  const body = (await request.json()) as { event?: unknown };
  if (typeof body.event !== 'string' || !PWA_EVENTS.has(body.event))
    throw new ApiValidationError('Unsupported PWA telemetry event.');
  dependencies.metrics?.record('pwa', body.event.toLowerCase(), 'success', 0, 202);
  return success({ accepted: true }, 202);
}

async function updateProfile({ request, dependencies, actor }: AuthedRouteContext) {
  const body = await parseUpdateProfileRequest(request);
  return success(await dependencies.auth.update(actor.id, body.nickname, body.avatar));
}

async function exportAccount({ dependencies, actor }: AuthedRouteContext): Promise<Response> {
  return success(await dependencies.auth.exportAccount(actor.id));
}

async function deleteAccount({ dependencies, actor }: AuthedRouteContext): Promise<Response> {
  return success(null, 200, await dependencies.auth.deleteAccount(actor.id));
}

export const publicAuthRoutes: Route<PublicRouteContext>[] = [
  route('POST', /^\/api\/auth\/register$/, register),
  route('POST', /^\/api\/auth\/login$/, login),
  route('POST', /^\/api\/auth\/verify-email$/, verifyEmail),
  route('POST', /^\/api\/auth\/password-reset$/, requestPasswordReset),
  route('POST', /^\/api\/auth\/password-reset\/confirm$/, confirmPasswordReset),
  route('POST', /^\/api\/auth\/logout$/, logout),
];

export const authedAuthRoutes: Route<AuthedRouteContext>[] = [
  route('POST', /^\/api\/auth\/sessions\/revoke-all$/, revokeAll),
  route('POST', /^\/api\/auth\/upgrade$/, upgradeGuest),
  route('POST', /^\/api\/auth\/email$/, addEmail),
  route('POST', /^\/api\/auth\/verification-email$/, resendVerification),
  route('POST', /^\/api\/telemetry\/pwa$/, recordPwaTelemetry),
  route('GET', /^\/api\/profile$/, ({ actor }) => Promise.resolve(success(actor))),
  route('PATCH', /^\/api\/profile$/, updateProfile),
  route('GET', /^\/api\/account\/export$/, exportAccount),
  route('DELETE', /^\/api\/account$/, deleteAccount),
];
