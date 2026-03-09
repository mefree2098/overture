import Database from "better-sqlite3";
import { getDatabasePath } from "@/lib/server/storage";

let dbInstance: Database.Database | null = null;

function existingColumns(db: Database.Database, table: string) {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  return new Set(rows.map((row) => row.name));
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const columns = existingColumns(db, table);

  if (columns.has(column)) {
    return;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function runMigrations(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      repo_source TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      planner_model TEXT,
      execution_model TEXT,
      planner_reasoning_effort TEXT NOT NULL DEFAULT 'low',
      symphony_max_concurrent_agents INTEGER NOT NULL DEFAULT 2,
      symphony_max_turns INTEGER NOT NULL DEFAULT 24,
      status TEXT NOT NULL,
      health TEXT NOT NULL,
      qa_strictness INTEGER NOT NULL,
      security_strictness INTEGER NOT NULL,
      deployment_targets_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      planner_model TEXT,
      execution_model TEXT,
      planner_reasoning_effort TEXT NOT NULL,
      default_execution_mode TEXT NOT NULL,
      default_repo_source TEXT NOT NULL,
      default_qa_strictness INTEGER NOT NULL,
      default_security_strictness INTEGER NOT NULL,
      symphony_max_concurrent_agents INTEGER NOT NULL,
      symphony_max_turns INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spec_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plan_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      spec_document_id TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      spec_ir_json TEXT NOT NULL,
      review_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_document_id) REFERENCES spec_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      plan_version_id TEXT NOT NULL,
      parent_id TEXT,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      acceptance_criteria_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES work_items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS dependency_edges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_work_item_id TEXT NOT NULL,
      to_work_item_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (from_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (to_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      runner_type TEXT NOT NULL,
      thread_id TEXT,
      workspace_path TEXT NOT NULL,
      log_path TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_item_id TEXT,
      run_id TEXT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_item_id TEXT,
      run_id TEXT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS gate_statuses (
      project_id TEXT PRIMARY KEY,
      qa_status TEXT NOT NULL,
      security_status TEXT NOT NULL,
      deploy_status TEXT NOT NULL,
      release_status TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_item_id TEXT,
      run_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_work_items_project_status ON work_items(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_runs_project_started ON runs(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_project_created ON artifacts(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_findings_project_category ON findings(project_id, category, severity);
    CREATE INDEX IF NOT EXISTS idx_audit_events_project_created ON audit_events(project_id, created_at DESC);
  `);

  ensureColumn(db, "projects", "planner_model", "TEXT");
  ensureColumn(db, "projects", "execution_model", "TEXT");
  ensureColumn(
    db,
    "projects",
    "planner_reasoning_effort",
    "TEXT NOT NULL DEFAULT 'low'",
  );
  ensureColumn(
    db,
    "projects",
    "symphony_max_concurrent_agents",
    "INTEGER NOT NULL DEFAULT 2",
  );
  ensureColumn(db, "projects", "symphony_max_turns", "INTEGER NOT NULL DEFAULT 24");
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = new Database(getDatabasePath());
    dbInstance.pragma("foreign_keys = ON");
    runMigrations(dbInstance);
  }

  return dbInstance;
}
