import { closePool } from "./pool";

process.on("SIGTERM", async () => {
  await closePool(); // drain database connections before exit
  process.exit(0);
});
