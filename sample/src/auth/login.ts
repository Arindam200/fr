import { createSession } from "./session";

export async function login(email: string, password: string) {
  if (!email || !password) throw new Error("missing credentials");
  return createSession(email);
}
