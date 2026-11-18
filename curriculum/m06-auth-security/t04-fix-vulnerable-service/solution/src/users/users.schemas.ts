import { z } from 'zod';

// strictObject rejects unknown keys with 400. That is the mass-assignment fix:
// the client can only send the fields we list, so "role" or "id" never reach SQL.

export const SignupSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(8).max(1024),
  name: z.string().min(1).max(100),
});
export type Signup = z.infer<typeof SignupSchema>;

export const LoginSchema = z.strictObject({
  email: z.string().max(254),
  password: z.string().max(1024),
});
export type Login = z.infer<typeof LoginSchema>;

export const UpdateMeSchema = z.strictObject({
  name: z.string().min(1).max(100),
});
export type UpdateMe = z.infer<typeof UpdateMeSchema>;
