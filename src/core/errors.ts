/**
 * Domain errors. Deliberately free of HTTP/Telegram concerns so that any
 * channel adapter can map them to its own transport semantics.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION", message);
    this.name = "ValidationError";
  }
}

/**
 * Raised when a write is refused because the row changed underneath the caller
 * (optimistic concurrency). The dashboard sends the `updatedAt` it rendered;
 * if it no longer matches, the edit is rejected instead of silently overwriting
 * someone else's change.
 */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}
