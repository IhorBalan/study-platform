export interface Note {
  id: string;
  title: string;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

// TODO: this type is a promise the compiler believes and the network does not keep.
// Replace it with something that is checked at run time: a class-validator DTO
// class or a zod schema. Rules: title is a string of 1 to 100 characters, body is
// an optional string of at most 2000 characters, and no other field is allowed.
export interface CreateNoteInput {
  title: string;
  body?: string;
}
