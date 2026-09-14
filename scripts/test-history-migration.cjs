// Parent comparison UI safety test. No browser storage or Supabase account is used.
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
const context = {
  console,
  JSON,
  Error,
  Promise,
  setTimeout,
  localStorage: { getItem: () => JSON.stringify({ version: 1, days: { "1-1": true }, day2Choice: {}, quiz: {}, visits: {} }) },
  document: { getElementById: id => elements[id], createElement: () => element() },
  URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
  Blob,
  HistoryCloud: {
    STORAGE_KEY: "heeyoon-history-progress",
    TABLE: "history_progress",
    rows: () => ({ "day:1-1": { fieldKey: "day:1-1", value: true } }),
    migrationDecision: () => ({ new: 0, duplicate: 0, conflict: 0 })
  },
  window: {
    historyCloud: {
      migrationClient: () => ({ from: () => ({}) }),
      migrationOwner: () => { throw Error("mock owner lookup failed"); }
    },
    addEventListener: (type, callback) => { if (type === "DOMContentLoaded") ready = callback; }
  }
};
vm.runInNewContext(fs.readFileSync("history-migration.js", "utf8"), context, { filename: "history-migration.js" });
ready();

(async () => {
  await elements.migrationInspect.listeners.click();
  assert.equal(elements.migrationInspect.disabled, false, "button is always restored in finally");
  assert.match(elements.migrationResult.textContent, /^비교하지 못했어요/, "failed read ends with a visible error, not a loading message");
  assert.match(elements.migrationSummary.innerHTML, /클라우드 비교 실패/, "stale result counts are not presented as confirmed");
  console.log("PASS: comparison errors leave the loading state and show a clear parent message.");
})().catch(error => { console.error(error); process.exitCode = 1; });
