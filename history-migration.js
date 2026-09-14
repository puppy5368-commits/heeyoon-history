/* Explicit parent-approved migration. It never starts by itself. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let plan = null;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function formatError(error) {
    const parts = [];
    if (error?.status) parts.push(`HTTP ${error.status}`);
    if (error?.code) parts.push(String(error.code));
    if (error?.message) parts.push(String(error.message));
    if (error?.details) parts.push(String(error.details));
    if (error?.hint) parts.push(`힌트: ${error.hint}`);
    return parts.length ? parts.join(" · ") : "알 수 없는 오류";
  }
  const localRows = () => Object.values(HistoryCloud.rows(load()));
  function load() {
    try { return JSON.parse(localStorage.getItem(HistoryCloud.STORAGE_KEY)); }
    catch { return null; }
  }
  function backup() {
    const payload = { createdAt: new Date().toISOString(), storageKey: HistoryCloud.STORAGE_KEY, value: localStorage.getItem(HistoryCloud.STORAGE_KEY) };
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = `heeyoon-history-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  async function inspect() {
    const rows = localRows();
    const result = {
      rows, online: [], new: 0, duplicate: 0, conflict: 0, blocked: false, error: "",
      diagnostic: { sessionPresent: false, anonymousUserId: "", sessionRole: "", familyOwnerId: "", idsDiffer: null }
    };
    try {
      const client = window.historyCloud?.migrationClient?.();
      const sessionResult = await window.historyCloud?.migrationSession?.();
      const owner = await window.historyCloud?.migrationOwner?.();
      const session = sessionResult?.session;
      result.diagnostic = {
        sessionPresent: Boolean(session?.user?.id),
        anonymousUserId: session?.user?.id || "",
        sessionRole: session?.user?.role || "",
        familyOwnerId: owner || "",
        idsDiffer: session?.user?.id && owner ? session.user.id !== owner : null
      };
      if (sessionResult?.error) throw sessionResult.error;
      if (!client || !owner) throw Error("가족 클라우드 연결이 아직 준비되지 않았습니다.");
      let offset = 0;
      while (true) {
        const { data, error } = await client.from(HistoryCloud.TABLE).select("field_key,value,revision").eq("user_id", owner).order("field_key").range(offset, offset + 499);
        if (error) throw error;
        result.online.push(...(data || []).map(row => ({ fieldKey: row.field_key, value: row.value, revision: row.revision })));
        if (!data || data.length < 500) break;
        offset += 500;
      }
      Object.assign(result, HistoryCloud.migrationDecision(rows, result.online));
    } catch (error) {
      result.blocked = true;
      result.error = error instanceof Error && error.message ? error.message : "클라우드 기록을 읽지 못했습니다.";
    }
    return result;
  }
  function diagnosticHtml(diagnostic) {
    const d = diagnostic || {};
    const session = d.sessionPresent
      ? `있음 · ${escapeHtml(d.sessionRole || "role 미상")}`
      : "없음";
    const anonymousId = d.anonymousUserId ? `<code>${escapeHtml(d.anonymousUserId)}</code>` : "확인되지 않음";
    const ownerId = d.familyOwnerId ? `<code>${escapeHtml(d.familyOwnerId)}</code>` : "확인되지 않음";
    const relation = d.idsDiffer === true
      ? "두 ID가 다른 것은 정상입니다. 저장에는 family owner ID만 사용합니다."
      : d.idsDiffer === false
        ? "두 ID가 같습니다. 저장에는 family owner ID를 사용합니다."
        : "family owner ID를 확인한 뒤에만 저장할 수 있습니다.";
    return `<div class="migration-diagnostic"><b>이전 전 연결 진단</b><p>인증 세션: ${session}</p><p>현재 anonymous user ID: ${anonymousId}</p><p>실제 저장 family owner ID: ${ownerId}</p><p>${relation}</p></div>`;
  }
  function render(result) {
    plan = result;
    $("migrationSummary").hidden = false;
    $("migrationActions").hidden = false;
    const keys = result.online.map(row => row.fieldKey).sort();
    const keyList = keys.length
      ? `<details class="migration-key-list"><summary>클라우드 field_key ${keys.length}건 보기</summary><code>${keys.map(escapeHtml).join(" · ")}</code></details>`
      : "";
    const diagnostic = diagnosticHtml(result.diagnostic);
    $("migrationSummary").innerHTML = result.blocked
      ? `<p>이 기기의 저장 항목 ${result.rows.length}건 · 클라우드 비교 실패</p>${diagnostic}`
      : `<p>이 기기의 저장 항목 ${result.rows.length}건 · 클라우드 기록 ${result.online.length}건</p><p>신규 ${result.new}건 · 동일 ${result.duplicate}건 · 충돌 보류 ${result.conflict}건</p>${diagnostic}${keyList}`;
    $("migrationRun").disabled = result.blocked || result.new === 0;
  }
  async function run() {
    if (!plan || plan.blocked) { $("migrationResult").textContent = "온라인 연결 후 먼저 기록을 확인해 주세요."; return; }
    const button = $("migrationRun");
    button.disabled = true;
    let uploaded = 0;
    let completed = false;
    try {
      const client = window.historyCloud.migrationClient();
      const { session, error: sessionError } = await window.historyCloud.migrationSession();
      const owner = await window.historyCloud.migrationOwner();
      if (sessionError) throw sessionError;
      if (!session?.user?.id || session.user.role !== "authenticated") {
        throw Error("익명 가족 인증 세션이 준비되지 않았습니다.");
      }
      if (!client || !owner || !/^[0-9a-f-]{36}$/i.test(owner)) {
        throw Error("가족 공유 owner를 확인하지 못했습니다.");
      }
      const remote = new Map(plan.online.map(row => [row.fieldKey, row]));
      const targets = plan.rows.filter(row => !remote.has(row.fieldKey));
      for (const row of targets) {
        $("migrationResult").textContent = `이전 중… ${uploaded}/${targets.length}건`;
        // user_id is the server-verified family owner, exactly matching the RLS policy.
        const { error } = await client.from(HistoryCloud.TABLE).insert({ user_id: owner, field_key: row.fieldKey, value: row.value });
        if (error) throw error;
        uploaded++;
      }
      completed = true;
      $("migrationResult").textContent = `이전 완료 · 신규 ${uploaded}건 · 동일 ${plan.duplicate}건 · 충돌 보류 ${plan.conflict}건 · localStorage 원본 유지`;
    } catch (error) {
      const partial = uploaded ? ` · ${uploaded}건은 이미 클라우드에 저장되었습니다.` : "";
      console.error("한국사 기록 이전 실패", {
        status: error?.status,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint
      });
      $("migrationResult").textContent = `이전 실패: ${formatError(error)}${partial} localStorage 원본은 그대로 유지됩니다.`;
    } finally {
      if (!completed) button.disabled = false;
    }
  }
  window.addEventListener("DOMContentLoaded", () => {
    $("migrationInspect")?.addEventListener("click", async () => {
      const button = $("migrationInspect");
      button.disabled = true;
      plan = null;
      $("migrationSummary").hidden = true;
      $("migrationActions").hidden = true;
      $("migrationResult").textContent = "기록과 클라우드를 비교하는 중…";
      try {
        const result = await inspect();
        render(result);
        $("migrationResult").textContent = result.blocked
          ? `비교하지 못했어요 · ${result.error}`
          : `비교 완료 · 신규 ${result.new}건 · 동일 ${result.duplicate}건 · 충돌 보류 ${result.conflict}건`;
      } catch {
        // Defensive final boundary: no asynchronous path may leave the parent UI loading.
        $("migrationResult").textContent = "비교하지 못했어요. 네트워크와 가족 클라우드 연결을 확인해 주세요.";
      } finally {
        button.disabled = false;
      }
    });
    $("migrationBackup")?.addEventListener("click", backup);
    $("migrationRun")?.addEventListener("click", () => void run());
  });
})();
