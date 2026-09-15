// Isolated storage/auth/network mocks; never contacts the real Supabase project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const cloudSource = fs.readFileSync(path.join(__dirname, '../history-cloud.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const key = 'heeyoon-history-progress';
const prefix = 'heeyoon-history:sync:v1:family:v1:';
const blank = () => ({ version: 1, days: {}, day2Choice: {}, quiz: {}, visits: {} });
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const owner = '11111111-1111-4111-8111-111111111111';

class Storage {
  constructor() { this.map = new Map(); this.fail = () => false; this.events = []; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k, v) {
    this.events.push(k);
    if (this.fail(k)) throw Error('mock quota exceeded');
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  ops() { return [...this.map].filter(([k]) => k.startsWith(prefix + 'op:')).map(([k, v]) => ({ key: k, ...JSON.parse(v) })); }
}

function environment(search = '') {
  const storage = new Storage();
  const errors = [];
  const status = { textContent: '', addEventListener() {} };
  const win = {
    localStorage: storage, navigator: { onLine: true }, location: { search },
    console: { error: (...args) => errors.push(args) },
    document: { getElementById: () => status, addEventListener() {} },
    addEventListener() {}
  };
  vm.runInNewContext(cloudSource, { window: win, URLSearchParams, setTimeout, console: win.console });
  return { win, storage, errors, status };
}

function network(database = []) {
  const writes = [];
  let fail = false;
  const client = {
    from() {
      const filter = {};
      let mutation;
      const matching = () => database.filter(row => Object.entries(filter).every(([k, v]) => row[k] === v));
      const builder = {
        select() { return builder; }, eq(k, v) { filter[k] = v; return builder; },
        order() { return builder; }, range() { return Promise.resolve({ data: matching(), error: null }); },
        insert(payload) { mutation = { type: 'insert', payload }; return builder; },
        update(payload) { mutation = { type: 'update', payload }; return builder; },
        async maybeSingle() {
          if (!mutation) return { data: matching()[0] || null, error: null };
          writes.push({ ...mutation, filter: { ...filter } });
          if (fail) return { data: null, error: { code: 'mock-503', message: 'offline' } };
          let row;
          if (mutation.type === 'insert') {
            row = { ...mutation.payload, revision: 1 }; database.push(row);
          } else {
            row = matching()[0];
            if (row) Object.assign(row, mutation.payload);
          }
          return { data: row || null, error: null };
        }
      };
      return builder;
    }
  };
  return { client, database, writes, reject: value => { fail = value; } };
}

(async () => {
  // A/B: use the actual public save BEFORE init(), with no prior storage key.
  const env = environment();
  const cloud = env.win.historyCloud;
  const engine = cloud.engine();
  assert.ok(engine, 'engine exists synchronously at script evaluation');
  const next = blank(); next.days['4-1'] = true;
  cloud.save(blank(), next);
  assert.equal(JSON.parse(env.storage.getItem(key)).days['4-1'], true);
  assert.equal(env.storage.events[0], key, 'progress is written before snapshot/queue');
  assert.deepEqual(JSON.parse(env.storage.getItem(prefix + 'original:' + key)), blank());
  assert.equal(env.storage.ops().length, 1, 'pre-init unauthenticated save has a durable queue');
  const net = network();
  // Real startup waits for a mocked auth session, then resolves the family owner.
  let releaseAuth;
  net.client.auth = {
    onAuthStateChange() {},
    getSession: () => new Promise(resolve => { releaseAuth = resolve; })
  };
  net.client.rpc = async () => ({ data: owner, error: null });
  env.win.HEEYOON_SUPABASE_CONFIG = { projectUrl: 'https://mock.supabase.co', publishableKey: 'sb_publishable_mock' };
  env.win.supabase = { createClient: () => net.client };
  cloud.init({ onChange() {} });
  assert.equal(cloud.engine(), engine, 'init retains the same engine');
  assert.equal(net.writes.length, 0, 'no cloud write until auth is ready');
  releaseAuth({ data: { session: { user: { id: 'mock-session', role: 'authenticated' } } }, error: null });
  await settle();
  assert.equal(net.writes.length, 1, 'auth completion automatically sends existing queue');
  assert.equal(env.storage.ops().length, 0, 'queue removed only on success');
  assert.equal(env.errors.length, 0, 'normal startup has no console errors');

  // C/D and E-H: every select/clear and checkbox pair obeys the same contract.
  for (const [bucket, field, value] of [
    ['day2Choice', '4', 'book'], ['quiz', '4-0', 0], ['visits', '4', true],
    ['days', '4-1', true], ['days', '4-3', true]
  ]) {
    const e = environment(); const n = network(); const c = e.win.historyCloud;
    let previous = blank();
    for (const selected of [value, typeof value === 'boolean' ? false : null]) {
      const after = clone(previous);
      if (selected === null) delete after[bucket][field]; else after[bucket][field] = selected;
      c.engine().setUser(null);
      c.save(previous, after);
      await settle();
      assert.deepEqual(JSON.parse(e.storage.getItem(key)), after);
      assert.equal(e.storage.ops().length, 1, `${bucket}: auth-independent queue`);
      const opKey = e.storage.ops()[0].key;
      n.reject(true);
      c.engine().setClient(n.client); c.engine().setUser(owner);
      await settle();
      assert.deepEqual(JSON.parse(e.storage.getItem(key)), after, 'failed write preserves local state');
      assert.equal(e.storage.ops()[0].key, opKey, 'failed write preserves the same queue entry');
      assert.ok(e.errors.pop(), 'expected network failure is explicitly reported');
      n.reject(false);
      c.engine().setUser(null); c.engine().setUser(owner);
      await settle();
      assert.equal(e.storage.ops().length, 0, 'reconnection automatically retries');
      assert.equal(n.database[0].value, selected);
      previous = after;
    }
    assert.equal(e.errors.length, 0, 'no unexpected errors');
  }

  // Queue/backup quota failures preserve learning and exact intent, including a
  // tombstone, and retry local storage while auth is still unavailable.
  for (const failedSuffix of ['op:', 'original:']) {
    const e = environment(); const c = e.win.historyCloud;
    const before = blank(); before.day2Choice['4'] = 'book';
    e.storage.setItem(key, JSON.stringify(before));
    const after = blank();
    e.storage.fail = k => k.startsWith(prefix + failedSuffix);
    c.save(before, after);
    await settle();
    assert.deepEqual(JSON.parse(e.storage.getItem(key)), after);
    assert.match(e.status.textContent, /큐\/스냅샷 저장 실패/);
    assert.ok(e.errors.length, 'storage failure is logged');
    e.storage.fail = () => false;
    await c.engine().sync();
    assert.equal(e.storage.ops().length, 1);
    assert.equal(e.storage.ops()[0].value, null, 'clear intent survives queue failure');
    assert.deepEqual(JSON.parse(e.storage.getItem(prefix + 'original:' + key)), before);
    const n = network(); c.engine().setClient(n.client); c.engine().setUser(owner);
    await settle();
    assert.equal(e.storage.ops().length, 0);
    assert.equal(n.database[0].value, null);
  }

  // I: run the real app.js save function against an injected failing public API.
  // Isolate only its surrounding UI bindings; no rewritten save implementation.
  const e = environment();
  const saveCode = appSource.slice(appSource.indexOf('  function save()'), appSource.indexOf('  function isDayDone('));
  e.win.historyCloud.save = () => { throw Error('injected public save failure'); };
  const ctx = vm.createContext({ window: e.win, localStorage: e.storage, document: e.win.document,
    console: e.win.console, readOnlyDiagnostic: false, STORAGE_KEY: key,
    state: next, savedSnapshot: blank(), updateGlobalStats() {} });
  vm.runInContext(saveCode + '\nsave();', ctx);
  assert.equal(e.storage.ops().length, 1, 'app fallback records queue through the existing engine');
  assert.equal(JSON.parse(e.storage.getItem(key)).days['4-1'], true);
  assert.equal(e.errors.length, 1, 'public save failure is not swallowed');

  // If even direct commit fails, app reports local-only fallback and retains
  // savedSnapshot so the next save retries this exact outstanding change.
  const commit = e.win.historyCloud.engine().commit;
  e.win.historyCloud.engine().commit = () => { throw Error('injected commit failure'); };
  vm.runInContext('state.days["4-3"] = true; save();', ctx);
  assert.match(e.status.textContent, /동기화 큐 기록 실패/);
  assert.equal(ctx.savedSnapshot.days['4-3'], undefined);
  e.win.historyCloud.engine().commit = commit;
  vm.runInContext('save();', ctx);
  assert.ok(e.storage.ops().some(op => op.fieldKey === 'day:4-3'));

  // A new engine after reload can recover a missing meaningful row using the
  // persisted pre-edit snapshot when the earlier op write alone failed.
  const reload = environment();
  reload.storage.fail = k => k.startsWith(prefix + 'op:');
  reload.win.historyCloud.save(blank(), next);
  reload.storage.fail = () => false;
  const reloaded = reload.win.HistoryCloud.create({ storage: reload.storage });
  const reloadNet = network(); reloaded.setClient(reloadNet.client); reloaded.setUser(owner);
  await reloaded.sync();
  assert.equal(reloadNet.database[0].field_key, 'day:4-1');
  assert.equal(reloadNet.database[0].value, true);

  // A failed primary progress write cannot create an op for an unsaved change.
  const full = environment(); full.storage.fail = k => k === key;
  assert.throws(() => full.win.historyCloud.save(blank(), next), /quota/);
  assert.equal(full.storage.ops().length, 0);
  assert.equal(full.storage.getItem(key), null);

  // J: exactly 14 existing cloud rows, with one intentionally different local
  // value; only the newly clicked DAY 4-1 may be written.
  const j = environment(); const base = blank();
  const existing = Array.from({ length: 14 }, (_, i) => {
    base.quiz['legacy-' + i] = i;
    return { user_id: owner, field_key: 'quiz:legacy-' + i, value: i, revision: 5 };
  });
  base.quiz['legacy-0'] = 99;
  j.storage.setItem(key, JSON.stringify(base));
  const changed = clone(base); changed.days['4-1'] = true;
  j.win.historyCloud.save(base, changed);
  const frozen = clone(existing); const n = network(clone(existing));
  j.win.historyCloud.engine().setClient(n.client); j.win.historyCloud.engine().setUser(owner);
  await settle();
  assert.deepEqual(n.database.slice(0, 14), frozen, 'all 14 original cloud rows unchanged');
  assert.deepEqual(n.writes.map(w => w.payload.field_key || w.filter.field_key), ['day:4-1']);
  assert.equal(JSON.parse(j.storage.getItem(key)).quiz['legacy-0'], 99, 'conflicting local value preserved');
  assert.equal(j.errors.length, 0);

  const diagnostic = environment('?diagnostic=1');
  diagnostic.win.historyCloud.init({ onChange() {} });
  diagnostic.win.historyCloud.save(blank(), next);
  assert.equal(diagnostic.storage.events.length, 0, 'diagnostic mode remains read-only');
  console.log('PASS: A-J startup/auth queue, all learning controls, failure retry, app error, 14-row protection and read-only diagnostics.');
})().catch(error => { console.error(error); process.exitCode = 1; });
