/* Parent-only DAY 3-1 inspector. It is enabled only by ?diagnostic=1. */
(() => {
  "use strict";
  const FIELD_KEY = "day:3-1";
  const EXPECTED_CACHE = "heeyoon-history-v2-3-diagnostic";
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const json = value => value === undefined ? "undefined" : JSON.stringify(value);
  const code = value => `<code>${escapeHtml(json(value))}</code>`;
  const yesNo = value => value === true ? "YES" : value === false ? "NO" : "판단 불가";

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
    const script = Array.from(document.scripts).find(item => item.dataset.historyCloudBuild);
    return {
      declaredBuild: window.historyCloud?.build?.() || window.HistoryCloud?.BUILD || "확인 불가",
      source: script?.src || "history-cloud.js script 태그를 찾지 못함",
      expected: script?.dataset.historyCloudBuild || "확인 불가"
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
    $("readonlyDiagnosticResult").innerHTML = `<dl>
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
    $("readonlyDiagnosticResult").hidden = false;
  }

  function configure() {
    const link = $("readonlyDiagnosticLink");
    if (link) {
      const url = new URL(window.location.href);
      url.searchParams.set("diagnostic", "1");
      link.href = url.toString();
    }
    if (new URLSearchParams(window.location.search).get("diagnostic") !== "1") return;
    if (link) link.hidden = true;
    const run = $("readonlyDiagnosticRun");
    if (!run) return;
    run.hidden = false;
    run.addEventListener("click", async () => {
      run.disabled = true;
      $("readonlyDiagnosticStatus").textContent = "읽기 전용으로 localStorage와 Supabase SELECT를 확인하는 중…";
      try {
        const [result, worker] = await Promise.all([
          window.historyCloud?.readOnlyDiagnostic?.(FIELD_KEY),
          serviceWorkerInfo()
        ]);
        if (!result) throw Error("진단 모듈을 불러오지 못했습니다.");
        render(result, worker);
        $("readonlyDiagnosticStatus").textContent = "진단 완료 · 이 화면은 INSERT/UPDATE/DELETE 및 localStorage/queue 변경을 수행하지 않았습니다.";
      } catch (error) {
        $("readonlyDiagnosticStatus").textContent = `진단 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`;
      } finally {
        run.disabled = false;
      }
    });
  }

  configure();
})();
