// Pure local-data safety tests. No network or real Supabase project is accessed.
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

function createClient(database) {
  return {
    from() {
      const filter = {};
      let update = null;
      let insert = null;
      const builder = {
        select() { return builder; },
        eq(key, value) { filter[key] = value; return builder; },
        order() { return builder; },
        range() {
          return Promise.resolve({ data: database.filter(row => Object.entries(filter).every(([key, value]) => row[key] === value)).sort((a, b) => a.field_key.localeCompare(b.field_key)), error: null });
        },
        update(value) { update = value; return builder; },
        insert(value) { insert = value; return builder; },
        maybeSingle() {
          const index = database.findIndex(row => Object.entries(filter).every(([key, value]) => row[key] === value));
          if (update) {
            if (index < 0 || database[index].revision !== filter.revision) return Promise.resolve({ data: null, error: { code: "40001" } });
            database[index] = { ...database[index], ...update };
            return Promise.resolve({ data: database[index], error: null });
          }
          if (insert) {
            const exists = database.find(row => row.user_id === insert.user_id && row.field_key === insert.field_key);
            if (exists) return Promise.resolve({ data: null, error: { code: "23505" } });
            const row = { ...insert, revision: 1 };
            database.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: index < 0 ? null : database[index], error: null });
        }
      };
      return builder;
    }
  };
}

const original = {
  version: 1,
  days: { "1-1": true, "1-3": false },
  day2Choice: { "1": "book" },
  quiz: { "1-0": 2 },
  visits: { "1": true }
};
const storage = new MemoryStorage({ [HistoryCloud.STORAGE_KEY]: JSON.stringify(original) });
const engine = HistoryCloud.create({ storage, online: () => false });
const changed = JSON.parse(JSON.stringify(original));
changed.day2Choice[1] = "video";
engine.commit(original, changed);

assert.deepEqual(JSON.parse(storage.getItem(HistoryCloud.STORAGE_KEY)), changed, "offline edit remains in localStorage");
assert.equal(storage.getItem("heeyoon-history:sync:v1:family:v1:original:heeyoon-history-progress"), JSON.stringify(original), "first raw original snapshot is immutable");
assert.equal(Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.includes(":op:")).length, 1, "only the changed DAY 2 field is queued");

const mapped = HistoryCloud.rows(original);
assert.equal(mapped["day:1-1"].value, true);
assert.equal(mapped["day2:1"].value, "book");
assert.equal(mapped["quiz:1-0"].value, 2);
assert.equal(mapped["visit:1"].value, true);

assert.deepEqual(
  HistoryCloud.migrationDecision(
    [{ fieldKey: "day:1-1", value: true }, { fieldKey: "quiz:1-0", value: 2 }],
    [{ fieldKey: "day:1-1", value: true }, { fieldKey: "quiz:1-0", value: 1 }]
  ),
  { new: 0, duplicate: 1, conflict: 1 },
  "migration preview separates identical records from conflicts"
);

const fresh = { version: 1, days: {}, day2Choice: {}, quiz: {}, visits: {} };
assert.equal(HistoryCloud.apply(fresh, "day:1-1", true), true);
assert.equal(fresh.days["1-1"], true, "remote completion can fill a blank new device");
assert.equal(HistoryCloud.apply(fresh, "day2:1", "book"), true);
assert.equal(HistoryCloud.apply(fresh, "day2:1", null), true);
assert.equal(Object.hasOwn(fresh.day2Choice, "1"), false, "selection removal uses a durable null row but removes only that local field");

(async () => {
  const family = "11111111-1111-4111-8111-111111111111";
  const database = [];
  let online = true;
  const legacyStorage = new MemoryStorage({ [HistoryCloud.STORAGE_KEY]: JSON.stringify(original) });
  const legacyEngine = HistoryCloud.create({ storage: legacyStorage, online: () => online });
  legacyEngine.setClient(createClient(database));
  legacyEngine.setUser(family);
  await legacyEngine.sync();
  assert.deepEqual(JSON.parse(legacyStorage.getItem(HistoryCloud.STORAGE_KEY)), original, "empty cloud never overwrites local history");

  online = false;
  const edit = JSON.parse(JSON.stringify(original));
  edit.quiz["1-0"] = 1;
  legacyEngine.commit(original, edit);
  assert.equal(database.length, 0, "offline edit does not require network");
  online = true;
  await legacyEngine.sync();
  assert.equal(database.find(row => row.field_key === "quiz:1-0").value, 1, "queued quiz change uploads after reconnection");

  const newDeviceStorage = new MemoryStorage({ [HistoryCloud.STORAGE_KEY]: JSON.stringify({ version: 1, days: {}, day2Choice: {}, quiz: {}, visits: {} }) });
  const newDeviceEngine = HistoryCloud.create({ storage: newDeviceStorage, online: () => true });
  newDeviceEngine.setClient(createClient(database));
  newDeviceEngine.setUser(family);
  await newDeviceEngine.sync();
  assert.equal(JSON.parse(newDeviceStorage.getItem(HistoryCloud.STORAGE_KEY)).quiz["1-0"], 1, "blank second device receives current cloud progress");

  database.push({ user_id: family, field_key: "day:1-1", value: false, revision: 1 });
  await legacyEngine.sync();
  assert.equal(JSON.parse(legacyStorage.getItem(HistoryCloud.STORAGE_KEY)).days["1-1"], true, "conflicting legacy completion is preserved instead of overwritten");
  assert.equal(JSON.parse(legacyStorage.getItem("heeyoon-history:sync:v1:family:v1:row:day:1-1")).conflict, true, "conflict is surfaced for parent review");
  console.log("PASS: empty-cloud preservation, reconnect upload, cross-device pull, and conflict hold.");
})().catch(error => { console.error(error); process.exitCode = 1; });

console.log("PASS: local preservation, offline queue, migration preview, and field mapping.");
