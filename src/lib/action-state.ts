export interface ActionState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Preenchido em ações que devolvem dados (ex.: identificação por URL). */
  data?: Record<string, unknown>;
}

export const initialState: ActionState = { ok: false };

export function fail(message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors };
}

export function done(message: string, data?: Record<string, unknown>): ActionState {
  return { ok: true, message, data };
}
