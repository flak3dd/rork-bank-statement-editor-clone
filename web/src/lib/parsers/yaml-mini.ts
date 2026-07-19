/**
 * Minimal YAML subset parser for bank templates.
 * Supports: maps, string lists, scalars, comments, multiline via > not supported.
 */
export function parseSimpleYaml(source: string): Record<string, unknown> {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, "  "))
    .filter((l) => l.trim() && !l.trim().startsWith("#"));

  const root: Record<string, unknown> = {};
  let i = 0;

  const indentOf = (line: string) => {
    const m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
  };

  const parseValue = (raw: string): unknown => {
    const v = raw.trim();
    if (v === "" || v === "|" || v === ">") return "";
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      return v.slice(1, -1);
    }
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null" || v === "~") return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };

  const parseBlock = (baseIndent: number): unknown => {
    if (i >= lines.length) return {};
    const first = lines[i];
    const ind = indentOf(first);

    // List of scalars or maps
    if (first.trim().startsWith("- ")) {
      const arr: unknown[] = [];
      while (i < lines.length && indentOf(lines[i]) === ind && lines[i].trim().startsWith("- ")) {
        const rest = lines[i].trim().slice(2);
        i += 1;
        if (rest.includes(":") && !rest.startsWith('"') && !rest.startsWith("'")) {
          // inline map start on list item — treat as scalar if simple
          const colon = rest.indexOf(":");
          const key = rest.slice(0, colon).trim();
          const val = rest.slice(colon + 1).trim();
          const obj: Record<string, unknown> = {};
          if (val) {
            obj[key] = parseValue(val);
          } else {
            obj[key] = parseBlock(ind + 2);
          }
          // subsequent indented keys for this list item
          while (
            i < lines.length &&
            indentOf(lines[i]) > ind &&
            !lines[i].trim().startsWith("- ")
          ) {
            const line = lines[i];
            const c = line.indexOf(":");
            if (c === -1) {
              i += 1;
              continue;
            }
            const k = line.slice(0, c).trim();
            const v = line.slice(c + 1).trim();
            i += 1;
            if (!v) obj[k] = parseBlock(indentOf(line) + 2);
            else obj[k] = parseValue(v);
          }
          arr.push(obj);
        } else if (!rest) {
          arr.push(parseBlock(ind + 2));
        } else {
          arr.push(parseValue(rest));
        }
      }
      return arr;
    }

    // Map
    const obj: Record<string, unknown> = {};
    while (i < lines.length && indentOf(lines[i]) >= baseIndent) {
      const line = lines[i];
      const indLine = indentOf(line);
      if (indLine < baseIndent) break;
      if (indLine > baseIndent && baseIndent > 0) break;
      if (line.trim().startsWith("- ")) {
        // nested list without key — stop
        break;
      }
      const trimmed = line.trim();
      const c = trimmed.indexOf(":");
      if (c === -1) {
        i += 1;
        continue;
      }
      const key = trimmed.slice(0, c).trim();
      const val = trimmed.slice(c + 1).trim();
      i += 1;
      if (!val) {
        // peek next
        if (i < lines.length && indentOf(lines[i]) > indLine) {
          obj[key] = parseBlock(indLine + 2);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseValue(val);
      }
      // only consume siblings at same indent
      while (i < lines.length && indentOf(lines[i]) > indLine) {
        // already consumed nested via parseBlock; if leftover nested keys after scalar, skip
        if (obj[key] !== null && typeof obj[key] !== "object") {
          i += 1;
        } else break;
      }
    }
    return obj;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (indentOf(line) !== 0) {
      i += 1;
      continue;
    }
    const trimmed = line.trim();
    const c = trimmed.indexOf(":");
    if (c === -1) {
      i += 1;
      continue;
    }
    const key = trimmed.slice(0, c).trim();
    const val = trimmed.slice(c + 1).trim();
    i += 1;
    if (!val) {
      root[key] = parseBlock(2);
    } else {
      root[key] = parseValue(val);
    }
  }

  return root;
}
