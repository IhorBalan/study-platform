// Shared helpers for the workflow checks: a small YAML reader and accessors for
// GitHub Actions workflows. The sandbox has no YAML package, so this file reads
// the subset of YAML that workflow files use: block mappings and sequences,
// flow collections ([a, b] and { a: b }), plain and quoted scalars, block
// scalars (| and >), and comments. Anchors, aliases and tags are rejected with
// a clear message.

import fs from 'node:fs';
import path from 'node:path';

export class YamlError extends Error {}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      // A quote only opens a quoted scalar at the start of a token.
      if (i === 0 || /[\s[{,:-]/.test(text[i - 1])) quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

/** Index of the ": " (or trailing ":") that separates a key from its value, or -1. */
function keySeparator(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if ((c === '"' || c === "'") && (i === 0 || /[\s[{,]/.test(text[i - 1]))) quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0 && (i === text.length - 1 || /\s/.test(text[i + 1]))) return i;
  }
  return -1;
}

function unquote(raw, lineNo) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError(`line ${lineNo}: unterminated double-quoted string`);
    return s
      .slice(1, -1)
      .replace(/\\(["\\/nrt0]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (_, e) => {
        const map = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', 0: '\0' };
        if (e in map) return map[e];
        return String.fromCharCode(parseInt(e.slice(1), 16));
      });
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError(`line ${lineNo}: unterminated single-quoted string`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return undefined;
}

function plainScalar(raw, lineNo) {
  const s = raw.trim();
  const quoted = unquote(s, lineNo);
  if (quoted !== undefined) return quoted;
  if (/^[&*!]/.test(s)) throw new YamlError(`line ${lineNo}: anchors, aliases and tags are not supported by the checker`);
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseFlow(text, lineNo) {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const scalarUntil = (stops) => {
    ws();
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i];
      let j = i + 1;
      while (j < text.length) {
        if (q === '"' && text[j] === '\\') j += 2;
        else if (text[j] === q && q === "'" && text[j + 1] === "'") j += 2;
        else if (text[j] === q) break;
        else j++;
      }
      const raw = text.slice(i, j + 1);
      i = j + 1;
      return unquote(raw, lineNo);
    }
    let j = i;
    while (j < text.length && !stops.includes(text[j])) {
      if (text[j] === ':' && stops.includes(':') && /[\s,}\]]/.test(text[j + 1] ?? ' ')) break;
      j++;
    }
    const raw = text.slice(i, j);
    i = j;
    return plainScalar(raw, lineNo);
  };
  const value = () => {
    ws();
    if (text[i] === '[') {
      i++;
      const out = [];
      ws();
      if (text[i] === ']') {
        i++;
        return out;
      }
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ',') {
          i++;
          ws();
          if (text[i] === ']') {
            i++;
            return out;
          }
        } else if (text[i] === ']') {
          i++;
          return out;
        } else throw new YamlError(`line ${lineNo}: expected "," or "]" in a flow sequence`);
      }
    }
    if (text[i] === '{') {
      i++;
      const out = {};
      ws();
      if (text[i] === '}') {
        i++;
        return out;
      }
      for (;;) {
        const key = scalarUntil([':', ',', '}']);
        ws();
        let v = null;
        if (text[i] === ':') {
          i++;
          v = value();
        }
        out[String(key)] = v;
        ws();
        if (text[i] === ',') {
          i++;
          ws();
          if (text[i] === '}') {
            i++;
            return out;
          }
        } else if (text[i] === '}') {
          i++;
          return out;
        } else throw new YamlError(`line ${lineNo}: expected "," or "}" in a flow mapping`);
      }
    }
    return scalarUntil([',', ']', '}']);
  };
  const result = value();
  ws();
  if (i !== text.length) throw new YamlError(`line ${lineNo}: unexpected text after a flow collection: "${text.slice(i)}"`);
  return result;
}

function bracketBalance(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth;
}

/** Parses a YAML document in the subset that GitHub Actions workflows use. */
export function parseYaml(source) {
  const raw = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const lines = raw.map((text, n) => ({ n: n + 1, raw: text }));
  let pos = 0;

  const isBlank = (l) => {
    const t = l.raw.trim();
    return t === '' || t.startsWith('#') || t === '---' || t.startsWith('%');
  };
  const indentOf = (l) => {
    const m = /^( *)/.exec(l.raw);
    if (/^ *\t/.test(l.raw)) throw new YamlError(`line ${l.n}: tabs are not allowed for indentation`);
    return m[1].length;
  };
  const peek = () => {
    while (pos < lines.length && !lines[pos].override && isBlank(lines[pos])) pos++;
    if (pos >= lines.length) return null;
    const l = lines[pos];
    if (l.override) return l.override;
    if (l.raw.trim() === '...') return null;
    return { n: l.n, indent: indentOf(l), text: stripComment(l.raw.slice(indentOf(l))) };
  };
  const advance = () => {
    lines[pos].override = undefined;
    lines[pos].done = true;
    pos++;
  };

  // Folding (">"): a single line break between two plain lines becomes a space.
  // Empty lines and more-indented lines keep their line breaks.
  function fold(body) {
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const line = body[i];
      if (i === 0) {
        out = line;
        continue;
      }
      const prev = body[i - 1];
      const joinable = line !== '' && prev !== '' && !/^\s/.test(line) && !/^\s/.test(prev);
      if (joinable) out += ' ' + line;
      else if (line === '' ) out += '\n';
      else if (prev === '') out += line;
      else out += '\n' + line;
    }
    return out;
  }

  function blockScalar(header, parentIndent, lineNo) {
    const m = /^([|>])([-+]?)(\d?)([-+]?)$/.exec(header);
    if (!m) throw new YamlError(`line ${lineNo}: unsupported block scalar header "${header}"`);
    const folded = m[1] === '>';
    const chomp = m[2] || m[4] || '';
    const body = [];
    let blockIndent = null;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.raw.trim() === '') {
        body.push('');
        pos++;
        continue;
      }
      const ind = /^( *)/.exec(l.raw)[1].length;
      if (blockIndent === null) {
        if (ind <= parentIndent) break;
        blockIndent = ind;
      }
      if (ind < blockIndent) break;
      body.push(l.raw.slice(blockIndent));
      pos++;
    }
    // Trailing blank lines belong to chomping, not to the next node.
    let trailing = 0;
    while (body.length && body[body.length - 1] === '') {
      body.pop();
      trailing++;
    }
    let text = folded ? fold(body) : body.join('\n');
    if (body.length === 0) return '';
    if (chomp === '-') return text;
    if (chomp === '+') return text + '\n'.repeat(trailing + 1);
    return text + '\n';
  }

  function inlineValue(text, l, parentIndent) {
    const v = text.trim();
    if (/^[|>]/.test(v)) {
      advance();
      return blockScalar(v, parentIndent, l.n);
    }
    if (v.startsWith('[') || v.startsWith('{')) {
      let joined = v;
      advance();
      while (bracketBalance(joined) > 0) {
        const next = peek();
        if (!next) throw new YamlError(`line ${l.n}: unclosed flow collection`);
        joined += ' ' + next.text.trim();
        advance();
      }
      return parseFlow(joined, l.n);
    }
    if (!/^["']/.test(v) && /:( |$)/.test(v)) {
      throw new YamlError(`line ${l.n}: a plain value cannot contain ": "; put the whole value in quotes or use a block scalar (|)`);
    }
    advance();
    // A plain scalar may continue on more-indented lines.
    let value = v;
    for (;;) {
      const next = peek();
      if (!next || next.indent <= parentIndent) break;
      if (unquote(v, l.n) !== undefined) throw new YamlError(`line ${next.n}: unexpected indentation`);
      value += ' ' + next.text.trim();
      advance();
    }
    return plainScalar(value, l.n);
  }

  function node(minIndent) {
    const l = peek();
    if (!l || l.indent < minIndent) return null;
    if (l.text === '-' || l.text.startsWith('- ')) return sequence(l.indent);
    if (keySeparator(l.text) !== -1) return mapping(l.indent);
    return inlineValue(l.text, l, l.indent - 1);
  }

  function mapping(indent) {
    const out = {};
    for (;;) {
      const l = peek();
      if (!l || l.indent < indent) return out;
      if (l.indent > indent) throw new YamlError(`line ${l.n}: unexpected indentation`);
      if (l.text === '-' || l.text.startsWith('- ')) {
        throw new YamlError(`line ${l.n}: a list item where a "key: value" line was expected`);
      }
      const sep = keySeparator(l.text);
      if (sep === -1) throw new YamlError(`line ${l.n}: expected "key: value", found "${l.text}"`);
      const rawKey = l.text.slice(0, sep).trim();
      const key = String(unquote(rawKey, l.n) ?? rawKey);
      if (Object.hasOwn(out, key)) throw new YamlError(`line ${l.n}: duplicate key "${key}"`);
      const rest = l.text.slice(sep + 1).trim();
      if (rest === '') {
        advance();
        const next = peek();
        if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) {
          out[key] = sequence(indent);
        } else {
          out[key] = node(indent + 1);
        }
      } else {
        out[key] = inlineValue(rest, l, indent);
      }
    }
  }

  function sequence(indent) {
    const out = [];
    for (;;) {
      const l = peek();
      if (!l || l.indent < indent) return out;
      if (l.indent > indent) throw new YamlError(`line ${l.n}: unexpected indentation`);
      if (!(l.text === '-' || l.text.startsWith('- '))) return out;
      const content = l.text.slice(1).replace(/^ +/, '');
      if (content === '') {
        advance();
        out.push(node(indent + 1));
        continue;
      }
      const offset = indent + (l.text.length - content.length);
      const isNested = content === '-' || content.startsWith('- ') || keySeparator(content) !== -1;
      if (isNested) {
        // Re-read the rest of this line as if it started at its own column.
        lines[pos].override = { n: l.n, indent: offset, text: content };
        out.push(content === '-' || content.startsWith('- ') ? sequence(offset) : mapping(offset));
      } else {
        out.push(inlineValue(content, l, indent));
      }
    }
  }

  const first = peek();
  if (!first) return null;
  const doc = node(0);
  const rest = peek();
  if (rest) throw new YamlError(`line ${rest.n}: could not parse "${rest.text}"`);
  return doc;
}

// ---- workflow helpers ----

export function findWorkflowFiles(dir) {
  const wfDir = path.join(dir, '.github', 'workflows');
  if (!fs.existsSync(wfDir)) return [];
  return fs
    .readdirSync(wfDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => path.join(wfDir, f));
}

export function loadWorkflow(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return parseYaml(text);
  } catch (error) {
    if (error instanceof YamlError) {
      throw new Error(`${path.basename(file)} could not be read as YAML: ${error.message}`);
    }
    throw error;
  }
}

/** The `on:` section normalised to an object keyed by event name. */
export function triggers(wf) {
  const on = wf.on ?? wf.true;
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, {}]));
  if (on && typeof on === 'object') {
    return Object.fromEntries(Object.entries(on).map(([k, v]) => [k, v ?? {}]));
  }
  return {};
}

export function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function jobsOf(wf) {
  const jobs = wf?.jobs;
  return jobs && typeof jobs === 'object' && !Array.isArray(jobs) ? jobs : {};
}

export function stepsOf(job) {
  return Array.isArray(job?.steps) ? job.steps.filter((s) => s && typeof s === 'object') : [];
}

/** Every `uses:` reference in the workflow, at step and job level. */
export function allUses(wf) {
  const out = [];
  for (const [jobId, job] of Object.entries(jobsOf(wf))) {
    if (typeof job?.uses === 'string') out.push({ jobId, uses: job.uses });
    for (const step of stepsOf(job)) {
      if (typeof step.uses === 'string') out.push({ jobId, uses: step.uses });
    }
  }
  return out;
}

export function actionName(uses) {
  return String(uses).split('@')[0].toLowerCase();
}

/** True for a reference pinned to an immutable commit or image digest. */
export function isPinned(uses) {
  if (uses.startsWith('./')) return true;
  if (uses.startsWith('docker://')) return /@sha256:[0-9a-f]{64}$/.test(uses);
  return /^[^@\s]+@[0-9a-f]{40}$/.test(uses);
}

/** Permission scopes as an object; the string forms read-all and write-all are kept as strings. */
export function permissionWrites(perms) {
  if (perms === undefined || perms === null) return [];
  if (typeof perms === 'string') return perms === 'read-all' ? [] : [perms];
  return Object.entries(perms)
    .filter(([, v]) => v === 'write')
    .map(([k]) => k);
}

export function runText(step) {
  return typeof step?.run === 'string' ? step.run : '';
}
