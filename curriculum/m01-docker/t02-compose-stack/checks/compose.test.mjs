import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = process.env.SUBMISSION_DIR ?? process.cwd();
const GENERATE = 'docker compose --profile admin config --no-interpolate --format json > compose.json';

// ---------------------------------------------------------------------------
// Helpers. compose.json is the output of `docker compose config`. With
// --no-interpolate some values keep their short string form, so every reader
// below accepts both the short and the normalised form.
// ---------------------------------------------------------------------------

function loadModel() {
  const file = join(dir, 'compose.json');
  assert.ok(existsSync(file), `compose.json is missing. Generate it with: ${GENERATE}`);
  const raw = readFileSync(file, 'utf8');
  assert.ok(raw.trim() !== '', `compose.json is empty. The config command probably failed; run it again: ${GENERATE}`);
  let model;
  try {
    model = JSON.parse(raw);
  } catch (error) {
    assert.fail(`compose.json is not valid JSON (${error.message}). Generate it with: ${GENERATE}`);
  }
  assert.ok(
    model !== null && typeof model === 'object' && model.services !== null && typeof model.services === 'object',
    'compose.json has no "services" object. It should be the output of docker compose config.',
  );
  return model;
}

function service(model, name) {
  const found = model.services[name];
  assert.ok(
    found !== null && typeof found === 'object',
    `compose.json has no service named "${name}". Found: ${Object.keys(model.services).join(', ') || 'none'}.`,
  );
  return found;
}

/** Replaces ${VAR:-default} and ${VAR-default} with the default; other references stay as written. */
function applyDefaults(value) {
  return String(value).replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}/g, '$1');
}

function ports(svc) {
  return (svc.ports ?? []).map((entry) => {
    if (entry !== null && typeof entry === 'object') {
      return {
        hostIp: entry.host_ip ? applyDefaults(entry.host_ip) : '',
        published: entry.published === undefined || entry.published === null ? null : String(entry.published),
        target: String(entry.target ?? ''),
        raw: JSON.stringify(entry),
      };
    }
    // Short syntax: [HOST_IP:][PUBLISHED:]TARGET[/PROTOCOL]. Hide ${…} so its colons do not confuse the split.
    const raw = String(entry);
    const held = [];
    let text = raw.replace(/\$\{[^}]*\}/g, (match) => `\u0000${held.push(match) - 1}\u0000`);
    text = text.replace(/\/(tcp|udp)$/i, '');
    let hostIp = '';
    const bracketed = /^\[([^\]]*)\]:/.exec(text);
    if (bracketed) {
      hostIp = bracketed[1];
      text = text.slice(bracketed[0].length);
    }
    const restore = (part) => part.replace(/\u0000(\d+)\u0000/g, (_, index) => held[Number(index)]);
    const parts = text.split(':').map(restore);
    if (!bracketed && parts.length >= 3) hostIp = parts.slice(0, -2).join(':');
    return {
      hostIp: applyDefaults(hostIp),
      published: parts.length >= 2 ? parts.at(-2) : null,
      target: parts.at(-1),
      raw,
    };
  });
}

function networksOf(svc) {
  if (Array.isArray(svc.networks)) return svc.networks.map(String);
  if (svc.networks !== null && typeof svc.networks === 'object') return Object.keys(svc.networks);
  return [];
}

function environmentOf(svc) {
  const env = svc.environment;
  if (Array.isArray(env)) {
    return env.map((item) => {
      const text = String(item);
      const at = text.indexOf('=');
      return at === -1 ? [text, null] : [text.slice(0, at), text.slice(at + 1)];
    });
  }
  if (env !== null && typeof env === 'object') return Object.entries(env);
  return [];
}

const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';

// ---------------------------------------------------------------------------

test('compose-json: compose.json exists, is valid JSON and defines the api, db and adminer services', () => {
  const model = loadModel();
  for (const name of ['api', 'db', 'adminer']) service(model, name);
});

test('named-volume: the database stores its data in a named volume', () => {
  const model = loadModel();
  const db = service(model, 'db');
  const declared = Object.keys(model.volumes ?? {});

  const mounts = (db.volumes ?? []).map((entry) => {
    if (entry !== null && typeof entry === 'object') {
      return { type: entry.type, source: entry.source ?? '', target: entry.target ?? '' };
    }
    const [source, target = ''] = String(entry).split(':');
    const isPath = /^[./~]/.test(source) || source.includes('$');
    return { type: isPath ? 'bind' : 'volume', source, target };
  });
  assert.ok(mounts.length > 0, 'The db service mounts no volume, so its data lives in the container and is lost with it.');

  const data = mounts.filter((m) => String(m.target).startsWith('/var/lib/postgresql'));
  assert.ok(
    data.length > 0,
    `No db mount targets the PostgreSQL data path. Found target(s): ${mounts.map((m) => m.target).join(', ')}.`,
  );
  const named = data.find((m) => m.type === 'volume' && m.source !== '');
  assert.ok(
    named,
    `The db data path is mounted as "${data[0].type}", expected a named volume (a bind mount or an anonymous volume does not count).`,
  );
  assert.ok(
    declared.includes(named.source),
    `The db service uses volume "${named.source}", which is not declared under the top-level volumes key.`,
  );
});

test('db-healthcheck: the database has a healthcheck', () => {
  const db = service(loadModel(), 'db');
  const check = db.healthcheck;
  assert.ok(check !== null && typeof check === 'object', 'The db service has no healthcheck.');
  assert.notEqual(check.disable, true, 'The db healthcheck is disabled.');
  const command = Array.isArray(check.test) ? check.test : check.test ? [String(check.test)] : [];
  assert.ok(command.length > 0, 'The db healthcheck has no test command.');
  assert.notEqual(String(command[0]).toUpperCase(), 'NONE', 'The db healthcheck test is NONE, which disables it.');
  const body = Array.isArray(check.test) ? command.slice(1).join(' ') : command.join(' ');
  assert.ok(body.trim() !== '', 'The db healthcheck names a test type but no command to run.');
});

test('waits-for-healthy-db: the API starts only after the database is healthy', () => {
  const api = service(loadModel(), 'api');
  const dependsOn = api.depends_on;
  assert.ok(dependsOn, 'The api service has no depends_on.');
  assert.ok(
    !Array.isArray(dependsOn),
    'The api service uses the short depends_on form, which only waits for the db container to start.',
  );
  assert.ok(dependsOn.db, `The api service does not depend on db. It depends on: ${Object.keys(dependsOn).join(', ') || 'nothing'}.`);
  assert.equal(
    dependsOn.db.condition,
    'service_healthy',
    `api waits for db with condition "${dependsOn.db.condition}", which does not wait for the healthcheck.`,
  );
});

test('loopback-ports: every published port is bound to 127.0.0.1', () => {
  const model = loadModel();
  for (const name of ['api', 'adminer']) {
    const published = ports(service(model, name)).filter((p) => p.published !== null);
    assert.ok(published.length > 0, `The ${name} service publishes no port, so it cannot be reached from the host.`);
  }
  const expectedTargets = { api: '3000' };
  for (const [name, target] of Object.entries(expectedTargets)) {
    const targets = ports(service(model, name)).map((p) => applyDefaults(p.target));
    assert.ok(
      targets.includes(target),
      `The ${name} service listens on container port ${target}, but its published ports target: ${targets.join(', ')}.`,
    );
  }
  for (const [name, svc] of Object.entries(model.services)) {
    for (const port of ports(svc ?? {})) {
      assert.ok(
        isLoopback(port.hostIp),
        `Service ${name} publishes ${port.raw} on ${port.hostIp === '' ? 'all interfaces' : port.hostIp}. Bind it to 127.0.0.1.`,
      );
    }
  }
});

test('internal-network: the database is only on an internal network that the API shares', () => {
  const model = loadModel();
  const db = service(model, 'db');
  const api = service(model, 'api');
  const internal = new Set(
    Object.entries(model.networks ?? {})
      .filter(([, definition]) => definition && definition.internal === true)
      .map(([name]) => name),
  );
  assert.ok(internal.size > 0, 'No top-level network is marked internal: true.');
  assert.ok(!db.network_mode, `The db service sets network_mode "${db.network_mode}" instead of joining a network.`);

  const dbNetworks = networksOf(db);
  assert.ok(
    dbNetworks.length > 0 && !dbNetworks.includes('default'),
    'The db service is on the default network. Attach it explicitly to an internal network only.',
  );
  const open = dbNetworks.filter((name) => !internal.has(name));
  assert.equal(open.length, 0, `The db service is attached to "${open[0]}", which is not an internal network.`);
  assert.equal(
    ports(db).length,
    0,
    'The db service publishes a port. That does not work from an internal-only network and is not wanted here.',
  );

  const apiNetworks = networksOf(api);
  assert.ok(
    apiNetworks.some((name) => dbNetworks.includes(name)),
    `api (${apiNetworks.join(', ') || 'default'}) and db (${dbNetworks.join(', ')}) share no network, so api cannot reach db.`,
  );
  const url = environmentOf(api).find(([key]) => key === 'DATABASE_URL');
  if (url && url[1]) {
    const host = /@([^:/?\s]+)/.exec(String(url[1]).replace(/\$\{[^}]*\}/g, 'x'));
    assert.ok(
      !host || !['localhost', '127.0.0.1'].includes(host[1]),
      `DATABASE_URL points at ${host?.[1]}, which inside the api container is the api container itself.`,
    );
  }
  assert.ok(
    apiNetworks.some((name) => !internal.has(name)),
    'The api service is only on internal networks, so its published port cannot work.',
  );
});

test('admin-profile: the admin tool is behind the admin profile and the core services are not', () => {
  const model = loadModel();
  const adminProfiles = service(model, 'adminer').profiles ?? [];
  assert.ok(
    adminProfiles.includes('admin'),
    `The adminer service has profiles [${adminProfiles.join(', ')}], expected it to include "admin".`,
  );
  for (const name of ['api', 'db']) {
    const profiles = service(model, name).profiles ?? [];
    assert.equal(
      profiles.length,
      0,
      `The ${name} service has profiles [${profiles.join(', ')}], so a plain "docker compose up" would not start it.`,
    );
  }
});

test('no-hardcoded-secrets: no password is written in the Compose file', () => {
  const model = loadModel();
  const regenerate = `If compose.yaml already uses \${…}, compose.json was generated without --no-interpolate; run: ${GENERATE}`;
  const secretName = /PASSWORD|PASSWD|SECRET|TOKEN/i;

  for (const [name, svc] of Object.entries(model.services)) {
    for (const [key, value] of environmentOf(svc ?? {})) {
      if (value === null || value === undefined || value === '') continue; // passed through from the shell
      const text = String(value);
      if (secretName.test(key) && !/_FILE$/i.test(key)) {
        assert.ok(
          text.includes('${'),
          `Service ${name} sets ${key} to a literal value. Use variable substitution or an env_file. ${regenerate}`,
        );
      }
      const credentials = /:\/\/[^/@\s]*?:([^@\s]+)@/.exec(text.replace(/\$\{[^}]*\}/g, '${VAR}'));
      if (credentials) {
        assert.ok(
          credentials[1].includes('${'),
          `Service ${name} has a literal password inside ${key}. Build the URL from a variable. ${regenerate}`,
        );
      }
    }
  }

  const db = service(model, 'db');
  const keys = environmentOf(db).map(([key]) => key);
  const hasEnvFile = Array.isArray(db.env_file) ? db.env_file.length > 0 : Boolean(db.env_file);
  const hasSecret = Array.isArray(db.secrets) && db.secrets.length > 0;
  assert.ok(
    keys.includes('POSTGRES_PASSWORD') || keys.includes('POSTGRES_PASSWORD_FILE') || hasEnvFile || hasSecret,
    'The db service receives no password: no POSTGRES_PASSWORD variable, env_file or secret. PostgreSQL will refuse to start.',
  );

  const api = service(model, 'api');
  const apiKeys = environmentOf(api).map(([key]) => key);
  const apiEnvFile = Array.isArray(api.env_file) ? api.env_file.length > 0 : Boolean(api.env_file);
  assert.ok(
    apiKeys.includes('DATABASE_URL') || apiEnvFile,
    'The api service receives no DATABASE_URL (neither in environment nor through an env_file).',
  );
});
