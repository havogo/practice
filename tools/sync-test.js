// Drives the real app/sync.js against the mock backend.
//
// "Device A" and "device B" are the same browser: a device is just the local
// IndexedDB plus the sync module's watermarks, so switching device means
// wiping both and signing in again.

const MOCK = "http://127.0.0.1:8799";
const EMAIL = "doctor@example.com";
const PASSWORD = "correct-horse";

export async function run(log = () => {}) {
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass: Boolean(pass), detail });
    log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const db = await import("/app/db.js");
  const store = await import("/app/store.js");
  const sync = await import("/app/sync.js");

  const STORES = ["patients", "prescriptions", "encounters", "invoices", "medicines"];

  const wipeLocal = async () => {
    for (const s of STORES) await db.clear(s);
    for (const k of ["sync.cursor", "sync.pushedAt", "sync.lastSyncAt", "sync.session"]) {
      await store.setSetting(k, null);
    }
    await sync.init();
  };

  const asDevice = async () => {
    await wipeLocal();
    await store.setSetting("sync.config", { url: MOCK, anonKey: "test-anon-key" });
    await sync.init();
    await sync.signIn(EMAIL, PASSWORD);
  };

  const serverState = async () => (await fetch(`${MOCK}/__test/state`)).json();
  const reset = async () => fetch(`${MOCK}/__test/reset`, { method: "POST" });

  // -----------------------------------------------------------------------
  await reset();

  // 1. sign in
  await store.setSetting("sync.config", { url: MOCK, anonKey: "test-anon-key" });
  await wipeLocal();
  await store.setSetting("sync.config", { url: MOCK, anonKey: "test-anon-key" });
  await sync.init();
  try {
    await sync.signIn(EMAIL, "wrong-password");
    check("bad password is rejected", false, "sign-in unexpectedly succeeded");
  } catch (err) {
    check("bad password is rejected", /invalid/i.test(err.message), err.message.slice(0, 70));
  }
  await sync.signIn(EMAIL, PASSWORD);
  check("sign in", sync.state.signedIn && sync.state.email === EMAIL, sync.state.email);

  // 2. first push
  const patientA = await store.patients.save(
    store.newPatient({ firstName: "Ada", surname: "Lovelace", dob: "1815-12-10" })
  );
  await store.prescriptions.save(
    store.newPrescription({
      patientId: patientA.id,
      status: "issued",
      items: [store.newPrescriptionItem({ name: "Metformin hydrochloride", strength: "500 mg" })],
    })
  );
  let r = await sync.run({ full: true });
  let sv = await serverState();
  check("first sync pushes everything", r.pushed === 2 && sv.rowCount === 2,
    `pushed ${r.pushed}, server has ${sv.rowCount}`);

  // 3. a second sync sends nothing new
  r = await sync.run();
  check("idle sync is a no-op", r.pushed === 0 && r.applied === 0,
    `pushed ${r.pushed}, applied ${r.applied}`);

  // 4. new device pulls everything
  await asDevice();
  r = await sync.run({ full: true });
  const pulledPatients = await store.patients.all();
  const pulledScripts = await store.prescriptions.all();
  check("second device receives the practice",
    r.applied === 2 && pulledPatients.length === 1 && pulledScripts.length === 1,
    `applied ${r.applied}, ${pulledPatients.length} patient(s), ${pulledScripts.length} script(s)`);
  check("pulled record keeps its identity",
    pulledPatients[0]?.id === patientA.id && pulledPatients[0]?.surname === "Lovelace",
    pulledPatients[0]?.surname);

  // 5. a pull must not be echoed straight back up
  const before = (await serverState()).rowCount;
  r = await sync.run();
  check("pulled records are not echoed back", r.pushed === 0,
    `pushed ${r.pushed} (server rows ${before})`);

  // 6. edit on device B, sync, then device A picks it up
  await store.patients.save({ ...pulledPatients[0], phone: "084 000 0000" });
  r = await sync.run();
  check("device B pushes its edit", r.pushed === 1, `pushed ${r.pushed}`);

  await asDevice(); // becomes device A again (fresh local, same account)
  await sync.run({ full: true });
  const seen = (await store.patients.all())[0];
  check("device A sees the edit", seen?.phone === "084 000 0000", seen?.phone);

  // 7. conflict — the later edit wins regardless of push order
  const older = { ...seen, surname: "OLDER-EDIT", updatedAt: "2020-01-01T00:00:00.000Z" };
  await db.put("patients", older);
  await sync.run();          // pushes the stale copy
  await sync.run({ full: true }); // pulls everything back
  const resolved = (await store.patients.all())[0];
  check("older edit does not overwrite newer",
    resolved.surname === "Lovelace",
    `surname is ${resolved.surname}`);

  // 8. tombstones travel
  await store.patients.remove(seen.id);
  await sync.run();
  await asDevice();
  await sync.run({ full: true });
  const afterDelete = await store.patients.all();
  const raw = await db.get("patients", seen.id);
  check("delete reaches the other device",
    afterDelete.length === 0 && raw && raw.deletedAt,
    `${afterDelete.length} visible, tombstone ${raw?.deletedAt ? "present" : "missing"}`);

  // 9. expired token is refreshed transparently
  await fetch(`${MOCK}/__test/expire`, { method: "POST" });
  await store.patients.save(store.newPatient({ firstName: "Grace", surname: "Hopper" }));
  let refreshed = true;
  try {
    r = await sync.run();
  } catch (err) {
    refreshed = false;
    check("expired token is refreshed", false, err.message.slice(0, 90));
  }
  if (refreshed) check("expired token is refreshed", r.pushed >= 1, `pushed ${r.pushed}`);

  // 10. chunking on a large first sync
  await reset();
  await asDevice();
  const bulk = [];
  for (let i = 0; i < 450; i += 1) {
    bulk.push(store.patients.save(store.newPatient({ firstName: `Bulk${i}`, surname: "Test" })));
  }
  await Promise.all(bulk);
  r = await sync.run({ full: true });
  sv = await serverState();
  check("450 records push in chunks", r.pushed === 450 && sv.rowCount === 450,
    `pushed ${r.pushed}, server has ${sv.rowCount}`);

  await asDevice();
  r = await sync.run({ full: true });
  check("450 records pull back", (await store.patients.all()).length === 450,
    `${(await store.patients.all()).length} patients`);

  // 11. clock skew — a device running slow must not be skipped
  const slow = store.newPatient({ firstName: "Slow", surname: "Clock" });
  const saved = await store.patients.save(slow);
  // Rewrite its updatedAt to well in the past, as a lagging device clock would.
  await db.put("patients", { ...saved, updatedAt: "2021-05-05T00:00:00.000Z", surname: "SlowClock" });
  await sync.run({ full: true });   // full push includes it
  await asDevice();
  await sync.run({ full: true });
  const slowSeen = (await store.patients.all()).find((p) => p.surname === "SlowClock");
  check("record with a lagging timestamp still arrives", Boolean(slowSeen),
    slowSeen ? "found" : "missing");

  // 12. signing out clears the session but keeps the records
  const kept = (await store.patients.all()).length;
  await sync.signOut();
  check("sign out keeps local records",
    !sync.state.signedIn && (await store.patients.all()).length === kept,
    `${kept} records retained`);

  const passed = results.filter((x) => x.pass).length;
  return { passed, total: results.length, results };
}
