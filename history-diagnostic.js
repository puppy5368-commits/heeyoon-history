/* Parent-only DAY 3-1 inspector. It is enabled only by ?diagnostic=1. */
(() => {
  "use strict";
  const FIELD_KEY = "day:3-1";
  const BUILD = "history-diagnostic-2026-09-15-click-fix-1";
  const EXPECTED_CACHE = "heeyoon-history-v2-5-local-queue";
  const $ = id => document.getElementById(id);
  const isDiagnosticMode = () => new URLSearchParams(window.location.search).get("diagnostic") === "1";
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const json = value => value === undefined ? "undefined" : JSON.stringify(value);
  const code = value => `<code>${escapeHtml(json(value))}</code>`;
  const yesNo = value => value === true ? "YES" : value === false ? "NO" : "판단 불가";
  let running = false;

  function setStatus(message) {
    const status = $("readonlyDiagnosticStatus");
    if (status) status.textContent = message;
  }

  async function serviceWorkerInfo() {
    if (!("serviceWorker" in navigator)) return "이 브라우저는 Service Worker를 지원하지 않음";
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const controller = navigator.serviceWorker.controller;
      const cacheNames = "caches" in window ? await caches.keys() : [];
      const active = registration?.active?.scriptURL || "없음";
      const waiting = registration?.waiting?.scriptURL || "없음";
      const controlling = controller?.scriptURL || "없음";
      const expected = cacheNames.includes(EXPECTED_CACHE) ? "있음" : "없음";
      return `controller: ${controlling}\n등록 active: ${active}\n대기 중: ${waiting}\n기대 cache ${EXPECTED_CACHE}: ${expected}\n현재 cache: ${cacheNames.length ? cacheNames.join(", ") : "없음"}`;
    } catch (error) {
      return `확인 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`;
    }
  }

  function scriptInfo() {
    const cloudScript = Array.from(document.scripts).find(item => item.dataset.historyCloudBuild);
    const diagnosticScript = Array.from(document.scripts).find(item => item.dataset.historyDiagnosticBuild);
    return {
      declaredBuild: window.historyCloud?.build?.() || window.HistoryCloud?.BUILD || "확인 불가",
      source: cloudScript?.src || "history-cloud.js script 태그를 찾지 못함",
      expected: cloudScript?.dataset.historyCloudBuild || "확인 불가",
      diagnosticBuild: diagnosticScript?.dataset.historyDiagnosticBuild || BUILD,
      diagnosticSource: diagnosticScript?.src || "history-diagnostic.js script 태그를 찾지 못함"
    };
  }

  function queueHtml(operations) {
    if (!operations?.length) return "없음";
    return operations.map(op => code({
      conflict: Boolean(op.conflict), value: op.value, before: op.before,
      expected: op.expected, revision: op.revision
    })).join("<br>");
  }

  function render(result, worker) {
    const diagnostic = result.local || {};
    const cloud = result.cloud || {};
    const build = scriptInfo();
    const localValue = diagnostic.local?.valid ? diagnostic.local.field?.value : "localStorage 상태가 유효하지 않음";
    const originalValue = diagnostic.original?.valid ? diagnostic.original.field?.value : "original snapshot 없음 또는 유효하지 않음";
    const cloudState = !cloud.queried ? `조회 실패: ${cloud.error}`
      : cloud.row ? `NO · 행 있음 ${code(cloud.row)}` : "YES · day:3-1 행 없음";
    const recovery = diagnostic.recovery || { recover: null, reason: "진단 엔진을 찾지 못함" };
    const resultEl = $("readonlyDiagnosticResult");
    if (!resultEl) throw Error("진단 결과 영역을 찾지 못했습니다.");
    resultEl.innerHTML = `<dl>
      <dt>진단 UI 연결 상태</dt>
      <dd>script build: ${escapeHtml(build.diagnosticBuild)}<br>실제 script URL: <code>${escapeHtml(build.diagnosticSource)}</code><br>configure(): 실행됨 · document click event delegation: 연결됨</dd>
      <dt>1. 현재 로드된 history-cloud.js 버전/빌드</dt>
      <dd>로드된 build: ${escapeHtml(build.declaredBuild)}<br>기대 build: ${escapeHtml(build.expected)}<br>실제 script URL: <code>${escapeHtml(build.source)}</code></dd>
      <dt>2. localStorage ${FIELD_KEY}</dt>
      <dd>days["3-1"]: ${code(localValue)}</dd>
      <dt>3. original snapshot ${FIELD_KEY}</dt>
      <dd>days["3-1"]: ${code(originalValue)}</dd>
      <dt>4. retry/op queue ${FIELD_KEY}</dt>
      <dd>${queueHtml(diagnostic.operations)}</dd>
      <dt>5. row meta ${FIELD_KEY}</dt>
      <dd>${diagnostic.rowMeta ? code(diagnostic.rowMeta) : "없음"}</dd>
      <dt>6. cloud 조회 결과 ${FIELD_KEY}</dt>
      <dd>${cloudState}</dd>
      <dt>7. queueMissingLocalRows 복구 판단</dt>
      <dd>${yesNo(recovery.recover)} · ${escapeHtml(recovery.reason)}</dd>
      <dt>서비스워커/캐시 상태</dt>
      <dd><code>${escapeHtml(worker)}</code></dd>
    </dl>`;
    resultEl.hidden = false;
  }

  async function runDiagnostic() {
    if (running) return;
    running = true;
    const run = $("readonlyDiagnosticRun");
    if (run) run.disabled = true;
    // This synchronous update proves that the click reached this script before
    // any localStorage or Supabase read begins.
    setStatus("진단 시작됨… 읽기 전용 localStorage 확인을 준비하는 중입니다.");
    try {
      const diagnose = window.historyCloud?.readOnlyDiagnostic;
      if (typeof diagnose !== "function") {
        throw Error("window.historyCloud.readOnlyDiagnostic 함수가 없습니다. history-cloud.js 로드/캐시 상태를 확인해 주세요.");
      }
      const [result, worker] = await Promise.all([diagnose(FIELD_KEY), serviceWorkerInfo()]);
      if (!result) throw Error("readOnlyDiagnostic 결과가 비어 있습니다.");
      render(result, worker);
      setStatus("진단 완료 · 이 화면은 INSERT/UPDATE/DELETE 및 localStorage/queue 변경을 수행하지 않았습니다.");
    } catch (error) {
      console.error("DAY 3-1 읽기 전용 진단 실패", error);
      setStatus(`진단 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    } finally {
      if (run) run.disabled = false;
      running = false;
    }
  }

  function configure() {
    const link = $("readonlyDiagnosticLink");
    if (link) {
      const url = new URL(window.location.href);
      url.searchParams.set("diagnostic", "1");
      link.href = url.toString();
    }
    if (!isDiagnosticMode()) return;
    if (link) link.hidden = true;
    const run = $("readonlyDiagnosticRun");
    if (!run) {
      setStatus("진단 초기화 오류: #readonlyDiagnosticRun 버튼을 찾지 못했습니다.");
      console.error("DAY 3-1 진단 버튼을 찾지 못했습니다.");
      return;
    }
    run.hidden = false;
    run.disabled = false;
    run.dataset.diagnosticReady = "true";
    if (typeof window.historyCloud?.readOnlyDiagnostic !== "function") {
      run.disabled = true;
      setStatus("진단 준비 오류: window.historyCloud.readOnlyDiagnostic 함수가 없습니다. history-cloud.js 로드/캐시 상태를 확인해 주세요.");
      console.error("DAY 3-1 진단 함수를 찾지 못했습니다.");
      return;
    }
    setStatus(`진단 준비됨 · ${BUILD} · 버튼 연결 대기 중`);
  }

  // Delegation survives a later DOM replacement, unlike a listener attached to
  // one button instance. The guard keeps normal learning pages untouched.
  document.addEventListener("click", event => {
    const run = event.target.closest?.("#readonlyDiagnosticRun");
    if (!run || !isDiagnosticMode()) return;
    event.preventDefault();
    void runDiagnostic();
  });

  window.historyDiagnostic = Object.freeze({ build: BUILD, configure, runDiagnostic });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", configure, { once: true });
  else configure();
})();
