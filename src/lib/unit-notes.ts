// Internal unit note — client-safe constants + error codes (BYT-20261118-005).
// Server code lives in unit-notes.server.ts. Codes map to i18n `UnitNotes.errors`.

export const UNIT_NOTE_MAX_LENGTH = 5000;

export const UNIT_NOTE_ERROR_CODES = [
  "unit_note.too_long",
  "unit_note.conflict",
  "unit_note.forbidden",
  "unit_note.failed",
] as const;
export type UnitNoteErrorCode = (typeof UNIT_NOTE_ERROR_CODES)[number];

export interface UnitNoteDTO {
  body: string;
  updatedAt: string; // ISO — echoed back as `expectedUpdatedAt` on save
  updatedByName: string | null;
}
