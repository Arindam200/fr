export function createSession(userId: string) {
  return { token: crypto.randomUUID(), userId, expires: Date.now() + 86_400_000 };
}
