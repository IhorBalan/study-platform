// A small YAML reader for Kubernetes manifests. Node built-ins only.
// It reads what manifests normally use: block mappings and sequences, plain and quoted scalars,
// one-line [..] and {..} collections, | and > block scalars, comments and several documents per file.
// Anchors, aliases, tags and multi-line flow collections are rejected with a message.

export class YamlError extends Error {}

function fail(n, message) {
  throw new YamlError(`line ${n}: ${message}`);
}

/** Cuts a trailing comment that is outside quotes. */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i);
    }
  }
  return text;
}

function plain(text, n) {
  if (/^[&*!]/.test(text)) fail(n, `anchors, aliases and tags are not supported by these checks: ${text}`);
  if (text === '' || text === '~' || text === 'null') return null;
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^[-+]?\d+$/.test(text)) return Number(text);
  if (/^[-+]?(\d+\.\d*|\.\d+)$/.test(text)) return Number(text);
  return text;
}

/** One-line flow collections such as ["ALL"] or {app: api}. */
function flow(text, n) {
  let i = 0;
  const ws = () => {
    while (text[i] === ' ') i++;
  };
  const scalar = (stops) => {
    ws();
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' && quote === '"' ? 2 : 1;
      if (j >= text.length) fail(n, `unclosed quote in ${text}`);
      const raw = text.slice(i, j + 1);
      i = j + 1;
      return quote === '"' ? JSON.parse(raw) : raw.slice(1, -1).replaceAll("''", "'");
    }
    let j = i;
    while (j < text.length && !stops.includes(text[j])) j++;
    const raw = text.slice(i, j).trim();
    i = j;
    return plain(raw, n);
  };
  const value = (stops) => {
    ws();
    if (text[i] === '[') {
      i++;
      const out = [];
      for (;;) {
        ws();
        if (text[i] === ']') break;
        out.push(value([',', ']']));
        ws();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') fail(n, `expected , or ] in ${text}. Keep a [..] list on one line.`);
      }
      i++;
      return out;
    }
    if (text[i] === '{') {
      i++;
      const out = {};
      for (;;) {
        ws();
        if (text[i] === '}') break;
        const key = scalar([':', ',', '}']);
        ws();
        if (text[i] !== ':') fail(n, `expected : after ${key} in ${text}`);
        i++;
        out[String(key)] = value([',', '}']);
        ws();
        if (text[i] === ',') i++;
        else if (text[i] !== '}') fail(n, `expected , or } in ${text}. Keep a {..} map on one line.`);
      }
      i++;
      return out;
    }
    return scalar(stops);
  };
  const out = value([]);
  ws();
  if (i < text.length) fail(n, `unexpected text after ${text.slice(0, i)}`);
  return out;
}

function scalar(text, n) {
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) return flow(t, n);
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      fail(n, `cannot read the double-quoted string ${t}`);
    }
  }
  if (t.startsWith("'")) {
    if (!t.endsWith("'") || t.length < 2) fail(n, `unclosed quote in ${t}`);
    return t.slice(1, -1).replaceAll("''", "'");
  }
  return plain(t, n);
}

const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'[\]{}#&*!|>%@`-][^#]*?|-[^\s#][^#]*?)\s*:(?:\s+(.*))?$/;

function parseDocument(lines) {
  let i = 0; // index into lines: { indent, text, n, raw }
  const peek = () => {
    while (i < lines.length && lines[i].text === '') i++;
    return lines[i];
  };

  function blockScalar(parentIndent, style) {
    const out = [];
    let indent = null;
    while (i < lines.length) {
      const line = lines[i];
      const blank = line.raw.trim() === '';
      const rawIndent = line.raw.length - line.raw.trimStart().length;
      if (!blank && rawIndent <= parentIndent) break;
      if (!blank && indent === null) indent = rawIndent;
      out.push(blank ? '' : line.raw.slice(indent ?? 0));
      i++;
    }
    while (out.length > 0 && out.at(-1) === '') out.pop();
    const body = style.startsWith('>') ? out.join(' ') : out.join('\n');
    return style.endsWith('-') ? body : `${body}\n`;
  }

  function block(indent) {
    const line = peek();
    if (!line || line.indent < indent) return null;
    return line.text.startsWith('- ') || line.text === '-' ? sequence(line.indent) : mapping(line.indent);
  }

  function valueAfterKey(rest, indent, n) {
    if (rest === undefined || rest === '') {
      const next = peek();
      if (next && next.indent > indent) return block(next.indent);
      if (next && next.indent === indent && (next.text.startsWith('- ') || next.text === '-')) return sequence(indent);
      return null;
    }
    if (/^[|>][-+]?$/.test(rest)) return blockScalar(indent, rest);
    return scalar(rest, n);
  }

  function mapping(indent) {
    const out = {};
    for (;;) {
      const line = peek();
      if (!line || line.indent < indent) break;
      if (line.indent > indent) fail(line.n, `unexpected indentation: ${line.text}`);
      if (line.text.startsWith('- ') || line.text === '-') break;
      const match = KEY.exec(line.text);
      if (!match) fail(line.n, `expected "key: value", found: ${line.text}`);
      const key = String(scalar(match[1], line.n));
      if (Object.hasOwn(out, key)) fail(line.n, `the key ${key} appears twice in one mapping`);
      i++;
      out[key] = valueAfterKey(match[2]?.trim(), indent, line.n);
    }
    return out;
  }

  function sequence(indent) {
    const out = [];
    for (;;) {
      const line = peek();
      if (!line || line.indent !== indent || !(line.text.startsWith('- ') || line.text === '-')) {
        if (line && line.indent > indent) fail(line.n, `unexpected indentation: ${line.text}`);
        break;
      }
      const rest = line.text.slice(1).trimStart();
      if (rest === '') {
        i++;
        const next = peek();
        out.push(next && next.indent > indent ? block(next.indent) : null);
      } else if (KEY.test(rest) && !/^["'[{]/.test(rest.replace(KEY, ''))) {
        // "- name: api": a mapping that starts on the dash line.
        const inner = indent + (line.text.length - rest.length);
        lines[i] = { ...line, indent: inner, text: rest };
        out.push(mapping(inner));
      } else {
        i++;
        out.push(scalar(rest, line.n));
      }
    }
    return out;
  }

  const first = peek();
  if (!first) return null;
  const doc = block(first.indent);
  const rest = peek();
  if (rest) fail(rest.n, `cannot place this line (check its indentation): ${rest.text}`);
  return doc;
}

/** Returns every non-empty document of the text. */
export function parseAll(text) {
  const docs = [];
  let current = [];
  const flush = () => {
    const doc = parseDocument(current);
    if (doc !== null) docs.push(doc);
    current = [];
  };
  text.split(/\r?\n/).forEach((raw, index) => {
    const n = index + 1;
    if (/^---(\s|$)/.test(raw)) {
      flush();
      return;
    }
    if (/^\.\.\.(\s|$)/.test(raw)) return;
    const lead = /^[ \t]*/.exec(raw)[0];
    const text = stripComment(raw).trim();
    if (text !== '' && lead.includes('\t')) fail(n, 'YAML does not allow tabs for indentation');
    current.push({ indent: lead.length, text, n, raw });
  });
  flush();
  return docs;
}
