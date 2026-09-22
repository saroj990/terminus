/**
 * Phase 3 RAG: chunk → embed → nearest-neighbor search.
 *
 * Embeddings here are hashed bag-of-words (deterministic, no GPU).
 * Same *shape* as a real embedder: text → vector → cosine similarity.
 */

import fs from "node:fs";
import path from "node:path";
import { assertPathInsideWorkspace, isSensitiveWorkspacePath } from "@lca/policy";

const DIM = 128;
const CHUNK_CHARS = 800;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".lca", "coverage"]);
const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
]);

export interface Chunk {
  path: string;
  startLine: number;
  text: string;
  vector: Float64Array;
}

export interface RetrievalHit {
  path: string;
  startLine: number;
  score: number;
  snippet: string;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 0);
}

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % DIM;
}

/** Turn text into a unit-length vector (hashed bag-of-words). */
export function embed(text: string): Float64Array {
  const v = new Float64Array(DIM);
  for (const token of tokenize(text)) {
    const i = hashToken(token);
    const cur = v[i] ?? 0;
    v[i] = cur + 1;
    if (token.length >= 3) {
      const j = hashToken(token.slice(0, 3));
      v[j] = (v[j] ?? 0) + 0.25;
    }
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += (v[i] ?? 0) ** 2;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}

export function cosine(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export function chunkText(content: string, pathRel: string): Omit<Chunk, "vector">[] {
  const lines = content.split("\n");
  const out: Omit<Chunk, "vector">[] = [];
  let buf: string[] = [];
  let startLine = 1;
  let chars = 0;

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ path: pathRel, startLine, text });
    buf = [];
    chars = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (buf.length === 0) startLine = i + 1;
    buf.push(line);
    chars += line.length + 1;
    if (chars >= CHUNK_CHARS) flush();
  }
  flush();
  return out;
}

export function indexWorkspace(workspaceRoot: string): Chunk[] {
  const root = path.resolve(workspaceRoot);
  const chunks: Chunk[] = [];
  walk(root, root, (file) => {
    if (isSensitiveWorkspacePath(file)) return;
    const ext = path.extname(file).toLowerCase();
    if (ext && !TEXT_EXT.has(ext)) return;
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      return;
    }
    if (!st.isFile() || st.size > 64_000) return;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return;
    const rel = path.relative(root, file);
    for (const raw of chunkText(buf.toString("utf8"), rel)) {
      chunks.push({ ...raw, vector: embed(raw.text) });
    }
  });
  return chunks;
}

export function searchChunks(chunks: Chunk[], query: string, k = 5): RetrievalHit[] {
  const q = embed(query);
  return chunks
    .map((c) => ({
      path: c.path,
      startLine: c.startLine,
      score: cosine(q, c.vector),
      snippet: c.text.slice(0, 280),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((h) => h.score > 0);
}

function walk(dir: string, root: string, onFile: (file: string) => void): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    let jailed: string;
    try {
      jailed = assertPathInsideWorkspace(root, path.relative(root, full));
    } catch {
      continue;
    }
    let st: fs.Stats;
    try {
      st = fs.lstatSync(jailed);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(jailed, root, onFile);
    else if (st.isFile()) onFile(jailed);
  }
}
