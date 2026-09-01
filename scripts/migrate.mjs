import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const dir = join(process.cwd(), "db", "migrations");
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://clippay:clippay@localhost:5444/clippay";

const client = new pg.Client({ connectionString });
await client.connect();

for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
  process.stdout.write(`applying ${file} ... `);
  await client.query(await readFile(join(dir, file), "utf8"));
  console.log("ok");
}

await client.end();
