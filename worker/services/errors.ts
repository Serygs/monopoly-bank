export class ResourceNotFoundError extends Error {
  readonly resource: string;

  constructor(resource: string) {
    super(`${resource} was not found.`);
    this.resource = resource;
  }
}

export class PersistenceConsistencyError extends Error {
  constructor() {
    super('A persisted record could not be loaded.');
  }
}
