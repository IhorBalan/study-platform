import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = process.env.SUBMISSION_DIR ?? process.cwd();

// ---------------------------------------------------------------------------
// A small Dockerfile reader: joins line continuations, drops comments, splits
// the file into stages. It does not try to understand heredocs.
// ---------------------------------------------------------------------------

function readDockerfile() {
  const file = join(dir, 'Dockerfile');
  assert.ok(existsSync(file), 'Expected a file named Dockerfile at the root of the submission.');
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function parse(text) {
  const comments = [];
  const instructions = [];
  let current = null;

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('#')) {
      // Comment lines are allowed anywhere, including inside a continued instruction.
      comments.push(trimmed);
      continue;
    }
    if (trimmed === '') {
      // Blank lines inside a continuation are tolerated by the builder.
      continue;
    }
    const continues = /\\\s*$/.test(rawLine);
    const piece = rawLine.replace(/\\\s*$/, '').trim();
    current = current === null ? piece : `${current} ${piece}`;
    if (!continues) {
      instructions.push(current);
      current = null;
    }
  }
  if (current !== null) instructions.push(current);

  const stages = [];
  const globalArgs = new Map();
  for (const line of instructions) {
    const match = /^(\S+)\s*(.*)$/s.exec(line);
    const name = match[1].toUpperCase();
    const args = match[2].trim();
    if (name === 'FROM') {
      const tokens = args.split(/\s+/).filter((t) => !t.startsWith('--'));
      const asIndex = tokens.findIndex((t) => t.toUpperCase() === 'AS');
      stages.push({
        image: tokens[0] ?? '',
        alias: asIndex > 0 ? (tokens[asIndex + 1] ?? '').toLowerCase() : null,
        instructions: [],
      });
    } else if (stages.length === 0) {
      if (name === 'ARG') {
        const [key, ...rest] = args.split('=');
        globalArgs.set(key.trim(), rest.join('=').trim().replace(/^["']|["']$/g, ''));
      }
    } else {
      stages.at(-1).instructions.push({ name, args });
    }
  }
  return { stages, comments, globalArgs };
}

/** Follows `FROM earlier-stage` references back to a real image reference. */
function baseImageOf(parsed, stageIndex) {
  let index = stageIndex;
  for (let hops = 0; hops < parsed.stages.length; hops += 1) {
    const image = parsed.stages[index].image;
    const earlier = parsed.stages.findIndex((s, i) => i < index && s.alias === image.toLowerCase());
    if (earlier === -1) return image;
    index = earlier;
  }
  return parsed.stages[index].image;
}

function substituteArgs(image, globalArgs) {
  return image.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, key) =>
    globalArgs.has(key) && globalArgs.get(key) !== '' ? globalArgs.get(key) : whole,
  );
}

function splitImage(reference) {
  const [withoutDigest, digest = null] = reference.split('@');
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  const hasTag = lastColon > lastSlash;
  return {
    repository: hasTag ? withoutDigest.slice(0, lastColon) : withoutDigest,
    tag: hasTag ? withoutDigest.slice(lastColon + 1) : null,
    digest,
  };
}

/** Sources of a COPY/ADD instruction, without flags and without the destination. */
function copyParts(args) {
  const flags = [];
  let rest = args;
  for (;;) {
    const flag = /^(--\S+)\s+/.exec(rest);
    if (!flag) break;
    flags.push(flag[1]);
    rest = rest.slice(flag[0].length);
  }
  let items;
  if (rest.startsWith('[')) {
    try {
      items = JSON.parse(rest);
    } catch {
      items = [];
    }
  } else {
    items = rest.split(/\s+/);
  }
  items = items.map((item) => String(item).replace(/^["']|["']$/g, ''));
  const from = flags.find((f) => f.toLowerCase().startsWith('--from='));
  return {
    from: from ? from.slice('--from='.length).toLowerCase() : null,
    sources: items.slice(0, -1),
    destination: items.at(-1) ?? '',
  };
}

const isWholeContext = (source) => /^(\.|\.\/|\*|\.\/\*)$/.test(source);
const isSourceCode = (source) =>
  isWholeContext(source) || /^(\.\/)?(src|scripts|lib|app)(\/.*)?$/.test(source) || /\.(m?js|ts)$/.test(source);
const isManifest = (source) => /(^|\/)package(\*|-lock)?\.json$/.test(source) || /(^|\/)package\*\.json$/.test(source);
const installPattern = /\b(npm\s+(ci|install|i)|pnpm\s+(install|i)|yarn(\s+install)?)\b/;

function isExecForm(args) {
  if (!args.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(args);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function finalStage(parsed) {
  assert.ok(parsed.stages.length > 0, 'The Dockerfile has no FROM instruction.');
  return parsed.stages.at(-1);
}

// ---------------------------------------------------------------------------

test('multi-stage: the Dockerfile has at least two stages', () => {
  const parsed = parse(readDockerfile());
  assert.ok(
    parsed.stages.length >= 2,
    `Expected at least two FROM instructions (stages), found ${parsed.stages.length}.`,
  );
});

test('pinned-small-base: the final stage uses a slim, Alpine or distroless base pinned to a version', () => {
  const parsed = parse(readDockerfile());
  finalStage(parsed);
  const reference = substituteArgs(baseImageOf(parsed, parsed.stages.length - 1), parsed.globalArgs);
  assert.ok(
    !reference.includes('$'),
    `The final stage's base image is "${reference}". Write the image name and tag literally so it can be checked.`,
  );
  assert.notEqual(reference.toLowerCase(), 'scratch', 'A Node service cannot run FROM scratch; use a small Node base image.');

  const { repository, tag, digest } = splitImage(reference);
  const small = /slim|alpine/i.test(tag ?? '') || /distroless|chainguard/i.test(repository);
  assert.ok(
    small,
    `The final stage is based on "${reference}". Expected a slim or Alpine tag, or a distroless image.`,
  );
  assert.ok(
    digest !== null || tag !== null,
    `The final stage's base image "${reference}" has no tag, which means "latest". Pin a version.`,
  );
  assert.notEqual((tag ?? '').toLowerCase(), 'latest', `The final stage's base image "${reference}" uses the latest tag. Pin a version.`);
  const distroless = /distroless|chainguard/i.test(repository);
  assert.ok(
    digest !== null || distroless || /\d/.test(tag ?? ''),
    `The tag "${tag}" of the final stage's base image names a variant but no version. Include the version number.`,
  );
});

test('deps-before-source: the manifest is copied and dependencies are installed before the source is copied', () => {
  const parsed = parse(readDockerfile());
  const installingStages = parsed.stages.filter((stage) =>
    stage.instructions.some((i) => i.name === 'RUN' && installPattern.test(i.args)),
  );
  assert.ok(
    installingStages.length > 0,
    'No stage installs dependencies. Expected a RUN step with npm ci, npm install or the pnpm/yarn equivalent.',
  );

  for (const stage of installingStages) {
    const label = stage.alias ? `stage "${stage.alias}"` : `the stage FROM ${stage.image}`;
    const installIndex = stage.instructions.findIndex((i) => i.name === 'RUN' && installPattern.test(i.args));
    const before = stage.instructions.slice(0, installIndex).filter((i) => i.name === 'COPY' || i.name === 'ADD');
    const localCopies = before.map((i) => copyParts(i.args)).filter((c) => c.from === null);

    const early = localCopies.flatMap((c) => c.sources).filter(isSourceCode);
    assert.equal(
      early.length,
      0,
      `In ${label}, "${early[0]}" is copied before the dependency install, so every source edit invalidates the install layer.`,
    );
    const inherited = stage.image && parsed.stages.some((s) => s.alias === stage.image.toLowerCase());
    assert.ok(
      inherited || localCopies.some((c) => c.sources.some(isManifest)),
      `In ${label}, the install runs before package.json has been copied into the stage.`,
    );
  }
});

test('lean-final-stage: the final stage takes build output from an earlier stage and does not copy the whole context', () => {
  const parsed = parse(readDockerfile());
  const stage = finalStage(parsed);
  const copies = stage.instructions.filter((i) => i.name === 'COPY' || i.name === 'ADD').map((i) => copyParts(i.args));

  const earlierNames = new Set(
    parsed.stages.slice(0, -1).flatMap((s, index) => [String(index), ...(s.alias ? [s.alias] : [])]),
  );
  assert.ok(
    copies.some((c) => c.from !== null && earlierNames.has(c.from)),
    'The final stage has no COPY --from=<earlier stage>. The build output should come from the build stage.',
  );
  const whole = copies.find((c) => c.from === null && c.sources.some(isWholeContext));
  assert.equal(
    whole,
    undefined,
    'The final stage copies the whole build context. Copy only the files the running process needs.',
  );
  assert.ok(
    !stage.instructions.some((i) => i.name === 'RUN' && /\bnpm\s+run\s+build\b/.test(i.args)),
    'The final stage runs the build. Build in an earlier stage and copy the result.',
  );
});

test('non-root-user: the final stage runs as a non-root user', () => {
  const parsed = parse(readDockerfile());
  const stage = finalStage(parsed);
  const users = stage.instructions.filter((i) => i.name === 'USER');
  const base = splitImage(baseImageOf(parsed, parsed.stages.length - 1));
  if (users.length === 0 && /nonroot/i.test(base.tag ?? '')) return; // distroless :nonroot images

  assert.ok(users.length > 0, 'The final stage has no USER instruction, so the process runs as root.');
  const user = users.at(-1).args.split(':')[0].trim().toLowerCase();
  assert.ok(
    user !== 'root' && user !== '0' && user !== '',
    `The last USER instruction in the final stage is "${users.at(-1).args}", which is root.`,
  );
});

test('exec-form: the start command uses the exec form and starts node directly', () => {
  const parsed = parse(readDockerfile());
  const stage = finalStage(parsed);
  const entrypoint = stage.instructions.filter((i) => i.name === 'ENTRYPOINT').at(-1);
  const cmd = stage.instructions.filter((i) => i.name === 'CMD').at(-1);
  assert.ok(entrypoint || cmd, 'The final stage has neither CMD nor ENTRYPOINT.');

  const words = [];
  for (const instruction of [entrypoint, cmd]) {
    if (!instruction) continue;
    const exec = isExecForm(instruction.args);
    assert.ok(
      exec,
      `${instruction.name} ${instruction.args} is in shell form (or is not a valid JSON array of strings). Use the exec form.`,
    );
    words.push(...exec);
  }
  assert.ok(words.length > 0, 'The start command is empty.');
  const program = words[0].split('/').at(-1);
  assert.ok(
    !['npm', 'pnpm', 'yarn', 'npx', 'sh', 'bash', 'ash'].includes(program),
    `The container starts "${words[0]}", which puts another process between Docker and the server. Start node directly.`,
  );
});

test('dockerignore: .dockerignore excludes node_modules and .git', () => {
  const file = join(dir, '.dockerignore');
  assert.ok(existsSync(file), 'Expected a .dockerignore file next to the Dockerfile.');
  const patterns = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  const normalise = (pattern) =>
    pattern
      .replace(/^!/, '')
      .replace(/^\.?\//, '')
      .replace(/^\*\*\//, '')
      .replace(/\/(\*\*?)?$/, '');

  for (const wanted of ['node_modules', '.git']) {
    assert.ok(
      patterns.some((p) => !p.startsWith('!') && normalise(p) === wanted),
      `.dockerignore does not exclude ${wanted}.`,
    );
    assert.ok(
      !patterns.some((p) => p.startsWith('!') && normalise(p) === wanted),
      `.dockerignore re-includes ${wanted} with a "!" rule.`,
    );
  }
});

test('healthcheck: the final stage has a HEALTHCHECK or a documented reason for leaving it out', () => {
  const parsed = parse(readDockerfile());
  const stage = finalStage(parsed);
  const healthcheck = stage.instructions.filter((i) => i.name === 'HEALTHCHECK').at(-1);
  const documented = parsed.comments.some((c) => /^#\s*healthcheck\s*:\s*\S.{14,}/i.test(c));

  if (healthcheck) {
    const disabled = /^NONE\b/i.test(healthcheck.args);
    assert.ok(
      !disabled || documented,
      'HEALTHCHECK NONE disables the check. Add a real check, or a "# healthcheck: <reason>" comment that explains why.',
    );
    if (!disabled) {
      assert.match(
        healthcheck.args,
        /\bCMD\b/i,
        'The HEALTHCHECK instruction has options but no CMD to run.',
      );
    }
    return;
  }
  assert.ok(
    documented,
    'The final stage has no HEALTHCHECK, and no "# healthcheck: <reason>" comment explains why.',
  );
});
