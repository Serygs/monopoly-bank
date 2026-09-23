import type { BoardDetails, BoardSummary, CreateBoardRequest, DeleteBoardResponse } from '../../shared/contracts/api.js';
import type { BoardSpace } from '../../shared/types/monopoly.js';
import { toBoardDefinition, type PropertyRepository, type StoredBoard } from '../repositories/property-repository.js';
import { ConflictError, isUniqueConstraintError, NotFoundError, ValidationError } from './errors.js';

export interface BoardServiceDependencies {
  boards: PropertyRepository;
  createId: () => string;
}

/** How many boards one account may own; the canonical boards do not count. */
export const boardsPerUserLimit = 10;

/**
 * The board catalogue: canonical boards everyone plays on, and the renamed
 * copies a user owns. A copy changes nothing but the names — every price,
 * colour group and rent is carried over from its source — so a custom board
 * can never make a game cheaper or dearer than the rules allow.
 */
export class BoardService {
  private readonly boards: PropertyRepository;
  private readonly createId: () => string;

  constructor(dependencies: BoardServiceDependencies) {
    this.boards = dependencies.boards;
    this.createId = dependencies.createId;
  }

  async list(userId: string): Promise<BoardSummary[]> {
    return (await this.boards.listBoardsForUser(userId)).map(summarize);
  }

  /**
   * Visible to the owner, to everyone for a canonical board, and to any member
   * of a game played on it. Anyone else gets the same answer as for a board
   * that does not exist.
   */
  async get(boardId: string, userId: string): Promise<BoardDetails> {
    const board = await this.boards.getBoard(boardId);
    if (board === null) throw boardNotFound();
    if (board.ownerUserId !== null && board.ownerUserId !== userId && !(await this.boards.isBoardVisibleThroughGame(boardId, userId))) throw boardNotFound();
    return { ...summarize(board), spaces: await this.boards.listSpaces(boardId) };
  }

  async create(userId: string, request: CreateBoardRequest): Promise<BoardDetails> {
    const source = await this.boards.getBoard(request.sourceBoardId);
    if (source === null || (source.ownerUserId !== null && source.ownerUserId !== userId)) throw boardNotFound();
    const sourceSpaces = await this.boards.listSpaces(source.id);
    ensureNamesCoverEverySpace(sourceSpaces, request.spaceNames);
    if ((await this.boards.countBoardsOwnedBy(userId)) >= boardsPerUserLimit) throw new ConflictError('BOARD_LIMIT_REACHED', `You can own at most ${boardsPerUserLimit} boards.`, { limit: boardsPerUserLimit });

    const boardId = this.createId();
    try {
      await this.boards.createBoard({
        board: { ...toBoardDefinition(source), id: boardId, name: request.name, ownerUserId: userId, sourceBoardId: source.id },
        spaces: sourceSpaces.map((space) => ({
          id: this.createId(),
          boardIndex: space.boardIndex,
          kind: space.kind,
          colorGroup: space.colorGroup,
          translationKey: space.translationKey,
          customName: request.spaceNames[space.id] as string,
          price: space.price,
          mortgageValue: space.mortgageValue,
          houseCost: space.houseCost,
          rents: space.rents,
        })),
      });
    } catch (error) {
      if (isUniqueConstraintError(error instanceof Error && 'cause' in error ? error.cause : error)) throw new ConflictError('BOARD_CONFLICT', 'This board could not be created. Please try again.');
      throw error;
    }
    return this.get(boardId, userId);
  }

  /** Only the owner may delete, and only while no game points at the board; the schema's RESTRICT is the backstop, not the message. */
  async delete(boardId: string, userId: string): Promise<DeleteBoardResponse> {
    const board = await this.boards.getBoard(boardId);
    if (board === null || board.ownerUserId === null || board.ownerUserId !== userId) throw boardNotFound();
    if ((await this.boards.countGamesUsingBoard(boardId)) > 0) throw boardInUse();
    try {
      if (!(await this.boards.deleteBoard(boardId, userId))) throw boardNotFound();
    } catch (error) {
      if (error instanceof Error && /FOREIGN KEY constraint failed/iu.test(error.message)) throw boardInUse();
      throw error;
    }
    return { boardId };
  }
}

function ensureNamesCoverEverySpace(spaces: readonly BoardSpace[], spaceNames: Record<string, string>): void {
  const provided = Object.keys(spaceNames);
  const expected = new Set(spaces.map((space) => space.id));
  const missing = spaces.filter((space) => spaceNames[space.id] === undefined).map((space) => space.id);
  const unknown = provided.filter((id) => !expected.has(id));
  if (provided.length !== spaces.length || missing.length > 0 || unknown.length > 0) {
    throw new ValidationError(`spaceNames must name every space of the source board exactly once (${spaces.length} spaces).`, { expected: spaces.length, provided: provided.length, missing, unknown });
  }
}

function summarize(board: StoredBoard): BoardSummary {
  return { board: toBoardDefinition(board), isCanonical: board.ownerUserId === null, sourceBoardId: board.sourceBoardId, createdAt: board.createdAt };
}

function boardNotFound(): NotFoundError { return new NotFoundError('BOARD_NOT_FOUND', 'Board not found.'); }
function boardInUse(): ConflictError { return new ConflictError('BOARD_IN_USE', 'A game is still played on this board.'); }
