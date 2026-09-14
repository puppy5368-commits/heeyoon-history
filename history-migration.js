/* Explicit parent-approved migration. It never starts by itself. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let plan = null;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
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
    const result = { rows, online: [], new: 0, duplicate: 0, conflict: 0, blocked: false, error: "" };
    try {
      const client = window.historyCloud?.migrationClient?.();
      const owner = await window.historyCloud?.migrationOwner?.();
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
  function render(result) {
    plan = result;
    $("migrationSummary").hidden = false;
    $("migrationActions").hidden = false;
    const keys = result.online.map(row => row.fieldKey).sort();
    const keyList = keys.length
      ? `<details class="migration-key-list"><summary>클라우드 field_key ${keys.length}건 보기</summary><code>${keys.map(escapeHtml).join(" · ")}</code></details>`
      : "";
    $("migrationSummary").innerHTML = result.blocked
      ? `<p>이 기기의 저장 항목 ${result.rows.length}건 · 클라우드 비교 실패</p>`
      : `<p>이 기기의 저장 항목 ${result.rows.length}건 · 클라우드 기록 ${result.online.length}건</p><p>신규 ${result.new}건 · 동일 ${result.duplicate}건 · 충돌 보류 ${result.conflict}건</p>${keyList}`;
    $("migrationRun").disabled = result.blocked || result.new === 0;
  }
  async function run() {
    if (!plan || plan.blocked) { $("migrationResult").textContent = "온라인 연결 후 먼저 기록을 확인해 주세요."; return; }
    const client = window.historyCloud.migrationClient();
    const owner = await window.historyCloud.migrationOwner();
    if (!client || !owner) { $("migrationResult").textContent = "가족 클라우드 연결을 확인해 주세요."; return; }
    let uploaded = 0;
    const remote = new Map(plan.online.map(row => [row.fieldKey, row]));
    for (const row of plan.rows) {
      const hit = remote.get(row.fieldKey);
      if (hit) continue; // Same and conflicting rows are both preserved exactly as inspected.
      const { error } = await client.from(HistoryCloud.TABLE).insert({ user_id: owner, field_key: row.fieldKey, value: row.value });
      if (error) { $("migrationResult").textContent = "이전 중단 · 이 기기 localStorage 원본은 그대로 유지됩니다."; return; }
      uploaded++;
    }
    $("migrationResult").textContent = `이전 완료 · 신규 ${uploaded}건 · 동일 ${plan.duplicate}건 · 충돌 보류 ${plan.conflict}건 · localStorage 원본 유지`;
    $("migrationRun").disabled = true;
    void window.historyCloud.reconnect();
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
