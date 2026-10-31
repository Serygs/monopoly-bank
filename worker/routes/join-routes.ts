import {
  MAX_LOBBY_PLAYERS,
  type GameDetails,
  type GuestJoinGameRequest,
  type JoinGameRequest,
} from '../../shared/contracts/api.js';
import { pickRandomUnusedColor } from '../../shared/domain/player-colors.js';
import type { PublicProfile } from '../services/auth-service.js';
import { resolveJoinAccess } from '../services/game-access-service.js';
import { LobbyFullError } from '../services/errors.js';
import { parseGuestJoinGameRequest, parseJoinGameRequest } from '../validation/api-validation.js';
import { recordJoinFailure } from './rate-limit.js';
import {
  readCommandId,
  route,
  success,
  type AuthedRouteContext,
  type PublicRouteContext,
  type Route,
} from './route-support.js';

function nextPlayerColor(players: readonly { color: string }[]): string {
  return pickRandomUnusedColor(players.map((player) => player.color));
}

function resolveAccess(context: PublicRouteContext, body: JoinGameRequest) {
  const { request, dependencies } = context;
  return resolveJoinAccess(dependencies.access, body, (joinCode) =>
    recordJoinFailure(dependencies.rateLimits, request, joinCode),
  );
}

async function guestJoin(context: PublicRouteContext): Promise<Response> {
  const { request, dependencies } = context;
  const body: GuestJoinGameRequest = await parseGuestJoinGameRequest(request);
  const access = await resolveAccess(context, body);
  const details = await dependencies.games.getGame(access.gameId);
  if (details.players.length >= MAX_LOBBY_PLAYERS) throw new LobbyFullError();
  const profile = await dependencies.auth.createGuest(body.nickname, body.avatar);
  const seat = joinSeat(profile.profile, details);
  if (dependencies.live !== undefined) {
    const response = await dependencies.live.mutate(access.gameId, profile.profile, {
      type: 'JOIN_LOBBY',
      commandId: readCommandId(request),
      ...seat,
    });
    if (!response.ok) return response;
    const payload = (await response.json()) as { data: GameDetails };
    return success({ profile: profile.profile, game: payload.data }, 201, profile.cookie);
  }
  await dependencies.access.joinLobby({
    gameId: access.gameId,
    userId: profile.profile.id,
    ...seat,
  });
  return success(
    { profile: profile.profile, game: await dependencies.games.getGame(access.gameId) },
    201,
    profile.cookie,
  );
}

async function memberJoin(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const access = await resolveAccess(context, await parseJoinGameRequest(request));
  const details = await dependencies.games.getGame(access.gameId);
  await dependencies.access.requireLobbySeat(access.gameId, actor.id, details.players.length);
  const seat = joinSeat(actor, details);
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(access.gameId, actor, {
      type: 'JOIN_LOBBY',
      commandId: readCommandId(request),
      ...seat,
    });
  await dependencies.access.joinLobby({ gameId: access.gameId, userId: actor.id, ...seat });
  return success(await dependencies.games.getGame(access.gameId));
}

function joinSeat(actor: PublicProfile, details: GameDetails) {
  return {
    playerId: crypto.randomUUID(),
    nickname: actor.nickname,
    color: nextPlayerColor(details.players),
    startingBalance: details.game.startingBalance,
  };
}

export const publicJoinRoutes: Route<PublicRouteContext>[] = [
  route('POST', /^\/api\/games\/join\/guest$/, guestJoin),
];

export const authedJoinRoutes: Route<AuthedRouteContext>[] = [
  route('POST', /^\/api\/games\/join$/, memberJoin),
];
