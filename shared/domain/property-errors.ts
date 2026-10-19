import { AppError } from '../../worker/services/errors.js';

export class TileNotFoundError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'TILE_NOT_FOUND',
      message: 'This tile is not on the board.',
      status: 404,
      details: { tileId },
    });
  }
}

export class PropertyAlreadyOwnedError extends AppError {
  constructor(tileId: string, ownerPlayerId: string | null) {
    super({
      code: 'PROPERTY_ALREADY_OWNED',
      message: 'This property already has an owner.',
      status: 409,
      details: { tileId, ownerPlayerId },
    });
  }
}

export class PropertyNotOwnedError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'PROPERTY_NOT_OWNED',
      message: 'The player does not own this property.',
      status: 409,
      details: { tileId },
    });
  }
}

export class PropertyMortgagedError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'PROPERTY_MORTGAGED',
      message: 'This property is mortgaged.',
      status: 409,
      details: { tileId },
    });
  }
}

export class PropertyHasBuildingsError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'PROPERTY_HAS_BUILDINGS',
      message: 'This property or its colour group has buildings.',
      status: 409,
      details: { tileId },
    });
  }
}

/** Houses and hotels go on streets only. */
export class TileNotBuildableError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'TILE_NOT_BUILDABLE',
      message: 'Only streets can have houses or hotels.',
      status: 409,
      details: { tileId },
    });
  }
}

/** Building needs the whole colour group. */
export class BuildRequiresFullGroupError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'BUILD_REQUIRES_FULL_GROUP',
      message: 'The player must hold the whole colour group to build.',
      status: 409,
      details: { tileId },
    });
  }
}

/** Buildings are added and sold evenly across a colour group. */
export class BuildUnevenError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'BUILD_UNEVEN',
      message: 'Buildings must be spread evenly across the colour group.',
      status: 409,
      details: { tileId },
    });
  }
}

export class BuildMortgagedGroupError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'BUILD_MORTGAGED_GROUP',
      message: 'A tile of this colour group is mortgaged.',
      status: 409,
      details: { tileId },
    });
  }
}

export class NoBuildingsError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'NO_BUILDINGS',
      message: 'This property has no buildings to sell.',
      status: 409,
      details: { tileId },
    });
  }
}

export class MaxBuildingsError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'MAX_BUILDINGS',
      message: 'This property already has a hotel.',
      status: 409,
      details: { tileId },
    });
  }
}

/** A multi-building request that makes no sense (wrong tiles, levels, direction or nothing to do). */
export class InvalidBuildTargetError extends AppError {
  constructor(reason: string, tileId?: string) {
    super({
      code: 'INVALID_BUILD_TARGET',
      message: `Invalid building request: ${reason}.`,
      status: 400,
      details: tileId === undefined ? { reason } : { reason, tileId },
    });
  }
}

/** A utility rent needs the dice sum; any other tile must not carry one. */
export class DiceSumError extends AppError {
  constructor(required: boolean) {
    super({
      code: 'VALIDATION_ERROR',
      message: required
        ? 'diceSum is required to pay the rent of a utility.'
        : 'diceSum applies to utilities only.',
      status: 400,
      details: { field: 'diceSum' },
    });
  }
}
