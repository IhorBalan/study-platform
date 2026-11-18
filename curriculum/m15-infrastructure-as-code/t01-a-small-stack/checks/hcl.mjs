// A small, tolerant scanner for the HCL that OpenTofu reads (.tf and .tofu files).
// It finds blocks, their labels, nested blocks and attributes. It does not evaluate
// expressions: an attribute's value is kept as source text with comments removed.
// Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_-]/;

/**
 * Replaces every comment with spaces (keeping newlines) so later passes can ignore them.
 * Strings, templates and heredocs are copied through unchanged.
 */
export function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    if (c === '"') {
      i = skipString(src, i);
    } else if (c === '<' && src[i + 1] === '<' && heredocAt(src, i)) {
      i = skipHeredoc(src, i);
    } else if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      i = j;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Returns the index just after the string that starts at `i` (which must be a `"`). */
function skipString(src, i) {
  const n = src.length;
  i++;
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
    } else if (c === '"') {
      return i + 1;
    } else if ((c === '$' || c === '%') && src[i + 1] === '{') {
      if (src[i - 1] === c && src[i - 2] !== c) {
        // `$${` and `%%{` are escapes for a literal `${` or `%{`.
        i += 2;
        continue;
      }
      i = skipTemplate(src, i + 2);
    } else if (c === '\n') {
      // Quoted strings cannot span lines. Stop here so one bad quote does not eat the file.
      return i;
    } else {
      i++;
    }
  }
  return i;
}

/** Skips a template interpolation body that starts after `${`. Returns the index after the closing `}`. */
function skipTemplate(src, i) {
  const n = src.length;
  let depth = 1;
  while (i < n && depth > 0) {
    const c = src[i];
    if (c === '"') {
      i = skipString(src, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return i;
}

const HEREDOC_RE = /^<<(-?)([A-Za-z_][A-Za-z0-9_-]*)[ \t]*\r?\n/;

function heredocAt(src, i) {
  return HEREDOC_RE.test(src.slice(i, i + 200));
}

/** Returns the index just after a heredoc's closing marker line. */
function skipHeredoc(src, i) {
  const m = HEREDOC_RE.exec(src.slice(i, i + 200));
  const marker = m[2];
  let j = i + m[0].length;
  const n = src.length;
  while (j < n) {
    let e = src.indexOf('\n', j);
    if (e === -1) e = n;
    const line = src.slice(j, e).replace(/\r$/, '');
    if (line.trim() === marker) return e;
    j = e + 1;
  }
  return n;
}

/**
 * Parses HCL source text. Returns { body, errors }.
 * body is a list of items:
 *   { kind: 'attribute', name, value, line }
 *   { kind: 'block', type, labels: string[], body, line }
 */
export function parseHcl(source) {
  const src = stripComments(source.replace(/^﻿/, ''));
  const errors = [];
  const n = src.length;
  let i = 0;

  const lineAt = (pos) => {
    let line = 1;
    for (let k = 0; k < pos && k < n; k++) if (src[k] === '\n') line++;
    return line;
  };
  const skipBlank = () => {
    while (i < n && /[ \t\r\n]/.test(src[i])) i++;
  };
  const skipInline = () => {
    while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r')) i++;
  };
  const skipToNextLine = () => {
    while (i < n && src[i] !== '\n') i++;
  };

  /** Reads an expression until a newline or an unmatched `}` at depth 0. */
  const readExpression = () => {
    const start = i;
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '"') {
        i = skipString(src, i);
        continue;
      }
      if (c === '<' && src[i + 1] === '<' && heredocAt(src, i)) {
        i = skipHeredoc(src, i);
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (c === '\n' && depth === 0) {
        break;
      }
      i++;
    }
    return src.slice(start, i).trim();
  };

  const readIdent = () => {
    const start = i;
    if (i < n && IDENT_START.test(src[i])) {
      i++;
      while (i < n && IDENT_CHAR.test(src[i])) i++;
    }
    return src.slice(start, i);
  };

  const readQuotedLabel = () => {
    const start = i;
    i = skipString(src, i);
    const raw = src.slice(start, i);
    return raw.length >= 2 && raw.endsWith('"') ? unquote(raw) : raw.slice(1);
  };

  const parseBody = (closing) => {
    const body = [];
    for (;;) {
      skipBlank();
      if (i >= n) {
        if (closing) errors.push({ line: lineAt(n), message: 'a block is not closed: expected "}" before the end of the file' });
        return body;
      }
      if (src[i] === '}') {
        if (closing) {
          i++;
          return body;
        }
        errors.push({ line: lineAt(i), message: 'unexpected "}"' });
        i++;
        continue;
      }
      const itemStart = i;
      const name = readIdent();
      if (!name) {
        errors.push({ line: lineAt(i), message: `unexpected character ${JSON.stringify(src[i])}` });
        skipToNextLine();
        continue;
      }
      skipInline();
      if (src[i] === '=' && src[i + 1] !== '=') {
        i++;
        skipInline();
        const line = lineAt(itemStart);
        const value = readExpression();
        if (!value) errors.push({ line, message: `attribute "${name}" has no value` });
        body.push({ kind: 'attribute', name, value, line });
        continue;
      }
      // A block: labels (quoted strings or identifiers), then "{".
      const labels = [];
      let ok = true;
      for (;;) {
        skipInline();
        if (src[i] === '"') labels.push(readQuotedLabel());
        else if (i < n && IDENT_START.test(src[i])) labels.push(readIdent());
        else break;
      }
      skipInline();
      if (src[i] !== '{') {
        ok = false;
        errors.push({ line: lineAt(itemStart), message: `expected "=" or "{" after "${name}"` });
        skipToNextLine();
      }
      if (!ok) continue;
      i++;
      const line = lineAt(itemStart);
      const inner = parseBody(true);
      body.push({ kind: 'block', type: name, labels, body: inner, line });
    }
  };

  const body = parseBody(false);
  return { body, errors };
}

/** Turns a plain quoted HCL string into its text. Returns null for anything else. */
export function unquote(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!/^"(?:[^"\\\n]|\\.)*"$/.test(v)) return null;
  return v
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** True when the value is a quoted string without any interpolation. */
export function isLiteralString(value) {
  const s = unquote(value);
  return s !== null && !/\$\{|%\{/.test(s.replace(/\$\$\{|%%\{/g, ''));
}

export const blocks = (body, type, ...labels) =>
  body.filter(
    (item) =>
      item.kind === 'block' &&
      item.type === type &&
      labels.every((label, k) => label === undefined || item.labels[k] === label),
  );
export const block = (body, type, ...labels) => blocks(body, type, ...labels)[0];
export const attr = (body, name) => body.find((item) => item.kind === 'attribute' && item.name === name);
export const attrValue = (body, name) => attr(body, name)?.value;

/** Lists the .tf and .tofu files directly inside `dir`, sorted. */
export function configFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.tf') || f.endsWith('.tofu'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Loads every configuration file of one module directory and merges their bodies.
 * Each item gets a `file` property. Returns { files, body, errors }.
 */
export function loadModule(dir) {
  const files = configFiles(dir);
  const body = [];
  const errors = [];
  for (const file of files) {
    const parsed = parseHcl(fs.readFileSync(file, 'utf8'));
    for (const item of parsed.body) body.push({ ...item, file });
    for (const e of parsed.errors) errors.push({ ...e, file });
  }
  return { files, body, errors };
}

/** Walks a body and its nested blocks, calling `visit(item, parents)` for each item. */
export function walk(body, visit, parents = []) {
  for (const item of body) {
    visit(item, parents);
    if (item.kind === 'block') walk(item.body, visit, [...parents, item]);
  }
}

/** Collects references of the form prefix.name in an expression, for example var.x or local.tags. */
export function references(value, prefix) {
  if (!value) return [];
  const re = new RegExp(`(?<![A-Za-z0-9_.])${prefix.replace('.', '\\.')}\\.([A-Za-z_][A-Za-z0-9_-]*)`, 'g');
  return [...value.matchAll(re)].map((m) => m[1]);
}

/** Reads `key = "string"` from an object expression such as a required_providers entry. */
export function objectStringField(value, key) {
  if (!value) return null;
  const m = new RegExp(`(?:^|[\\s{,])"?${key}"?\\s*[=:]\\s*("(?:[^"\\\\\\n]|\\\\.)*")`).exec(value);
  return m ? unquote(m[1]) : null;
}
