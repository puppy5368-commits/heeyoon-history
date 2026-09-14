/*
 * 한국사 보드의 선택적 가족 동기화.
 * - heeyoon-history-progress는 항상 이 기기의 원본이며 자동 이관하지 않는다.
 * - 각 학습 항목을 별도 행으로 저장해, 한 기기에서 한 변경이 다른 항목을 지우지 않게 한다.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "heeyoon-history-progress";
  const PREFIX = "heeyoon-history:sync:v1:family:v1:";
  const TABLE = "history_progress";
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function validState(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      && value.days && typeof value.days === "object"
      && value.day2Choice && typeof value.day2Choice === "object"
      && value.quiz && typeof value.quiz === "object"
      && value.visits && typeof value.visits === "object";
  }

  function read(storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return validState(value) ? value : null;
    } catch {
      return null;
    }
  }

  // Values use JSON null as a durable tombstone. Rows are never deleted by the app.
  function rows(state) {
    const out = {};
    if (!validState(state)) return out;
    const add = (fieldKey, value) => { out[fieldKey] = { fieldKey, value: clone(value) }; };
    for (const [key, value] of Object.entries(state.days)) add(`day:${key}`, Boolean(value));
    for (const [key, value] of Object.entries(state.day2Choice)) add(`day2:${key}`, value);
    for (const [key, value] of Object.entries(state.quiz)) add(`quiz:${key}`, value);
    for (const [key, value] of Object.entries(state.visits)) add(`visit:${key}`, Boolean(value));
    return out;
  }

  function missingRow(fieldKey) {
    return { fieldKey, value: null };
  }

  function field(state, fieldKey) {
    const [kind, ...rest] = fieldKey.split(":");
    const key = rest.join(":");
    const bucket = kind === "day" ? state.days
      : kind === "day2" ? state.day2Choice
      : kind === "quiz" ? state.quiz
      : kind === "visit" ? state.visits
      : null;
    if (!bucket) return { known: false, value: null };
    return own(bucket, key) ? { known: true, value: bucket[key] } : { known: false, value: null };
  }

  function apply(state, fieldKey, value) {
    const [kind, ...rest] = fieldKey.split(":");
    const key = rest.join(":");
    const bucket = kind === "day" ? state.days
      : kind === "day2" ? state.day2Choice
      : kind === "quiz" ? state.quiz
      : kind === "visit" ? state.visits
      : null;
    if (!bucket) return false;
    if (value === null) {
      if (!own(bucket, key)) return false;
      delete bucket[key];
      return true;
    }
    if (own(bucket, key) && equal(bucket[key], value)) return false;
    bucket[key] = clone(value);
    return true;
  }

  function migrationDecision(localRows, remoteRows) {
    const remote = new Map(remoteRows.map(row => [row.fieldKey, row]));
    const result = { new: 0, duplicate: 0, conflict: 0 };
    for (const row of localRows) {
      const hit = remote.get(row.fieldKey);
      if (!hit) result.new++;
      else if (equal(row.value, hit.value)) result.duplicate++;
      else result.conflict++;
    }
    return result;
  }

  function create({ storage = root.localStorage, onStatus = () => {}, onChange = () => {}, online = () => root.navigator?.onLine !== false } = {}) {
    let client = null;
    let user = null;
    let running = false;
    let again = false;
    let failed = false;
    let lastError = null;
    let localProblem = false;
    let lastAt = 0;

    const scoped = () => PREFIX;
    const json = (key, fallback) => {
      try {
        const raw = storage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    };
    const operationKey = () => `${scoped()}op:${root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    const rowMetaKey = fieldKey => `${scoped()}row:${fieldKey}`;
    const operations = () => {
      const all = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(`${scoped()}op:`)) all.push({ key, ...json(key, {}) });
      }
      return all.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
    };
    const meta = fieldKey => json(rowMetaKey(fieldKey), null);
    function backupOriginal() {
      const backupKey = `${scoped()}original:${STORAGE_KEY}`;
      if (storage.getItem(backupKey) === null) {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw !== null) storage.setItem(backupKey, raw);
      }
    }
    function original() {
      try {
        const raw = storage.getItem(`${scoped()}original:${STORAGE_KEY}`);
        if (!raw) return null;
        const value = JSON.parse(raw);
        return validState(value) ? value : null;
      } catch {
        return null;
      }
    }
    function meaningful(value) {
      return value === true
        || (typeof value === "string" && value.length > 0)
        || typeof value === "number";
    }
    function status() {
      if (localProblem) return onStatus("⚠️ 이 기기 저장 공간을 확인해 주세요");
      if (!user) return onStatus("📴 이 기기에만 저장됨 · 연결 확인 대기");
      if (!online()) return onStatus("📴 오프라인 · 이 기기에 저장됨");
      if (failed) {
        const code = lastError?.code ? ` (${lastError.code})` : "";
        return onStatus(`⚠️ 클라우드 저장 실패${code} · 이 기기 기록은 안전함`);
      }
      const hasConflict = operations().some(op => op.conflict)
        || Array.from({ length: storage.length }, (_, i) => storage.key(i))
          .filter(key => key?.startsWith(`${scoped()}row:`))
          .some(key => json(key, {}).conflict);
      if (hasConflict) return onStatus("⚠️ 다른 기기 기록과 달라요 · 자동 덮어쓰기 안 함");
      return onStatus(operations().length ? "☁️ 저장 대기 중…" : "☁️ 가족 클라우드와 동기화됨");
    }
    function writeLocal(after) {
      storage.setItem(STORAGE_KEY, JSON.stringify(after));
      return after;
    }
    function commit(before, after) {
      if (!validState(after)) throw Error("history-local-invalid");
      const beforeRows = rows(before || { version: 1, days: {}, day2Choice: {}, quiz: {}, visits: {} });
      const afterRows = rows(after);
      const fieldKeys = new Set([...Object.keys(beforeRows), ...Object.keys(afterRows)]);
      const changes = [];
      for (const fieldKey of fieldKeys) {
        const oldRow = beforeRows[fieldKey] || missingRow(fieldKey);
        const newRow = afterRows[fieldKey] || missingRow(fieldKey);
        if (equal(oldRow.value, newRow.value)) continue;
        const baseline = meta(fieldKey);
        lastAt = Math.max(Date.now(), lastAt + 1, ...operations().map(op => op.at + 1));
        changes.push({ fieldKey, value: newRow.value, before: oldRow.value, expected: baseline?.value ?? oldRow.value, revision: baseline?.revision ?? null, at: lastAt });
      }
      // This write is deliberately before all network activity: offline use stays fully functional.
      backupOriginal();
      writeLocal(after);
      if (!changes.length) { status(); return after; }
      try {
        for (const change of changes) storage.setItem(operationKey(), JSON.stringify(change));
      } catch {
        localProblem = true;
      }
      status();
      void sync();
      return after;
    }
    async function query(fieldKey) {
      return client.from(TABLE).select("*").eq("user_id", user).eq("field_key", fieldKey).maybeSingle();
    }
    function rememberRemote(op, remote) {
      storage.removeItem(op.key);
      storage.setItem(rowMetaKey(op.fieldKey), JSON.stringify({
        fieldKey: op.fieldKey,
        value: remote.value,
        revision: remote.revision,
        conflict: false
      }));
    }
    function holdConflict(op) {
      storage.setItem(op.key, JSON.stringify({ ...op, conflict: true }));
    }
    function queueMissingLocalRows(remoteFieldKeys) {
      const baseline = original();
      const local = read(storage);
      // The original snapshot is made before the first normal learning change.
      // Without it, auto-queuing could accidentally become legacy migration.
      if (!baseline || !local) return 0;
      const baselineRows = rows(baseline);
      const localRows = rows(local);
      const queued = new Set(operations().map(op => op.fieldKey));
      let recovered = 0;
      for (const row of Object.values(localRows)) {
        if (remoteFieldKeys.has(row.fieldKey) || queued.has(row.fieldKey)) continue;
        if (!meaningful(row.value)) continue;
        const baselineValue = baselineRows[row.fieldKey]?.value ?? null;
        // Only a post-baseline local change can be safely recovered. Existing
        // migration records stay untouched even if this device has no row meta.
        if (equal(row.value, baselineValue)) continue;
        lastAt = Math.max(Date.now(), lastAt + 1, ...operations().map(op => op.at + 1));
        // Both before and expected are null because cloud was just observed to
        // have no row. If another device creates the field meanwhile, send()
        // treats it as a conflict rather than overwriting it.
        storage.setItem(operationKey(), JSON.stringify({
          fieldKey: row.fieldKey,
          value: row.value,
          before: null,
          expected: null,
          revision: null,
          at: lastAt,
          recovered: true
        }));
        queued.add(row.fieldKey);
        recovered++;
      }
      return recovered;
    }
    async function send(op, who) {
      const got = await query(op.fieldKey);
      if (got.error) throw got.error;
      if (user !== who) return;
      const current = got.data;
      // Earlier builds incorrectly turned *write errors* into a permanent
      // conflict. A missing cloud row is safe to retry; an existing row remains
      // protected as a real conflict and is never overwritten automatically.
      if (op.conflict) {
        if (current) return;
        storage.setItem(op.key, JSON.stringify({ ...op, conflict: false }));
      }
      const remoteValue = current ? current.value : null;
      if (current && equal(remoteValue, op.value)) {
        rememberRemote(op, current);
        return;
      }
      const conflict = current && !equal(remoteValue, op.expected) && !equal(remoteValue, op.before);
      if (conflict || (!current && op.revision !== null)) {
        holdConflict(op);
        return;
      }
      let result;
      if (current) {
        result = await client.from(TABLE)
          .update({ value: op.value, revision: current.revision + 1 })
          .eq("user_id", who).eq("field_key", op.fieldKey).eq("revision", current.revision)
          .select("*").maybeSingle();
      } else {
        result = await client.from(TABLE)
          .insert({ user_id: who, field_key: op.fieldKey, value: op.value })
          .select("*").maybeSingle();
      }
      if (user !== who) return;
      if (result.error) {
        // A concurrent insert is not an error to retry blindly. Re-read it and
        // preserve a different value as a true conflict.
        if (!current && result.error.code === "23505") {
          const raced = await query(op.fieldKey);
          if (raced.error) throw raced.error;
          if (raced.data && equal(raced.data.value, op.value)) rememberRemote(op, raced.data);
          else if (raced.data) holdConflict(op);
          else throw result.error;
          return;
        }
        // Transport/RLS/server failures keep the queued operation intact so a
        // later reconnect or sync button can retry it without touching local data.
        throw result.error;
      }
      if (!result.data) {
        // A retry will first query the field; if the write did reach Supabase it
        // will be recognized as identical, otherwise it remains safely queued.
        throw Error("history-cloud-write-empty-response");
      }
      if (!current && result.data.field_key !== op.fieldKey) {
        // Defensive boundary: never clear a local queue from an unrelated row.
        holdConflict(op);
        return;
      }
      rememberRemote(op, result.data);
    }
    async function pull(who) {
      let offset = 0;
      const remoteFieldKeys = new Set();
      while (user === who) {
        const result = await client.from(TABLE).select("*").eq("user_id", who).order("field_key").range(offset, offset + 499);
        if (result.error) throw result.error;
        let changed = false;
        for (const remote of result.data || []) {
          if (user !== who) return;
          remoteFieldKeys.add(remote.field_key);
          const pending = operations().some(op => op.fieldKey === remote.field_key && !op.conflict);
          const local = read(storage);
          if (!local) continue; // A corrupt key is never replaced by cloud data.
          const current = field(local, remote.field_key);
          const baseline = meta(remote.field_key);
          let conflict = false;
          if (!pending && !equal(current.value, remote.value)) {
            // Fresh/empty fields and fields previously pulled from this revision can update.
            if (!current.known || (baseline && equal(current.value, baseline.value))) {
              changed = apply(local, remote.field_key, remote.value) || changed;
            } else {
              conflict = true; // Legacy or concurrent local value: preserve it, never overwrite it.
            }
          }
          storage.setItem(rowMetaKey(remote.field_key), JSON.stringify({ fieldKey: remote.field_key, value: remote.value, revision: remote.revision, conflict }));
          if (changed) writeLocal(local);
        }
        if (changed) onChange();
        if ((result.data || []).length < 500) break;
        offset += 500;
      }
      if (user === who && queueMissingLocalRows(remoteFieldKeys)) {
        // This sync has already sent its initial queue. Run it once more so
        // recovery does not wait for the learner to touch the same control again.
        again = true;
      }
    }
    async function sync() {
      if (!client || !user) { status(); return; }
      if (running) { again = true; return; }
      if (!online()) { status(); return; }
      running = true;
      failed = false;
      lastError = null;
      const who = user;
      try {
        for (const op of operations()) {
          if (user !== who) return;
          await send(op, who);
        }
        if (user === who) await pull(who);
      } catch (error) {
        failed = true;
        lastError = error;
        root.console?.error?.("한국사 진도 클라우드 저장 실패", {
          status: error?.status,
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint
        });
      } finally {
        running = false;
        if (user === who) status();
        if (again) { again = false; void sync(); }
      }
    }
    function setUser(value) {
      if (!value) { user = null; status(); return; }
      const saved = storage.getItem(`${scoped()}owner`);
      if (saved && saved !== value) throw Error("different-family-owner");
      storage.setItem(`${scoped()}owner`, value);
      user = value;
      status();
    }
    return { commit, sync, setClient: value => { client = value; }, setUser, read: () => read(storage), rows, migrationDecision, table: TABLE };
  }

  let engine = null;
  let client = null;
  let auth = null;
  let sessionId = null;
  let familyOwner = null;
  let familySession = null;
  let connecting = null;
  let reconnecting = null;
  let epoch = 0;
  const $ = id => root.document?.getElementById(id);
  const showStatus = message => { const el = $("syncStatus"); if (el) el.textContent = message; };
  function offline() { sessionId = null; familyOwner = null; familySession = null; engine?.setUser(null); }
  async function attach(session) {
    if (!session || !client || !engine) return;
    if (sessionId === session.user.id) return engine.sync();
    if (connecting) return connecting;
    const current = epoch;
    connecting = (async () => {
      try {
        const { data: owner, error } = await client.rpc("heeyoon_family_owner");
        if (current !== epoch || error || !/^[0-9a-f-]{36}$/i.test(owner || "")) throw Error("family-unavailable");
        familyOwner = owner;
        familySession = { id: session.user.id, role: session.user.role };
        engine.setUser(owner);
        sessionId = session.user.id;
        await engine.sync();
      } catch {
        if (current === epoch) offline();
      }
    })();
    try { await connecting; } finally { connecting = null; }
  }
  async function reconnect() {
    if (!auth || !root.navigator?.onLine) { if (!auth) offline(); else void engine?.sync(); return; }
    if (reconnecting) return reconnecting;
    reconnecting = (async () => {
      try {
        let { data, error } = await auth.getSession();
        if (error) throw error;
        if (!data.session) ({ data, error } = await auth.signInAnonymously());
        if (error) throw error;
        await attach(data.session);
      } catch { offline(); }
    })();
    try { await reconnecting; } finally { reconnecting = null; }
  }
  function start() {
    const config = root.HEEYOON_SUPABASE_CONFIG || {};
    if (!root.supabase || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.projectUrl || "") || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey || "")) {
      offline();
      return;
    }
    try {
      client = root.supabase.createClient(config.projectUrl, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "heeyoon-history:auth:v1" },
        global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(12000) }) }
      });
      auth = client.auth;
      engine.setClient(client);
      auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") { epoch++; offline(); }
        setTimeout(() => { if (session) void attach(session); else if (event === "SIGNED_OUT") void reconnect(); }, 0);
      });
      void reconnect();
    } catch { offline(); }
  }
  root.historyCloud = {
    init({ onChange }) {
      engine = create({ onStatus: showStatus, onChange });
      $("syncButton")?.addEventListener("click", () => void reconnect());
      root.addEventListener?.("online", () => void reconnect());
      root.addEventListener?.("offline", () => void engine.sync());
      root.document?.addEventListener("visibilitychange", () => { if (!root.document.hidden) void reconnect(); });
      root.addEventListener?.("storage", event => { if (event.key === STORAGE_KEY) onChange(); });
      start();
    },
    save(before, after) { return engine ? engine.commit(before, after) : after; },
    reconnect,
    migrationClient: () => client,
    // attach() has already verified this value with the server. Reusing it avoids a
    // second RPC during the parent-only comparison flow.
    migrationOwner: () => familyOwner,
    // attach() receives Supabase's authenticated session; avoid another auth SDK call
    // while the parent migration is waiting to begin.
    migrationSession: () => ({ session: familySession ? { user: familySession } : null, error: null }),
    engine: () => engine
  };
  root.HistoryCloud = { STORAGE_KEY, TABLE, rows, field, apply, migrationDecision, create };
  if (typeof module !== "undefined") module.exports = root.HistoryCloud;
})(typeof window === "undefined" ? globalThis : window);
