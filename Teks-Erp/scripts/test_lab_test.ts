// =============================================================================
// BEKÇİ: K4P lab testleri — oluşturma, hüküm, onayda donma, iptal, taslak silme (K4P-LAB)
// Çalıştır: npx tsx scripts/test_lab_test.ts
// =============================================================================
// NEDEN: lab testi onayda DONAR — sonuç yazımı yalnız `status='DRAFT'` atomik talebiyle
// geçer; onaylı teste sessizce sonuç yazılırsa müşteriye verilen sonuç değişir ve kimse
// görmez. Bu bekçi kuralı servis + DB CHECK + HTTP kapısı üçlüsünde ölçer:
//   §1 tür kataloğu + CHECK `lab_test_types_kind_ck`
//   §2 oluştur: top → parti/kumaş snapshot · parti → iş emri kumaşı · konu yok 400 + CHECK
//      · numara doğuşta (LAB…) · clientToken replay (aynı kayıt) + çarpışma 409
//   §3 hüküm: sınır içi/dışı/sınırda AUTO · sınırsız → elle zorunlu · müşteri sınırı
//   §4 SCALE 0,5 adım (servis 400 + CHECK `lab_test_results_value_ck`)
//   §5 onay: sonuçsuz 400 · onay sonrası sonuç yaz/sil 409 LAB_TEST_LOCKED
//   §6 zorlanmış sıra: onay kilidi tutarken sonuç yazımı → 409; yazar kilidi tutarken onay → bekler, sonuç korunur
//   §7 iptal: gerekçe ≥ 3 · onaylı test iptal edilince approvedAt korunur · CHECK
//   §8 taslak silme serbest (sonuçlar Cascade) · onaylı silme 409
//   §9 liste + özet tek where · top kartı (forRollId) parti testini de getirir
//   §10 HTTP: modül kapalı 403 MODULE_DISABLED · izinsiz 403 · okuma izniyle yazma 403
// Negatif sonda: `claimDraftTx` WHERE'inden `status: "DRAFT"` kaldırılınca §5/§6 kırmızı.
// =============================================================================
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { createLabTest, upsertLabResult, deleteLabResult, approveLabTest, voidLabTest, deleteDraftLabTest } from "../src/services/lab-test.service";
import { listLabTests } from "../src/services/lab-test-query.service";
import { createLabTestType } from "../src/services/lab-test-type.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

/** Servis hatasının `details.code`'u (body.code hep undefined). */
async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const d = (e as { details?: { code?: string } }).details;
    return d?.code ?? (e as { code?: string }).code ?? String(e);
  }
}

/** Tek ifadeyi kendi tx'inde dener; PG hata kodu + kısıt adı döner. */
async function rawAttempt(sql: string, params: unknown[]): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    return "OK";
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    return `${err.code} ${err.constraint ?? ""}`.trim();
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TAG = `LABT${Date.now().toString(36).toUpperCase()}`;
const made = { items: [] as string[], wos: [] as string[], batches: [] as string[], rolls: [] as string[], types: [] as string[], users: [] as string[] };

async function fixtures(adminId: string) {
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} lab kumaşı`, itemType: "FABRIC" }, select: { id: true } });
  made.items.push(item.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetQuantity: 100, targetItemId: item.id },
    select: { id: true },
  });
  made.wos.push(wo.id);
  const batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-P`, workOrderId: wo.id }, select: { id: true } });
  made.batches.push(batch.id);
  const otherBatch = await prisma.batch.create({ data: { batchNumber: `${TAG}-P2`, workOrderId: wo.id }, select: { id: true } });
  made.batches.push(otherBatch.id);
  const roll = await prisma.roll.create({
    data: { barcode: `${TAG}-R`, itemId: item.id, initialQty: 100, currentQty: 100, batchId: batch.id, createdById: adminId },
    select: { id: true },
  });
  made.rolls.push(roll.id);
  return { itemId: item.id, batchId: batch.id, otherBatchId: otherBatch.id, rollId: roll.id };
}

async function cleanup(): Promise<void> {
  const tests = await prisma.labTest.findMany({ where: { OR: [{ rollId: { in: made.rolls } }, { batchId: { in: made.batches } }] }, select: { id: true } });
  const ids = tests.map((t) => t.id);
  await prisma.labTestResult.deleteMany({ where: { labTestId: { in: ids } } });
  await prisma.labTest.deleteMany({ where: { id: { in: ids } } });
  await prisma.labTestType.deleteMany({ where: { id: { in: made.types } } });
  await prisma.roll.deleteMany({ where: { id: { in: made.rolls } } });
  await prisma.batch.deleteMany({ where: { id: { in: made.batches } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: made.wos } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
}

async function sectionTypes(adminId: string) {
  console.log("§1 tür kataloğu");
  const gsm = await createLabTestType({ code: `${TAG}GSM`, name: "Gramaj", resultKind: "NUMERIC", unit: "g/m²", specMin: 200, specMax: 220 }, adminId);
  const free = await createLabTestType({ code: `${TAG}TEN`, name: "Kopma", resultKind: "NUMERIC", unit: "N" }, adminId);
  const scale = await createLabTestType({ code: `${TAG}WSH`, name: "Yıkama haslığı", resultKind: "SCALE", scaleMax: 5, specMin: 4 }, adminId);
  const pf = await createLabTestType({ code: `${TAG}FLM`, name: "Yanmazlık", resultKind: "PASS_FAIL" }, adminId);
  made.types.push(gsm.id, free.id, scale.id, pf.id);
  check("SCALE türü varsayılan tavanla doğar", scale.scaleMax === 5);
  check("aynı kod ikinci kez → 409 LAB_TYPE_CODE_TAKEN", (await errCode(createLabTestType({ code: `${TAG}GSM`, name: "x", resultKind: "NUMERIC" }, adminId))) === "LAB_TYPE_CODE_TAKEN");
  const r = await rawAttempt(
    `INSERT INTO lab_test_types (id, code, name, "resultKind", "scaleMax", "updatedAt") VALUES ($1, $2, 'x', 'NUMERIC', 5, now())`,
    [randomUUID(), `${TAG}BAD`],
  );
  check("CHECK: NUMERIC türde scaleMax → 23514", r === "23514 lab_test_types_kind_ck", r);
  return { gsm: gsm.id, free: free.id, scale: scale.id, pf: pf.id };
}

async function sectionCreate(adminId: string, fx: Awaited<ReturnType<typeof fixtures>>) {
  console.log("§2 oluşturma + replay");
  check("konu yok → 400 LAB_SUBJECT_REQUIRED", (await errCode(createLabTest({ clientToken: randomUUID() }, adminId))) === "LAB_SUBJECT_REQUIRED");
  const raw = await rawAttempt(
    `INSERT INTO lab_tests (id, "testNo", "itemId", "testedOn", "updatedAt") VALUES ($1, $2, $3, current_date, now())`,
    [randomUUID(), `${TAG}-X`, fx.itemId],
  );
  check("CHECK: rollId ve batchId ikisi boş → 23514", raw === "23514 lab_tests_subject_ck", raw);
  check("top başka partiye → 400 LAB_SUBJECT_MISMATCH", (await errCode(createLabTest({ rollId: fx.rollId, batchId: fx.otherBatchId }, adminId))) === "LAB_SUBJECT_MISMATCH");
  const token = randomUUID();
  const t = await createLabTest({ clientToken: token, rollId: fx.rollId, sampleCode: "N-1" }, adminId);
  check("top verilince parti snapshot'ı topun partisi", t.batchId === fx.batchId && t.itemId === fx.itemId);
  check("numara doğuşta LAB önekli", /^LAB\d+/.test(t.testNo) && t.status === "DRAFT", t.testNo);
  const again = await createLabTest({ clientToken: token, rollId: fx.rollId, sampleCode: "N-1" }, adminId);
  check("aynı token → aynı test (replay)", again.id === t.id && (await prisma.labTest.count({ where: { clientToken: token } })) === 1);
  const clash = await errCode(createLabTest({ clientToken: token, batchId: fx.otherBatchId }, adminId));
  check("aynı token + başka konu → 409 CLIENT_TOKEN_COLLISION", clash === "CLIENT_TOKEN_COLLISION", clash);
  const b = await createLabTest({ batchId: fx.batchId }, adminId);
  check("yalnız parti → kumaş iş emri hedefinden", b.itemId === fx.itemId && b.rollId === null);
  check("ileri tarih → 400", (await errCode(createLabTest({ rollId: fx.rollId, testedOn: "2999-01-01" }, adminId))) === "LAB_TESTED_ON_INVALID");
  return { testId: t.id, batchTestId: b.id };
}

async function sectionVerdict(adminId: string, testId: string, ty: Awaited<ReturnType<typeof sectionTypes>>) {
  console.log("§3 hüküm");
  const verdictOf = async (value: number, extra: Record<string, number | null> = {}) => {
    const d = await upsertLabResult(testId, { testTypeId: ty.gsm, value, ...extra }, adminId);
    const r = d.results.find((x) => x.testTypeId === ty.gsm)!;
    return `${r.verdict}/${r.verdictSource}`;
  };
  check("sınır içi (210) → PASS/AUTO", (await verdictOf(210)) === "PASS/AUTO");
  check("sınır dışı (230) → FAIL/AUTO", (await verdictOf(230)) === "FAIL/AUTO");
  check("alt sınırda (200) → PASS/AUTO", (await verdictOf(200)) === "PASS/AUTO");
  check("üst sınırda (220) → PASS/AUTO", (await verdictOf(220)) === "PASS/AUTO");
  check("müşteri sınırı 225–240 ile 230 → PASS/AUTO", (await verdictOf(230, { specMin: 225, specMax: 240 })) === "PASS/AUTO");
  check("sınırsız tür hükümsüz → 400 LAB_VERDICT_REQUIRED", (await errCode(upsertLabResult(testId, { testTypeId: ty.free, value: 500 }, adminId))) === "LAB_VERDICT_REQUIRED");
  const m = await upsertLabResult(testId, { testTypeId: ty.free, value: 500, verdict: "FAIL" }, adminId);
  check("sınırsız tür elle → FAIL/MANUAL", m.results.some((r) => r.testTypeId === ty.free && r.verdict === "FAIL" && r.verdictSource === "MANUAL"));
  check("PASS_FAIL türde sayı → 400", (await errCode(upsertLabResult(testId, { testTypeId: ty.pf, value: 1, verdict: "PASS" }, adminId))) === "LAB_VALUE_INVALID");
  await upsertLabResult(testId, { testTypeId: ty.pf, value: null, verdict: "PASS" }, adminId);
  check("tür başına tek satır (upsert)", (await prisma.labTestResult.count({ where: { labTestId: testId, testTypeId: ty.gsm } })) === 1);
}

async function sectionScale(adminId: string, testId: string, ty: Awaited<ReturnType<typeof sectionTypes>>) {
  console.log("§4 SCALE 0,5 adım");
  const ok = await upsertLabResult(testId, { testTypeId: ty.scale, value: 4.5 }, adminId);
  const r = ok.results.find((x) => x.testTypeId === ty.scale)!;
  check("4,5 kabul, AUTO PASS (alt sınır 4)", Number(r.value) === 4.5 && r.verdict === "PASS" && r.verdictSource === "AUTO");
  check("4,3 → 400 LAB_VALUE_INVALID", (await errCode(upsertLabResult(testId, { testTypeId: ty.scale, value: 4.3 }, adminId))) === "LAB_VALUE_INVALID");
  check("6 (tavan 5 üstü) → 400", (await errCode(upsertLabResult(testId, { testTypeId: ty.scale, value: 6 }, adminId))) === "LAB_VALUE_INVALID");
  const raw = await rawAttempt(`UPDATE lab_test_results SET value = 4.3 WHERE id = $1`, [r.id]);
  check("CHECK: SCALE 4,3 → 23514", raw === "23514 lab_test_results_value_ck", raw);
}

async function sectionApprove(adminId: string, fx: Awaited<ReturnType<typeof fixtures>>, testId: string, ty: Awaited<ReturnType<typeof sectionTypes>>) {
  console.log("§5 onay ve donma");
  const empty = await createLabTest({ rollId: fx.rollId }, adminId);
  check("sonuçsuz onay → 400 LAB_TEST_EMPTY", (await errCode(approveLabTest(empty.id, adminId))) === "LAB_TEST_EMPTY");
  check("başarısız onay DRAFT bıraktı", (await prisma.labTest.findUnique({ where: { id: empty.id } }))?.status === "DRAFT");
  const a = await approveLabTest(testId, adminId);
  check("onay → APPROVED + damga", a.status === "APPROVED" && a.approvedAt !== null && a.approvedBy?.id === adminId);
  const before = await prisma.labTestResult.findUnique({ where: { labTestId_testTypeId: { labTestId: testId, testTypeId: ty.gsm } } });
  check("onaylı teste sonuç yazma → 409 LAB_TEST_LOCKED", (await errCode(upsertLabResult(testId, { testTypeId: ty.gsm, value: 999 }, adminId))) === "LAB_TEST_LOCKED");
  const after = await prisma.labTestResult.findUnique({ where: { labTestId_testTypeId: { labTestId: testId, testTypeId: ty.gsm } } });
  check("onaylı sonucun değeri değişmedi", String(before?.value) === String(after?.value), `${before?.value} → ${after?.value}`);
  check("onaylı testten sonuç silme → 409 LAB_TEST_LOCKED", (await errCode(deleteLabResult(testId, ty.free, adminId))) === "LAB_TEST_LOCKED");
  check("ikinci onay → 409 LAB_TEST_LOCKED", (await errCode(approveLabTest(testId, adminId))) === "LAB_TEST_LOCKED");
  return empty.id;
}

/** Yarışı zorlanmış sırayla kurar: `holder` kilidi tutan ham tx, `contender` servis çağrısı. */
async function forcedOrder(holderSql: Array<[string, unknown[]]>, contender: () => Promise<unknown>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const [sql, params] of holderSql) await c.query(sql, params);
    let settled = false;
    const p = errCode(contender()).finally(() => { settled = true; });
    await sleep(400);
    const waited = !settled;
    await c.query("COMMIT");
    return { waited, code: await p };
  } finally {
    c.release();
  }
}

async function sectionRace(adminId: string, emptyId: string, ty: Awaited<ReturnType<typeof sectionTypes>>, fx: Awaited<ReturnType<typeof fixtures>>) {
  console.log("§6 zorlanmış sıra");
  // (a) onay önce: kilit onayda; sonuç yazımı bekler ve 409 alır.
  await upsertLabResult(emptyId, { testTypeId: ty.gsm, value: 210 }, adminId);
  const a = await forcedOrder(
    [[`UPDATE lab_tests SET status = 'APPROVED', "approvedAt" = now(), "approvedById" = $2 WHERE id = $1 AND status = 'DRAFT'`, [emptyId, adminId]]],
    () => upsertLabResult(emptyId, { testTypeId: ty.free, value: 1, verdict: "PASS" }, adminId),
  );
  check("onay kilidi tutarken sonuç yazımı bekledi", a.waited);
  check("onay commit'inden sonra sonuç yazımı → 409 LAB_TEST_LOCKED", a.code === "LAB_TEST_LOCKED", a.code);
  check("onaylı teste satır sızmadı", (await prisma.labTestResult.count({ where: { labTestId: emptyId, testTypeId: ty.free } })) === 0);
  // (b) yazar önce: yazar ebeveyni talep edip sonucu ekler; onay bekler, sonra sonucu da kapsayarak onaylar.
  const t = await createLabTest({ rollId: fx.rollId }, adminId);
  const b = await forcedOrder(
    [
      [`UPDATE lab_tests SET "updatedById" = $2 WHERE id = $1 AND status = 'DRAFT'`, [t.id, adminId]],
      [`INSERT INTO lab_test_results (id, "labTestId", "testTypeId", "resultKind", value, "specMin", "specMax", unit, verdict, "verdictSource", "updatedAt")
        VALUES ($1, $2, $3, 'NUMERIC', 210, 200, 220, 'g/m²', 'PASS', 'AUTO', now())`, [randomUUID(), t.id, ty.gsm]],
    ],
    () => approveLabTest(t.id, adminId),
  );
  check("yazar kilidi tutarken onay bekledi", b.waited);
  check("onay yazarın sonucunu kapsayarak geçti", b.code === "OK" && (await prisma.labTest.findUnique({ where: { id: t.id } }))?.status === "APPROVED", b.code);
}

async function sectionVoidDelete(adminId: string, testId: string, fx: Awaited<ReturnType<typeof fixtures>>, ty: Awaited<ReturnType<typeof sectionTypes>>) {
  console.log("§7 iptal");
  check("gerekçe 'ab' → 400", (await errCode(voidLabTest(testId, " ab ", adminId))) === "LAB_VOID_REASON_REQUIRED");
  const v = await voidLabTest(testId, "Numune karıştı", adminId);
  check("onaylı test iptal → VOIDED, approvedAt korunur", v.status === "VOIDED" && v.approvedAt !== null && v.voidReason === "Numune karıştı");
  check("ikinci iptal → 409", (await errCode(voidLabTest(testId, "tekrar", adminId))) === "LAB_TEST_ALREADY_VOIDED");
  const raw = await rawAttempt(`UPDATE lab_tests SET "voidedAt" = NULL WHERE id = $1`, [testId]);
  check("CHECK: VOIDED damgasız → 23514", raw === "23514 lab_tests_voided_ck", raw);
  const raw2 = await rawAttempt(`UPDATE lab_tests SET status = 'APPROVED', "approvedAt" = NULL, "approvedById" = NULL, "voidedAt" = NULL, "voidedById" = NULL, "voidReason" = NULL WHERE id = $1`, [testId]);
  check("CHECK: APPROVED onaysız → 23514", raw2 === "23514 lab_tests_approved_ck", raw2);
  check("iptal edilmiş testin token'ı replay edilmez (409)", await (async () => {
    const tok = randomUUID();
    const t = await createLabTest({ clientToken: tok, rollId: fx.rollId }, adminId);
    await voidLabTest(t.id, "deneme iptali", adminId);
    return (await errCode(createLabTest({ clientToken: tok, rollId: fx.rollId }, adminId))) === "LAB_TEST_VOIDED";
  })());

  console.log("§8 taslak silme");
  const d = await createLabTest({ rollId: fx.rollId }, adminId);
  await upsertLabResult(d.id, { testTypeId: ty.gsm, value: 205 }, adminId);
  await deleteDraftLabTest(d.id, adminId);
  check("DRAFT silindi, sonuçları da", (await prisma.labTest.count({ where: { id: d.id } })) === 0 && (await prisma.labTestResult.count({ where: { labTestId: d.id } })) === 0);
  check("iptal edilmiş/onaylı test silinemez → 409 LAB_TEST_NOT_DRAFT", (await errCode(deleteDraftLabTest(testId, adminId))) === "LAB_TEST_NOT_DRAFT");
  check("silinemeyen test yerinde", (await prisma.labTest.count({ where: { id: testId } })) === 1);
}

async function sectionList(fx: Awaited<ReturnType<typeof fixtures>>, batchTestId: string) {
  console.log("§9 liste + özet");
  const l = await listLabTests({ forRollId: fx.rollId, limit: 2 });
  const all = await prisma.labTest.count({ where: { OR: [{ rollId: fx.rollId }, { rollId: null, batchId: fx.batchId }] } });
  check("özet toplamı listenin where'iyle aynı", l.summary.total === all, `${l.summary.total} = ${all}`);
  check("cursor ikinci sayfa verir", l.items.length === 2 && l.nextCursor !== null);
  const every = [] as string[];
  for (let cur: string | undefined; ;) {
    const p = await listLabTests({ forRollId: fx.rollId, limit: 2, cursor: cur });
    every.push(...p.items.map((i) => i.id));
    if (!p.nextCursor) break;
    cur = p.nextCursor;
  }
  check("cursor tüm satırları tekrarsız gezer", every.length === all && new Set(every).size === all);
  check("top kartı partinin parti düzeyi testini de getirir", every.includes(batchTestId));
  check("tanınmayan durum süzgeci → 400", (await errCode(listLabTests({ status: "BOGUS" }))) === "LAB_FILTER_INVALID");
  const v = await listLabTests({ forRollId: fx.rollId, status: "VOIDED" });
  check("durum süzgeci özet şeridini de süzer", v.summary.total === v.summary.voided && v.items.every((i) => i.status === "VOIDED"));
  const bn = (await prisma.batch.findUnique({ where: { id: fx.batchId }, select: { batchNumber: true } }))?.batchNumber ?? "";
  const byNo = await listLabTests({ batchNo: bn, limit: 200 });
  check("parti no süzgeci yalnız o partinin testleri", byNo.items.length > 0 && byNo.items.every((i) => i.batch?.id === fx.batchId) && byNo.summary.total === byNo.items.length);
  const anyResult = await prisma.labTestResult.findFirst({ where: { labTest: { batchId: fx.batchId } }, select: { testTypeId: true } });
  const byType = await listLabTests({ testTypeId: anyResult?.testTypeId, limit: 200 });
  const typeIds = new Set((await prisma.labTestResult.findMany({ where: { testTypeId: anyResult?.testTypeId }, select: { labTestId: true } })).map((r) => r.labTestId));
  check("test türü süzgeci = o türden sonucu olan testler", byType.items.length === typeIds.size && byType.items.every((i) => typeIds.has(i.id)));
  const pass = await listLabTests({ verdict: "PASS", limit: 200 });
  const fail = await listLabTests({ verdict: "FAIL", limit: 200 });
  check("Geçti ve Kaldı süzgeçleri ayrık; Geçti sonuçsuz testi almaz", pass.items.every((i) => !i.hasFail && i.resultCount > 0) && fail.items.every((i) => i.hasFail));
  check("tanınmayan tür kimliği → 400", (await errCode(listLabTests({ testTypeId: "bogus" }))) === "LAB_FILTER_INVALID");
}

async function sectionHttp(admin: { id: string; username: string; password: string }) {
  console.log("§10 HTTP kapıları");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const login = async (username: string, password: string) => {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, token: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { details?: { code?: string } };
      return { status: r.status, code: j.details?.code };
    };
    const adminToken = await login(admin.username, admin.password);
    check("admin login", adminToken.length > 0);
    const bcrypt = await import("bcryptjs");
    const parola = kosumaOzguParola();
    const mk = async (suffix: string, perms: string[]) => {
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      made.users.push(u.id);
      return login(u.username, parola);
    };
    const readerToken = await mk("okur", ["labtest:read"]);
    const noneToken = await mk("yok", ["roll:read"]);

    await prisma.systemSetting.upsert({ where: { key: "kaliteGuvence.enabled" }, update: { value: false }, create: { key: "kaliteGuvence.enabled", value: false } });
    const off = await call("GET", "/api/lab-tests", adminToken);
    check("modül kapalı → 403 MODULE_DISABLED", off.status === 403 && off.code === "MODULE_DISABLED", `${off.status} ${off.code}`);
    const offTypes = await call("GET", "/api/lab-test-types", adminToken);
    check("modül kapalı (tür kataloğu) → 403 MODULE_DISABLED", offTypes.status === 403 && offTypes.code === "MODULE_DISABLED");

    await prisma.systemSetting.update({ where: { key: "kaliteGuvence.enabled" }, data: { value: true } });
    check("modül açık + admin → 200", (await call("GET", "/api/lab-tests", adminToken)).status === 200);
    if (readerToken) {
      check("labtest:read ile liste 200", (await call("GET", "/api/lab-tests", readerToken)).status === 200);
      check("labtest:read ile oluşturma 403", (await call("POST", "/api/lab-tests", readerToken, { batchId: randomUUID() })).status === 403);
      check("labtest:read ile onay 403", (await call("POST", `/api/lab-tests/${randomUUID()}/approve`, readerToken)).status === 403);
    } else check("okur kullanıcı login", false, "token alınamadı");
    if (noneToken) check("izinsiz liste 403", (await call("GET", "/api/lab-tests", noneToken)).status === 403);
    const strict = await call("POST", "/api/lab-tests", adminToken, { batchId: randomUUID(), bogus: 1 });
    check("strict gövde: tanınmayan alan → 400", strict.status === 400, `${strict.status}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function main(): Promise<void> {
  console.log("=== K4P lab testi bekçisi ===\n");
  const flagPrior = await prisma.systemSetting.findUnique({ where: { key: "kaliteGuvence.enabled" }, select: { value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  try {
    const fx = await fixtures(admin.id);
    const ty = await sectionTypes(admin.id);
    const { testId, batchTestId } = await sectionCreate(admin.id, fx);
    await sectionVerdict(admin.id, testId, ty);
    await sectionScale(admin.id, testId, ty);
    const emptyId = await sectionApprove(admin.id, fx, testId, ty);
    await sectionRace(admin.id, emptyId, ty, fx);
    await sectionVoidDelete(admin.id, testId, fx, ty);
    await sectionList(fx, batchTestId);
    await sectionHttp(admin);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    if (flagPrior) await prisma.systemSetting.update({ where: { key: "kaliteGuvence.enabled" }, data: { value: flagPrior.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: "kaliteGuvence.enabled" } });
    await cleanup().catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

void main();
