// Browser-like wiring test for the read-only diagnostic button.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function element(id) {
  return { id, hidden: true, disabled: false, dataset: {}, textContent: "", innerHTML: "", href: "" };
}

(async () => {
  const link = element("readonlyDiagnosticLink");
  const run = element("readonlyDiagnosticRun");
  const status = element("readonlyDiagnosticStatus");
  const result = element("readonlyDiagnosticResult");
  const elements = new Map([[link.id, link], [run.id, run], [status.id, status], [result.id, result]]);
  const documentListeners = new Map();
  const document = {
    readyState: "complete",
    scripts: [
      { dataset: { historyCloudBuild: "history-cloud-2026-09-15-diagnostic-1" }, src: "https://example.test/history-cloud.js?build=history-cloud-2026-09-15-diagnostic-1" },
      { dataset: { historyDiagnosticBuild: "history-diagnostic-2026-09-15-click-fix-1" }, src: "https://example.test/history-diagnostic.js?build=history-diagnostic-2026-09-15-click-fix-1" }
    ],
    getElementById: id => elements.get(id) || null,
    addEventListener: (name, listener) => documentListeners.set(name, listener)
  };
  let readCalls = 0;
  const window = {
    location: { href: "https://example.test/?diagnostic=1", search: "?diagnostic=1" },
    historyCloud: {
      build: () => "history-cloud-2026-09-15-diagnostic-1",
      readOnlyDiagnostic: async () => {
        readCalls++;
        return {
          local: {
            local: { valid: true, field: { known: true, value: true } },
            original: { valid: true, field: { known: false, value: null } },
            operations: [], rowMeta: null,
            recovery: { recover: true, reason: "cloud 행 없음" }
          },
          cloud: { queried: true, row: null, rowCount: 0 }
        };
      }
    },
    HistoryCloud: { BUILD: "history-cloud-2026-09-15-diagnostic-1" },
    serviceWorker: undefined
  };
  const context = {
    window, document,
    navigator: { serviceWorker: { getRegistration: async () => null, controller: null } },
    caches: { keys: async () => [] },
    URL, URLSearchParams,
    Object, Array, String, JSON, Promise, Error,
    console: { error: error => { throw error; } }
  };
  vm.runInNewContext(fs.readFileSync("history-diagnostic.js", "utf8"), context, { filename: "history-diagnostic.js" });

  assert.equal(window.historyDiagnostic.build, "history-diagnostic-2026-09-15-click-fix-1", "script executed");
  assert.equal(run.hidden, false, "configure found and revealed #readonlyDiagnosticRun");
  assert.equal(run.dataset.diagnosticReady, "true", "configure marked the button ready");
  assert.match(status.textContent, /진단 준비됨/, "configure left visible readiness feedback");
  assert.equal(typeof documentListeners.get("click"), "function", "document-level click delegation is attached");

  documentListeners.get("click")({
    preventDefault() {},
    target: { closest: selector => selector === "#readonlyDiagnosticRun" ? run : null }
  });
  assert.match(status.textContent, /진단 시작됨/, "click immediately updates the status before reads finish");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readCalls, 1, "click calls window.historyCloud.readOnlyDiagnostic exactly once");
  assert.equal(result.hidden, false, "click opens the result region");
  assert.match(result.innerHTML, /days\["3-1"\]: <code>true<\/code>/, "localStorage diagnostic result is rendered");
  assert.match(status.textContent, /진단 완료/, "click reaches completion without a JavaScript error");
  console.log("PASS: diagnostic script configures after DOM readiness and delegated click renders a read-only result.");
})().catch(error => { console.error(error); process.exitCode = 1; });
