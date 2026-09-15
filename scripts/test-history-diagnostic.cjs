// Read-only parent diagnostic tests. No browser or network is used.
const assert = require("node:assert/strict");
const HistoryCloud = require("../history-cloud.js");

class MemoryStorage {
  constructor(seed) { this.map = new Map(Object.entries(seed)); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  snapshot() { return [...this.map.entries()].sort((a, b) => a[0].localeCompare(b[0])); }
}

const prefix = "heeyoon-history:sync:v1:family:v1:";
const blank = () => ({ version: 1, days: {}, day2Choice: {}, quiz: {}, visits: {} });
const baseline = blank();
const local = blank();
local.days["3-1"] = true;
const operation = { fieldKey: "day:3-1", value: true, before: null, expected: null, revision: null, at: 1, conflict: true };
const storage = new MemoryStorage({
  [HistoryCloud.STORAGE_KEY]: JSON.stringify(local),
  [`${prefix}original:${HistoryCloud.STORAGE_KEY}`]: JSON.stringify(baseline),
  [`${prefix}op:retry`]: JSON.stringify(operation),
  [`${prefix}row:day:3-1`]: JSON.stringify({ fieldKey: "day:3-1", value: false, revision: 2, conflict: true })
});
const engine = HistoryCloud.create({ storage, online: () => false });
const before = storage.snapshot();
const report = engine.diagnostic("day:3-1", new Set());

assert.equal(report.local.field.value, true, "reads the current local DAY 3-1 value");
assert.equal(report.original.field.known, false, "reads the original snapshot without inventing a value");
assert.deepEqual(report.operations.map(op => ({ conflict: op.conflict, value: op.value, before: op.before, expected: op.expected, revision: op.revision })), [
  { conflict: true, value: true, before: null, expected: null, revision: null }
], "shows the exact queued operation fields");
assert.equal(report.rowMeta.revision, 2, "reads the row meta");
assert.deepEqual(report.recovery, { recover: false, reason: "이미 retry/op queue에 작업이 있음" }, "explains the exact no-recovery reason");
assert.deepEqual(storage.snapshot(), before, "diagnostic reads never modify localStorage or the queue");

const noQueueStorage = new MemoryStorage({
  [HistoryCloud.STORAGE_KEY]: JSON.stringify(local),
  [`${prefix}original:${HistoryCloud.STORAGE_KEY}`]: JSON.stringify(baseline)
});
const noQueueEngine = HistoryCloud.create({ storage: noQueueStorage });
const noQueueBefore = noQueueStorage.snapshot();
const recovery = noQueueEngine.diagnostic("day:3-1", new Set()).recovery;
assert.equal(recovery.recover, true, "reports YES only when recovery would queue the missing changed field");
assert.deepEqual(noQueueStorage.snapshot(), noQueueBefore, "a YES diagnosis itself still creates no queue operation");

console.log("PASS: DAY 3-1 diagnostic is localStorage/queue read-only and reports recovery reasons.");
