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
      lifecycle_stage TEXT NOT NULL DEFAULT 'plan_ingested',
      research_provider TEXT NOT NULL DEFAULT 'codex_native',
      planner_model TEXT,
      execution_model TEXT,
      planner_reasoning_effort TEXT NOT NULL DEFAULT 'low',
      execution_reasoning_effort TEXT NOT NULL DEFAULT 'medium',
      symphony_max_concurrent_agents INTEGER NOT NULL DEFAULT 5,
      symphony_max_turns INTEGER NOT NULL DEFAULT 24,
      status TEXT NOT NULL,
      health TEXT NOT NULL,
      qa_strictness INTEGER NOT NULL,
      security_strictness INTEGER NOT NULL,
      deployment_targets_json TEXT NOT NULL,
      cumulative_input_tokens INTEGER NOT NULL DEFAULT 0,
      cumulative_output_tokens INTEGER NOT NULL DEFAULT 0,
      cumulative_total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      planner_model TEXT,
      execution_model TEXT,
      planner_reasoning_effort TEXT NOT NULL,
      execution_reasoning_effort TEXT NOT NULL,
      default_research_provider TEXT NOT NULL DEFAULT 'codex_native',
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

    CREATE TABLE IF NOT EXISTS workshop_threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      codex_thread_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      search_mode TEXT NOT NULL,
      prompt_draft TEXT NOT NULL,
      summary TEXT NOT NULL,
      repo_context TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workshop_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workshop_thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (workshop_thread_id) REFERENCES workshop_threads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      search_mode TEXT NOT NULL,
      prompt_artifact_id TEXT,
      report_artifact_id TEXT,
      plan_artifact_id TEXT,
      citations_artifact_id TEXT,
      summary_artifact_id TEXT,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (prompt_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
      FOREIGN KEY (report_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
      FOREIGN KEY (plan_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
      FOREIGN KEY (citations_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
      FOREIGN KEY (summary_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS launch_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      target TEXT NOT NULL,
      label TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT NOT NULL,
      healthcheck_url TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS launch_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      launch_profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      log_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (launch_profile_id) REFERENCES launch_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deploy_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      target TEXT NOT NULL,
      label TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT NOT NULL,
      approval_required INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deploy_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      deploy_profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      log_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (deploy_profile_id) REFERENCES deploy_profiles(id) ON DELETE CASCADE
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
    CREATE INDEX IF NOT EXISTS idx_workshop_threads_project_updated ON workshop_threads(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workshop_messages_thread_created ON workshop_messages(workshop_thread_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_research_runs_project_started ON research_runs(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_launch_profiles_project_target ON launch_profiles(project_id, target);
    CREATE INDEX IF NOT EXISTS idx_launch_runs_project_started ON launch_runs(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deploy_profiles_project_target ON deploy_profiles(project_id, target);
    CREATE INDEX IF NOT EXISTS idx_deploy_runs_project_started ON deploy_runs(project_id, started_at DESC);
  `);

  ensureColumn(
    db,
    "projects",
    "lifecycle_stage",
    "TEXT NOT NULL DEFAULT 'plan_ingested'",
  );
  ensureColumn(
    db,
    "projects",
    "research_provider",
    "TEXT NOT NULL DEFAULT 'codex_native'",
  );
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
    "execution_reasoning_effort",
    "TEXT NOT NULL DEFAULT 'medium'",
  );
  ensureColumn(
    db,
    "projects",
    "symphony_max_concurrent_agents",
    "INTEGER NOT NULL DEFAULT 5",
  );
  ensureColumn(db, "projects", "symphony_max_turns", "INTEGER NOT NULL DEFAULT 24");
  ensureColumn(
    db,
    "projects",
    "cumulative_input_tokens",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "projects",
    "cumulative_output_tokens",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "projects",
    "cumulative_total_tokens",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "app_settings",
    "default_research_provider",
    "TEXT NOT NULL DEFAULT 'codex_native'",
  );
  ensureColumn(
    db,
    "app_settings",
    "execution_reasoning_effort",
    "TEXT NOT NULL DEFAULT 'medium'",
  );
  db.prepare(
    `
      UPDATE app_settings
      SET symphony_max_concurrent_agents = 5
      WHERE id = 'default' AND symphony_max_concurrent_agents = 2
    `,
  ).run();
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = new Database(getDatabasePath());
    dbInstance.pragma("foreign_keys = ON");
    runMigrations(dbInstance);
  }

  return dbInstance;
}
