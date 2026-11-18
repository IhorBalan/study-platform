import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = process.env.SUBMISSION_DIR ?? process.cwd();
const IMAGE = 'registry.example.com/report-worker:2.3.1';

// ---------------------------------------------------------------------------
// A small shell reader. It understands what a run.sh for this task needs:
// comments, backslash line continuations, single and double quotes, $(…),
// and commands separated by newlines, `;`, `&&` or `||`. Nothing is executed.
// ---------------------------------------------------------------------------

/** Splits a script into commands, each a list of words with the quotes removed. */
function shellCommands(source) {
  const text = source.replace(/\r\n/g, '\n');
  const commands = [];
  let words = [];
  let word = null; // null means "not inside a word"
  let i = 0;

  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  /** Copies a $(…) group verbatim, including nested quotes and parentheses. */
  const substitution = () => {
    let depth = 0;
    let out = '';
    for (; i < text.length; i += 1) {
      const c = text[i];
      out += c;
      if (c === '(') depth += 1;
      if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
    return out;
  };

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '\\' && next === '\n') {
      i += 2; // line continuation
    } else if (c === '\\' && next !== undefined) {
      word = (word ?? '') + next;
      i += 2;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      word = (word ?? '') + text.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === '"') {
      word = word ?? '';
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && text[i + 1] === '\n') {
          i += 2;
        } else if (text[i] === '\\' && '"\\$`'.includes(text[i + 1] ?? '')) {
          word += text[i + 1];
          i += 2;
        } else if (text[i] === '$' && text[i + 1] === '(') {
          word += '$';
          i += 1;
          word += substitution();
        } else {
          word += text[i];
          i += 1;
        }
      }
      i += 1;
    } else if (c === '$' && next === '(') {
      word = (word ?? '') + '$';
      i += 1;
      word += substitution();
    } else if (c === '#' && word === null) {
      while (i < text.length && text[i] !== '\n') i += 1; // comment to end of line
    } else if (c === '\n' || c === ';') {
      endCommand();
      i += 1;
    } else if ((c === '&' && next === '&') || (c === '|' && next === '|')) {
      endCommand();
      i += 2;
    } else if (c === ' ' || c === '\t') {
      endWord();
      i += 1;
    } else {
      word = (word ?? '') + c;
      i += 1;
    }
  }
  endCommand();
  return commands;
}

/** Index of the word after `docker run` / `docker container run`, or -1. */
function runStart(words) {
  let at = 0;
  while (['exec', 'sudo', 'command'].includes(words[at])) at += 1;
  if (words[at] !== 'docker') return -1;
  if (words[at + 1] === 'run') return at + 2;
  if (words[at + 1] === 'container' && words[at + 2] === 'run') return at + 3;
  return -1;
}

function loadRun() {
  const file = join(dir, 'run.sh');
  assert.ok(existsSync(file), 'Expected a file named run.sh at the root of the submission.');
  const commands = shellCommands(readFileSync(file, 'utf8'));
  const runs = commands.filter((words) => runStart(words) !== -1);
  assert.equal(runs.length, 1, `run.sh must contain exactly one docker run command, found ${runs.length}.`);
  const words = runs[0];
  const args = words.slice(runStart(words));
  const imageAt = args.lastIndexOf(IMAGE);
  // Options are everything before the image. Without the image, look at every word.
  return { args, imageAt, options: imageAt === -1 ? args : args.slice(0, imageAt) };
}

/** All values given for an option, in either `--flag value` or `--flag=value` form. */
function valuesOf(options, ...names) {
  const values = [];
  options.forEach((word, index) => {
    for (const name of names) {
      if (word === name && index + 1 < options.length) values.push(options[index + 1]);
      else if (word.startsWith(`${name}=`)) values.push(word.slice(name.length + 1));
    }
  });
  return values;
}

/** True for `--flag` and `--flag=true`. */
function hasSwitch(options, name) {
  return options.some((word) => word === name || word === `${name}=true`);
}

function single(options, label, ...names) {
  const values = valuesOf(options, ...names);
  assert.ok(values.length > 0, `The command has no ${label} option before the image name.`);
  assert.equal(values.length, 1, `The command sets ${label} ${values.length} times (${values.join(', ')}). Set it once.`);
  return values[0];
}

/** Parses the comma-separated key=value list of a --mount option. */
function mountSpec(value) {
  const spec = {};
  for (const part of value.split(',')) {
    const at = part.indexOf('=');
    if (at === -1) spec[part.trim().toLowerCase()] = 'true';
    else spec[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  spec.destination = spec.destination ?? spec.dst ?? spec.target;
  spec.source = spec.source ?? spec.src;
  return spec;
}

const stripSlash = (path) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

// ---------------------------------------------------------------------------

test('command-shape: one detached docker run named report-worker, with the image as the last word', () => {
  const { args, imageAt, options } = loadRun();
  assert.notEqual(imageAt, -1, `The docker run command does not use the image ${IMAGE}.`);
  assert.equal(
    imageAt,
    args.length - 1,
    `"${args.slice(imageAt + 1).join(' ')}" comes after the image name, so Docker passes it to the container as its command instead of treating it as options.`,
  );
  const detached = options.some((word) => word === '--detach' || word === '--detach=true' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(word));
  assert.ok(detached, 'The container is not started in the background (detached).');
  assert.equal(single(options, 'a container name (--name)', '--name'), 'report-worker', 'The container has the wrong name.');
});

test('memory-limit: memory is capped at 256 MiB', () => {
  const { options } = loadRun();
  const value = single(options, 'memory limit (--memory)', '--memory', '-m');
  assert.match(value, /^(256m(i?b)?|268435456b?)$/i, `The memory limit is "${value}", expected 256 MiB.`);
});

test('cpu-limit: CPU is capped at half a core', () => {
  const { options } = loadRun();
  const value = single(options, 'CPU limit (--cpus)', '--cpus');
  assert.ok(
    /^\d*\.?\d+$/.test(value) && Number(value) === 0.5,
    `The CPU limit is "${value}", expected half of one core.`,
  );
});

test('pids-limit: the number of processes is capped at 100', () => {
  const { options } = loadRun();
  const value = single(options, 'process limit (--pids-limit)', '--pids-limit');
  assert.equal(value, '100', `The process limit is "${value}", expected 100.`);
});

test('cap-drop-all: all capabilities are dropped and none is added back', () => {
  const { options } = loadRun();
  const dropped = valuesOf(options, '--cap-drop').map((v) => v.toUpperCase());
  assert.ok(dropped.includes('ALL'), `Capabilities dropped: ${dropped.join(', ') || 'none'}. Expected all of them to be dropped.`);
  const added = valuesOf(options, '--cap-add');
  assert.equal(added.length, 0, `The command adds capabilities back (${added.join(', ')}). This worker needs none.`);
  assert.ok(!hasSwitch(options, '--privileged'), 'The command still uses --privileged, which grants every capability and disables most isolation.');
});

test('no-new-privileges: the process cannot gain privileges after start', () => {
  const { options } = loadRun();
  const values = valuesOf(options, '--security-opt');
  assert.ok(
    values.some((v) => /^no-new-privileges([:=]true)?$/i.test(v)),
    `Security options found: ${values.join(', ') || 'none'}. Expected the option that blocks privilege escalation through setuid binaries.`,
  );
});

test('read-only-root: the root filesystem is read-only with a tmpfs at /tmp', () => {
  const { options } = loadRun();
  assert.ok(hasSwitch(options, '--read-only'), 'The root filesystem is still writable.');

  const tmpfsPaths = [
    ...valuesOf(options, '--tmpfs').map((v) => stripSlash(v.split(':')[0])),
    ...valuesOf(options, '--mount')
      .map(mountSpec)
      .filter((spec) => spec.type === 'tmpfs' && spec.destination)
      .map((spec) => stripSlash(spec.destination)),
  ];
  assert.ok(
    tmpfsPaths.includes('/tmp'),
    `tmpfs mounts found at: ${tmpfsPaths.join(', ') || 'none'}. The worker needs a writable in-memory /tmp.`,
  );
});

test('non-root-user: the process runs as UID and GID 10001', () => {
  const { options } = loadRun();
  const value = single(options, 'user (--user)', '--user', '-u');
  assert.equal(value, '10001:10001', `The user is "${value}", expected UID 10001 and GID 10001.`);
});

test('network: the container joins the reports-net network', () => {
  const { options } = loadRun();
  const value = single(options, 'network (--network)', '--network', '--net');
  assert.equal(value, 'reports-net', `The container joins "${value}", expected the user-defined network from the brief.`);
  const published = valuesOf(options, '--publish', '-p');
  assert.equal(published.length, 0, `The command publishes a port (${published.join(', ')}). The worker serves nothing to the host.`);
  assert.ok(!options.includes('-P') && !hasSwitch(options, '--publish-all'), 'The command publishes all exposed ports.');
});

test('config-read-only: ./config is bind-mounted read-only at /etc/worker', () => {
  const { options } = loadRun();
  const mounts = [];

  for (const value of valuesOf(options, '--volume', '-v')) {
    // SOURCE:TARGET[:OPTIONS]. $(…) may contain anything, so hide it before splitting.
    const held = [];
    const masked = value.replace(/\$\([^)]*\)|\$\{[^}]*\}/g, (m) => `\u0000${held.push(m) - 1}\u0000`);
    const parts = masked.split(':').map((p) => p.replace(/\u0000(\d+)\u0000/g, (_, n) => held[Number(n)]));
    if (parts.length < 2) continue;
    const mountOptions = (parts[2] ?? '').split(',');
    mounts.push({
      bind: /[/$~]/.test(parts[0]),
      source: parts[0],
      destination: stripSlash(parts[1]),
      readOnly: mountOptions.includes('ro') || mountOptions.includes('readonly'),
    });
  }
  for (const spec of valuesOf(options, '--mount').map(mountSpec)) {
    if (!spec.destination) continue;
    mounts.push({
      bind: spec.type === 'bind',
      source: spec.source ?? '',
      destination: stripSlash(spec.destination),
      readOnly: [spec.readonly, spec.ro].some((flag) => flag === 'true' || flag === '1'),
    });
  }

  const config = mounts.find((mount) => mount.destination === '/etc/worker');
  assert.ok(
    config,
    `Nothing is mounted at /etc/worker. Mount targets found: ${mounts.map((m) => m.destination).join(', ') || 'none'}.`,
  );
  assert.ok(
    config.bind,
    `"${config.source}" is not a host path, so Docker would create a named volume with that name instead of mounting the folder.`,
  );
  assert.match(
    stripSlash(config.source),
    /(^|\/)config$/,
    `The mount at /etc/worker comes from "${config.source}", expected the config folder next to run.sh.`,
  );
  assert.ok(config.readOnly, 'The config folder is mounted writable. The worker only reads it.');
  const socket = mounts.find((mount) => /docker\.sock$/.test(mount.source));
  assert.equal(socket, undefined, 'The Docker socket is mounted into the container, which gives it control of the host.');
});
