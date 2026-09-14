// Migration write-flow test with a simulated Supabase RLS rejection.
// It never contacts a real browser, localStorage, or Supabase project.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function element() {
  return {
    hidden: false, disabled: false, textContent: "", innerHTML: "", listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; }
  };
}

const elements = Object.fromEntries([
  "migrationInspect", "migrationSummary", "migrationActions", "migrationResult", "migrationRun", "migrationBackup"
].map(id => [id, element()]));
let ready = null;
const inserts = [];
const errors = [];
const testConsole = { log: console.log, error: (...args) => errors.push(args) };
const owner = "11111111-1111-4111-8111-111111111111";
const error = { status: 403, code: "42501", message: "new row violates row-level security policy for table \"history_progress\"" };
const client = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      range: async () => ({ data: [], error: null }),
      insert: async payload => { inserts.push(payload); return { error }; }
    };
  }
};
const context = {
  console: testConsole, JSON, Error, Promise, setTimeout, Blob,
  localStorage: { getItem: () => JSON.stringify({ version: 1, days: { "1-1": true }, day2Choice: {}, quiz: {}, visits: {} }) },
  document: { getElementById: id => elements[id], createElement: () => element() },
  URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
  HistoryCloud: {
    STORAGE_KEY: "heeyoon-history-progress", TABLE: "history_progress",
    rows: () => ({ "day:1-1": { fieldKey: "day:1-1", value: true } }),
    migrationDecision: () => ({ new: 1, duplicate: 0, conflict: 0 })
  },
  window: {
    historyCloud: {
      migrationClient: () => client,
      migrationOwner: () => owner,
      migrationSession: () => ({ session: { user: { id: "22222222-2222-4222-8222-222222222222", role: "authenticated" } }, error: null })
    },
    addEventListener: (type, callback) => { if (type === "DOMContentLoaded") ready = callback; }
  }
};
vm.runInNewContext(fs.readFileSync("history-migration.js", "utf8"), context, { filename: "history-migration.js" });
ready();

(async () => {
  await elements.migrationInspect.listeners.click();
  assert.match(elements.migrationSummary.innerHTML, /현재 anonymous user ID:.*22222222-2222-4222-8222-222222222222/, "comparison exposes the non-secret auth and family-owner diagnostic");
  assert.match(elements.migrationSummary.innerHTML, /두 ID가 다른 것은 정상입니다/, "a different anonymous ID and family owner is explicitly identified as normal");
  elements.migrationRun.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(inserts)), [{ user_id: owner, field_key: "day:1-1", value: true }], "insert payload matches the table primary-key shape and uses the family owner");
  assert.match(elements.migrationResult.textContent, /^이전 실패: HTTP 403 · 42501/, "RLS failure is shown exactly and never reported as success");
  assert.equal(elements.migrationRun.disabled, false, "failed migration can be retried without changing local data");
  assert.equal(errors.length, 1, "write failure is logged once");
  assert.equal(errors[0][0], "한국사 기록 이전 실패");
  assert.deepEqual(JSON.parse(JSON.stringify(errors[0][1])), {
    status: 403, code: "42501", message: "new row violates row-level security policy for table \"history_progress\""
  }, "write failure logs Supabase's available structured error fields");
  console.log("PASS: failed INSERT exposes HTTP status, code, message, and preserves retry state.");
})().catch(error => { console.error(error); process.exitCode = 1; });
