import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  if (!projectColumns.some((column) => column.name === "bootstrap_json")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN bootstrap_json TEXT
    `;
  }

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some((column) => column.name === "bootstrap_status")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN bootstrap_status TEXT NOT NULL DEFAULT 'idle'
    `;
  }
  if (!threadColumns.some((column) => column.name === "bootstrap_command")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN bootstrap_command TEXT
    `;
  }
  if (!threadColumns.some((column) => column.name === "bootstrap_last_error")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN bootstrap_last_error TEXT
    `;
  }
  if (!threadColumns.some((column) => column.name === "pending_localhost_launch")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_localhost_launch INTEGER NOT NULL DEFAULT 0
    `;
  }
});
