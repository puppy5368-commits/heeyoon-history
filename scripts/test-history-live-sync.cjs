// Normal-learning sync tests. No browser, network, or real Supabase project is used.
const assert = require("node:assert/strict");
const HistoryCloud = require("../history-cloud.js");

class MemoryStorage {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const clone = value => JSON.parse(JSON.stringify(value));
const blank = () => ({ version: 1, days: {}, day2Choice: {}, quiz: {}, visits: {} });
const owner = "11111111-1111-4111-8111-111111111111";
const prefix = "heeyoon-history:sync:v1:family:v1:";
const settle = () => new Promise(resolve => setImmediate(resolve));

function migratedThirteen() {
  return {
    version: 1,
    days: { "1-1": true, "1-3": true, "2-1": true, "2-3": true },
    day2Choice: { "1": "book", "2": "video" },
    quiz: { "1-0": 0, "1-1": 1, "1-2": 2, "2-0": 0, "2-1": 1, "2-2": 2 },
    visits: { "2": true }
  };
}

function cloudRows(state) {
  return Object.values(HistoryCloud.rows(state)).map(row => ({
    user_id: owner, field_key: row.fieldKey, value: row.value, revision: 1
  }));
}

function createClient(database, writes, rejectWrite = () => null) {
  return {
    from() {
      const filter = {};
      let mutation = null;
      const builder = {
        select() { return builder; },
        eq(key, value) { filter[key] = value; return builder; },
        order() { return builder; },
        range() {
          return Promise.resolve({
            data: database.filter(row => Object.entries(filter).every(([key, value]) => row[key] === value)),
            error: null
          });
        },
        update(payload) { mutation = { type: "update", payload }; return builder; },
        insert(payload) { mutation = { type: "insert", payload }; return builder; },
        maybeSingle() {
          if (!mutation) {
            return Promise.resolve({
              data: database.find(row => Object.entries(filter).every(([key, value]) => row[key] === value)) || null,
              error: null
            });
          }
          writes.push({ ...mutation, filter: { ...filter } });
          const failure = rejectWrite(mutation, filter);
          if (failure) return Promise.resolve({ data: null, error: failure });
          if (mutation.type === "insert") {
            if (database.some(row => row.user_id === mutation.payload.user_id && row.field_key === mutation.payload.field_key)) {
              return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            }
            const row = { ...mutation.payload, revision: 1 };
            database.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          const index = database.findIndex(row => Object.entries(filter).every(([key, value]) => row[key] === value));
          if (index < 0) return Promise.resolve({ data: null, error: null });
          database[index] = { ...database[index], ...mutation.payload };
          return Promise.resolve({ data: database[index], error: null });
        }
      };
      return builder;
    }
  };
}

function pending(storage) {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter(key => key?.includes(":op:"));
}

(async () => {
  const storage = new MemoryStorage({ [HistoryCloud.STORAGE_KEY]: JSON.stringify(blank()) });
  const database = [];
  const writes = [];
  const statuses = [];
  let online = false;
  const engine = HistoryCloud.create({ storage, online: () => online, onStatus: status => statuses.push(status) });
  engine.setClient(createClient(database, writes));
  engine.setUser(owner);
  let state = blank();

  async function change(mutate) {
    const before = clone(state);
    mutate(state);
    engine.commit(before, state); // app.js save() invokes this after every learning control change.
    assert.deepEqual(JSON.parse(storage.getItem(HistoryCloud.STORAGE_KEY)), state, "localStorage is saved before any cloud request");
    online = true;
    await engine.sync();
    online = false;
  }

  await change(next => { next.days["3-1"] = true; });
  await change(next => { next.days["3-1"] = false; });
  await change(next => { next.days["3-3"] = true; });
  await change(next => { next.day2Choice[3] = "book"; });
  await change(next => { delete next.day2Choice[3]; });
  await change(next => { next.quiz["3-0"] = 2; });
  await change(next => { delete next.quiz["3-0"]; });
  await change(next => { next.visits[3] = true; });
  await change(next => { next.visits[3] = false; });

  const sent = writes.map(write => ({ fieldKey: write.payload.field_key || write.filter.field_key, value: write.payload.value }));
  assert.deepEqual(sent, [
    { fieldKey: "day:3-1", value: true },
    { fieldKey: "day:3-1", value: false },
    { fieldKey: "day:3-3", value: true },
    { fieldKey: "day2:3", value: "book" },
    { fieldKey: "day2:3", value: null },
    { fieldKey: "quiz:3-0", value: 2 },
    { fieldKey: "quiz:3-0", value: null },
    { fieldKey: "visit:3", value: true },
    { fieldKey: "visit:3", value: false }
  ], "DAY 1/3, DAY 2, quiz, visit, and their clears each create the exact cloud field write");
  assert.equal(database.find(row => row.field_key === "day:3-1").value, false, "a checkbox clear is also reflected remotely");
  assert.equal(pending(storage).length, 0, "successful writes leave no queued operation");
  assert.equal(statuses.some(status => status.includes("저장 실패")), false, "normal learning writes have no error status");

  const failedStorage = new MemoryStorage({ [HistoryCloud.STORAGE_KEY]: JSON.stringify(blank()) });
  const failedDatabase = [];
  const failedWrites = [];
  const failedStatuses = [];
  let fail = true;
  let failedOnline = false;
  const failedEngine = HistoryCloud.create({ storage: failedStorage, online: () => failedOnline, onStatus: status => failedStatuses.push(status) });
  failedEngine.setClient(createClient(failedDatabase, failedWrites, () => fail ? {
    status: 403, code: "42501", message: "new row violates row-level security policy", details: "mock", hint: "mock"
  } : null));
  failedEngine.setUser(owner);
  const failedBefore = blank();
  const failedAfter = blank();
  failedAfter.days["3-1"] = true;
  failedEngine.commit(failedBefore, failedAfter);
  // Expose the mock network only for the attempted write; the server rejects it.
  failedOnline = true;
  const originalRecoveryConsoleError = console.error;
  const writeErrors = [];
  console.error = (...args) => writeErrors.push(args);
  await failedEngine.sync();
  console.error = originalRecoveryConsoleError;
  assert.deepEqual(JSON.parse(failedStorage.getItem(HistoryCloud.STORAGE_KEY)), failedAfter, "a failed cloud write never removes the local check");
  assert.notEqual(JSON.parse(failedStorage.getItem(pending(failedStorage)[0])).conflict, true, "a write error stays retryable instead of being mislabeled as a conflict");
  assert.equal(failedStatuses.at(-1), "⚠️ 클라우드 저장 실패 (42501) · 이 기기 기록은 안전함", "the normal sync status is non-destructive and specific");
  assert.equal(writeErrors.length, 1, "a rejected normal write is logged once for diagnosis");
  assert.equal(writeErrors[0][0], "한국사 진도 클라우드 저장 실패");
  assert.equal(writeErrors[0][1].code, "42501");

  fail = false;
  await failedEngine.sync();
  assert.equal(failedDatabase.find(row => row.field_key === "day:3-1").value, true, "a later sync uploads the preserved operation");
  assert.equal(pending(failedStorage).length, 0, "the retry completes only after Supabase accepts the write");

  const legacyStorage = new MemoryStorage({ [HistoryCloud.STORAGE_KEY]: JSON.stringify(failedAfter) });
  const legacyDatabase = [];
  const legacyWrites = [];
  const legacyOp = "heeyoon-history:sync:v1:family:v1:op:legacy-write-error";
  legacyStorage.setItem(legacyOp, JSON.stringify({
    fieldKey: "day:3-1", value: true, before: null, expected: null, revision: null, at: 1, conflict: true
  }));
  const legacyEngine = HistoryCloud.create({ storage: legacyStorage, online: () => true });
  legacyEngine.setClient(createClient(legacyDatabase, legacyWrites));
  legacyEngine.setUser(owner);
  await legacyEngine.sync();
  assert.equal(legacyDatabase.find(row => row.field_key === "day:3-1").value, true, "an old false-conflict with no remote row is recovered safely");
  assert.equal(legacyStorage.getItem(legacyOp), null, "the recovered legacy operation is cleared only after upload");

  const migratedState = blank();
  migratedState.days["1-1"] = true;
  const migratedStorage = new MemoryStorage({ [HistoryCloud.STORAGE_KEY]: JSON.stringify(migratedState) });
  const migratedDatabase = [{ user_id: owner, field_key: "day:1-1", value: true, revision: 1 }];
  const migratedWrites = [];
  const migratedEngine = HistoryCloud.create({ storage: migratedStorage, online: () => true });
  migratedEngine.setClient(createClient(migratedDatabase, migratedWrites));
  migratedEngine.setUser(owner);
  await migratedEngine.sync();
  assert.equal(migratedWrites.length, 0, "already-migrated records are only read, never rewritten by ordinary sync");
  assert.deepEqual(JSON.parse(migratedStorage.getItem(HistoryCloud.STORAGE_KEY)), migratedState, "the migrated local record survives a reload merge unchanged");

  // Recovery A/E: 13 migrated rows remain untouched; only a post-baseline,
  // cloud-missing DAY 1 completion is queued and uploaded on the same load.
  const baseline = migratedThirteen();
  const recoveredLocal = clone(baseline);
  recoveredLocal.days["3-1"] = true;
  const recoveryStorage = new MemoryStorage({
    [HistoryCloud.STORAGE_KEY]: JSON.stringify(recoveredLocal),
    [`${prefix}original:${HistoryCloud.STORAGE_KEY}`]: JSON.stringify(baseline)
  });
  const recoveryDatabase = cloudRows(baseline);
  const recoveryWrites = [];
  const recoveryEngine = HistoryCloud.create({ storage: recoveryStorage, online: () => true });
  recoveryEngine.setClient(createClient(recoveryDatabase, recoveryWrites));
  recoveryEngine.setUser(owner);
  await recoveryEngine.sync();
  await settle();
  assert.deepEqual(recoveryWrites.map(write => write.payload.field_key || write.filter.field_key), ["day:3-1"], "the 13 existing cloud records are not rewritten; only missing day:3-1 is sent");
  assert.equal(recoveryDatabase.find(row => row.field_key === "day:3-1").value, true, "missing DAY 1 uploads without another learner click");
  assert.equal(pending(recoveryStorage).length, 0, "successful recovery removes its queue entry");
  await recoveryEngine.sync();
  assert.equal(recoveryWrites.length, 1, "a recovered field is not uploaded again after the next sync");

  // Recovery B: an existing cloud field with a different value is never queued
  // by the missing-row recovery, and the local value is preserved for conflict review.
  const conflictLocal = clone(recoveredLocal);
  const conflictStorage = new MemoryStorage({
    [HistoryCloud.STORAGE_KEY]: JSON.stringify(conflictLocal),
    [`${prefix}original:${HistoryCloud.STORAGE_KEY}`]: JSON.stringify(baseline)
  });
  const conflictDatabase = [...cloudRows(baseline), { user_id: owner, field_key: "day:3-1", value: false, revision: 1 }];
  const conflictWrites = [];
  const conflictEngine = HistoryCloud.create({ storage: conflictStorage, online: () => true });
  conflictEngine.setClient(createClient(conflictDatabase, conflictWrites));
  conflictEngine.setUser(owner);
  await conflictEngine.sync();
  assert.equal(JSON.parse(conflictStorage.getItem(HistoryCloud.STORAGE_KEY)).days["3-1"], true, "an existing, different cloud value never overwrites local completion automatically");
  assert.equal(conflictWrites.length, 0, "an existing cloud field is never auto-overwritten by recovery");

  // Recovery C: empty local/cloud fields never create a row.
  const emptyStorage = new MemoryStorage({
    [HistoryCloud.STORAGE_KEY]: JSON.stringify(blank()),
    [`${prefix}original:${HistoryCloud.STORAGE_KEY}`]: JSON.stringify(blank())
  });
  const emptyWrites = [];
  const emptyEngine = HistoryCloud.create({ storage: emptyStorage, online: () => true });
  emptyEngine.setClient(createClient([], emptyWrites));
  emptyEngine.setUser(owner);
  await emptyEngine.sync();
  assert.equal(emptyWrites.length, 0, "empty local/cloud state creates no recovery row");

  // Recovery D: an upload error preserves local data and its recovered queue;
  // the next explicit/initial sync can retry it safely.
  const retryStorage = new MemoryStorage({
    [HistoryCloud.STORAGE_KEY]: JSON.stringify(recoveredLocal),
    [`${prefix}original:${HistoryCloud.STORAGE_KEY}`]: JSON.stringify(baseline)
  });
  const retryDatabase = cloudRows(baseline);
  const retryWrites = [];
  const retryStatuses = [];
  let rejectRecovery = true;
  const retryEngine = HistoryCloud.create({ storage: retryStorage, online: () => true, onStatus: status => retryStatuses.push(status) });
  retryEngine.setClient(createClient(retryDatabase, retryWrites, () => rejectRecovery ? {
    status: 503, code: "mock-offline", message: "mock write failure"
  } : null));
  retryEngine.setUser(owner);
  const originalRetryConsoleError = console.error;
  const recoveryErrors = [];
  console.error = (...args) => recoveryErrors.push(args);
  await retryEngine.sync();
  await settle();
  console.error = originalRetryConsoleError;
  assert.deepEqual(JSON.parse(retryStorage.getItem(HistoryCloud.STORAGE_KEY)), recoveredLocal, "a failed recovery preserves the local completed DAY 1");
  assert.equal(pending(retryStorage).length, 1, "a failed recovery keeps one retry queue entry");
  assert.match(retryStatuses.at(-1), /클라우드 저장 실패 \(mock-offline\)/, "failed recovery reports a non-destructive sync error");
  assert.equal(recoveryErrors.length, 1, "failed recovery logs one structured diagnostic error");
  rejectRecovery = false;
  await retryEngine.sync();
  assert.equal(retryDatabase.find(row => row.field_key === "day:3-1").value, true, "the next sync retries and uploads the missing field");
  assert.equal(pending(retryStorage).length, 0, "the retry queue clears only after successful upload");

  console.log("PASS: all normal learning controls persist locally, queue exact cloud writes, and preserve/retry failures safely.");
})().catch(error => { console.error(error); process.exitCode = 1; });
