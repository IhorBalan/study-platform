export type Role = 'member' | 'admin';

/** What the rest of the app knows about the caller. Never includes the password hash. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}
