export type Role = 'member' | 'admin';

/** The public shape of a user. Never add password_hash here. */
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

/** The columns that make up AuthUser. Use it instead of SELECT * or RETURNING *. */
export const USER_COLUMNS = 'id, email, name, role';
