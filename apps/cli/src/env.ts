import fs from "node:fs";
import path from "node:path";

/** Directory containing pnpm-workspace.yaml, or LCA_WORKSPACE, else cwd. */
export function resolveWorkspaceRoot(start = process.cwd()): string {
  if (process.env.LCA_WORKSPACE) {
    return path.resolve(process.env.LCA_WORKSPACE);
  }
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Minimal .env loader (no dependency). Does not override existing env vars. */
export function loadEnvFile(filePath?: string): void {
  const envPath = filePath ?? path.join(resolveWorkspaceRoot(), ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
