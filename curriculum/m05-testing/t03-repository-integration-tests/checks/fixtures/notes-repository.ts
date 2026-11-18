// A small repository over the `notes` table. It is correct: your job is to
// write integration tests that would catch it if it broke.
import type { Pool, PoolClient } from 'pg';

/** Anything that can run a query: the pool itself, or one client checked out of it (for example inside a transaction). */
export type Queryable = Pool | PoolClient;

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
}

interface NoteRow {
  id: string;
  title: string;
  body: string;
  created_at: Date;
}

const COLUMNS = 'id, title, body, created_at';

function toNote(row: NoteRow): Note {
  return { id: row.id, title: row.title, body: row.body, createdAt: row.created_at };
}

export class NotesRepository {
  #db: Queryable;

  constructor(db: Queryable) {
    this.#db = db;
  }

  async create(input: { title: string; body?: string }): Promise<Note> {
    const { rows } = await this.#db.query<NoteRow>(
      `INSERT INTO notes (title, body) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [input.title, input.body ?? ''],
    );
    return toNote(rows[0]);
  }

  /** Returns null when no note has this id. */
  async findById(id: string): Promise<Note | null> {
    const { rows } = await this.#db.query<NoteRow>(`SELECT ${COLUMNS} FROM notes WHERE id = $1`, [id]);
    return rows.length === 0 ? null : toNote(rows[0]);
  }

  /** Newest first: by created_at, then by id for notes created in the same instant. */
  async listRecent(limit: number): Promise<Note[]> {
    const { rows } = await this.#db.query<NoteRow>(
      `SELECT ${COLUMNS} FROM notes ORDER BY created_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows.map(toNote);
  }

  /** Changes the title of one note. Returns the updated note, or null when no note has this id. */
  async rename(id: string, title: string): Promise<Note | null> {
    const { rows } = await this.#db.query<NoteRow>(
      `UPDATE notes SET title = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, title],
    );
    return rows.length === 0 ? null : toNote(rows[0]);
  }

  /** Returns true when a note was deleted, false when no note had this id. */
  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.#db.query(`DELETE FROM notes WHERE id = $1`, [id]);
    return rowCount === 1;
  }
}
