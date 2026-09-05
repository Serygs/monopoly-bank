import type { UserProfile } from '../../shared/contracts/api.js';
import type { LiveMutationCommand } from '../../shared/contracts/live.js';

export interface GameLiveGateway {
  connect(gameId: string, actor: UserProfile, request: Request): Promise<Response>;
  mutate(gameId: string, actor: UserProfile, command: LiveMutationCommand): Promise<Response>;
  lobbyUpdated(gameId: string): Promise<void>;
}

/** The public Worker authenticates requests before forwarding them to the per-game object. */
export class DurableObjectGameLiveGateway implements GameLiveGateway {
  private readonly sessions: DurableObjectNamespace;
  constructor(sessions: DurableObjectNamespace) { this.sessions = sessions; }

  connect(gameId: string, actor: UserProfile, request: Request): Promise<Response> {
    return this.session(gameId).fetch(new Request('https://game-session/connect', {
      headers: { upgrade: request.headers.get('upgrade') ?? '', 'x-game-id': gameId, 'x-user-id': actor.id, 'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID() },
    }));
  }

  mutate(gameId: string, actor: UserProfile, command: LiveMutationCommand): Promise<Response> {
    return this.session(gameId).fetch(new Request('https://game-session/mutation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-game-id': gameId, 'x-user-id': actor.id },
      body: JSON.stringify(command),
    }));
  }

  async lobbyUpdated(gameId: string): Promise<void> {
    await this.session(gameId).fetch(new Request('https://game-session/lobby-updated', { method: 'POST', headers: { 'x-game-id': gameId } }));
  }

  private session(gameId: string): DurableObjectStub { return this.sessions.get(this.sessions.idFromName(gameId)); }
}
