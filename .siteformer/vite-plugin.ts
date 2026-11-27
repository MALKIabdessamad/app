/* eslint-disable */
/**
 * SiteFormer editor support. Development only (`vite dev`): a production build never includes it.
 *
 * - Tags each JSX element with where it is written (data-sf-loc="src/routes/index.tsx:20:5"),
 *   so the editor can point a direct edit or the AI at the exact line.
 * - Loads the editor bridge (bridge.js) in the browser. It only does anything inside the
 *   SiteFormer editor's preview frame.
 * - While the AI changes the site, holds back live updates, so the preview never shows
 *   half-written files or their errors; it shows the result when the AI is done. Errors show as
 *   a calm note in the editor, never as Vite's red overlay.
 *
 * Managed by SiteFormer: this folder is rewritten automatically. Keep `siteformer()` in vite.config.ts.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseSync, type Plugin } from "vite";

const BRIDGE_ID = "virtual:siteformer-bridge";
/** SiteFormer keeps an end time (epoch seconds) here while the AI works on the site. */
const HOLD_FILE = "/tmp/siteformer-hold";
/** Messages that would change what an open page shows. */
const HELD = new Set(["update", "full-reload", "prune"]);
const RESOLVED_BRIDGE_ID = "\0" + BRIDGE_ID;
/** Elements that can't take attributes. */
const SKIP = new Set(["Fragment", "React.Fragment"]);

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

function walk(value: unknown, visit: (node: AstNode) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const node = value as AstNode;
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key !== "parent") walk(node[key], visit);
  }
}

function nameOf(node: AstNode | undefined): string {
  if (!node) return "";
  if (node.type === "JSXIdentifier") return String(node["name"]);
  if (node.type === "JSXMemberExpression") {
    return `${nameOf(node["object"] as AstNode)}.${nameOf(node["property"] as AstNode)}`;
  }
  return "";
}

function holding(): boolean {
  try {
    return Number(readFileSync(HOLD_FILE, "utf8").trim()) * 1000 > Date.now();
  } catch {
    return false;
  }
}

/** 1-based line and column of each offset. */
function positions(code: string) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
}

export function siteformer(): Plugin {
  let root = process.cwd();
  return {
    name: "siteformer",
    apply: (_config, env) => env.command === "serve" && process.env["VITEST"] === undefined,
    enforce: "pre",
    config(config) {
      if (config.server?.hmr === false) return undefined;
      return { server: { hmr: { overlay: false } } };
    },
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const hot = (server.environments?.client?.hot ?? server.ws) as unknown as {
        send: (...args: Array<unknown>) => void;
      };
      const send = hot.send.bind(hot);
      let waiting: ReturnType<typeof setInterval> | undefined;
      hot.send = (...args) => {
        const type = (args[0] as { type?: unknown } | null)?.type;
        if (typeof type === "string" && HELD.has(type) && holding()) {
          // Once the AI is done, pages opened outside the editor reload (the editor reloads its
          // own preview).
          waiting ??= setInterval(() => {
            if (holding()) return;
            clearInterval(waiting);
            waiting = undefined;
            send({ type: "custom", event: "siteformer:resync", data: {} });
          }, 1000);
          return;
        }
        send(...args);
      };
    },
    resolveId(id) {
      return id === BRIDGE_ID ? RESOLVED_BRIDGE_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_BRIDGE_ID) return undefined;
      const file = join(root, ".siteformer", "bridge.js");
      this.addWatchFile(file);
      return readFileSync(file, "utf8");
    },
    transform(code, id, options) {
      const file = id.split("?")[0] ?? id;
      if (!/\.[jt]sx$/.test(file) || file.includes(`${sep}node_modules${sep}`)) return undefined;
      const rel = relative(root, file).split(sep).join("/");
      if (rel.startsWith("..")) return undefined;
      let program: unknown;
      try {
        program = parseSync(file, code).program;
      } catch {
        return undefined;
      }
      const at = positions(code);
      const inserts: Array<{ offset: number; text: string }> = [];
      walk(program, (node) => {
        if (node.type !== "JSXOpeningElement") return;
        const name = node["name"] as AstNode | undefined;
        if (!name || SKIP.has(nameOf(name))) return;
        const { line, column } = at(node.start);
        // An expression, so no file name character can break (or be decoded in) the attribute.
        inserts.push({ offset: name.end, text: ` data-sf-loc={${JSON.stringify(`${rel}:${line}:${column}`)}}` });
      });
      const client = this.environment
        ? this.environment.config.consumer === "client"
        : !options?.ssr;
      const loadBridge = client && rel === "src/routes/__root.tsx";
      if (inserts.length === 0 && !loadBridge) return undefined;
      let out = code;
      for (const { offset, text } of inserts.sort((a, b) => b.offset - a.offset)) {
        out = out.slice(0, offset) + text + out.slice(offset);
      }
      // Imports are hoisted, so appending keeps every line number unchanged. The insertions
      // only shift columns within lines, so no source map is needed for useful stack traces.
      if (loadBridge) out += `\nimport "${BRIDGE_ID}";\n`;
      return { code: out, map: null };
    },
  };
}
