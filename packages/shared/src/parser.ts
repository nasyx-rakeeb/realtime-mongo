import { ClientMessageSchema, ServerMessageSchema, ClientMessage, ServerMessage } from './protocol';
import { PROTOCOL_VERSION } from './constants';
import { ErrorCodes } from './errors';

/**
 * Thrown by `parseClientMessage` and `parseServerMessage` when a message
 * fails validation. Always carries a typed `code` from `ErrorCodes` so
 * callers can send a structured error response without additional branching.
 */
export class ProtocolError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = ErrorCodes.INVALID_MESSAGE) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/**
 * Parses and validates an incoming client→server message.
 *
 * The protocol version is checked before full schema validation so that
 * version mismatch errors carry `UNSUPPORTED_PROTOCOL_VERSION` rather than
 * the generic `INVALID_MESSAGE` code.
 *
 * @throws {ProtocolError} If the message is malformed or has an unsupported version.
 */
export function parseClientMessage(raw: unknown): ClientMessage {
  if (typeof raw === 'object' && raw !== null && 'v' in raw) {
    if ((raw as any).v !== PROTOCOL_VERSION) {
      throw new ProtocolError(
        `Unsupported protocol version. Expected ${PROTOCOL_VERSION}, got ${(raw as any).v}`,
        ErrorCodes.UNSUPPORTED_PROTOCOL_VERSION
      );
    }
  }

  const result = ClientMessageSchema.safeParse(raw);
  if (!result.success) {
    throw new ProtocolError(
      `Invalid client message: ${result.error.message}`,
      ErrorCodes.INVALID_MESSAGE
    );
  }
  return result.data;
}

/**
 * Parses and validates an incoming server→client message.
 *
 * @throws {ProtocolError} If the message is malformed or has an unsupported version.
 */
export function parseServerMessage(raw: unknown): ServerMessage {
  if (typeof raw === 'object' && raw !== null && 'v' in raw) {
    if ((raw as any).v !== PROTOCOL_VERSION) {
      throw new ProtocolError(
        `Unsupported protocol version. Expected ${PROTOCOL_VERSION}, got ${(raw as any).v}`,
        ErrorCodes.UNSUPPORTED_PROTOCOL_VERSION
      );
    }
  }

  const result = ServerMessageSchema.safeParse(raw);
  if (!result.success) {
    throw new ProtocolError(
      `Invalid server message: ${result.error.message}`,
      ErrorCodes.INVALID_MESSAGE
    );
  }
  return result.data;
}
