export interface Note {
  id: string;
  title: string;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface CreateNoteInput {
  title: string;
  body?: string;
}
