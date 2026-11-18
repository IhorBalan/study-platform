export interface Document {
  id: string;
  ownerId: string;
  title: string;
  body: string;
}

export interface DocumentInput {
  title?: unknown;
  body?: unknown;
}
