import { withConnection } from "./pool";

export async function migrate() {
  await withConnection((db) => db.query("CREATE TABLE IF NOT EXISTS users (id serial primary key, email text)"));
}
