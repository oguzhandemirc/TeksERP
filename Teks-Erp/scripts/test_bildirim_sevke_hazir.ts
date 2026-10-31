// =============================================================================
// BEKÇİ — SEVKE HAZIR BİLDİRİMİ (D4-J2; DALGA4 §11.5, §12.1 `shipping.ready.notifyUnits`, §12.2, §13 D4-J2)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_sevke_hazir
// =============================================================================
//   §0 statik — yüklem KOPYALANMAZ: `notification-sources/` altında hazırlık sınıflayıcısı/statü kümesi/sayaç
//      kıyası yok; `is.ts` gerçek okuyucusu `computeReadyWorks` (→ `ship-readiness.helper`) ve yalnız `state`e bakar.
//   §1 ⭐ notifyUnits boş (kayıt yok) → konu 0, koşul satırı 0, outbox 0 (bugünkü davranış bayt-aynı)
//   §2 {PARTI}: ilk tur SESSİZ TABAN · tabandan sonra READY'ye geçen parti → tek ACILDI · sürer → yeni yok ·
//      PARTIAL parti konu değil · periyot dolmadan top geri açılsa da koşul KORUNUR · periyot dolunca KAPANDI +
//      "çözüldü" metni · yük = katalog beyanı (tutar yok) · shipping:read'li alır, shipping:read'siz almaz
//   §3 gelen belge modülü kapalı → PARTI/GB konusu yok (uç 403 verdiği birim bildirim de doğurmaz)
//   §4 ⭐ tarama sorgu bütçesi: sorgu sayısı READY birim sayısından bağımsız (1 parti ↔ 4 parti EŞİT) ve ≤ 8
//   §5 ⭐ (D4-KUC3a) gelen belge modülü kapalıdan açığa geçince taban damgası düşer → ilk tur sessiz (toplu bildirim yok);
//      açıkken yeniden kayıt ve yalnız IE açıkken açılış damgayı korur
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31, geri alındı): bkz. BEKCI-HARITASI satırı.
// Global ayar yazar (gelen kutusu, gelen belge, emanet, shipping.ready.*, taban damgası); `finally`de geri koyar.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG } from "../src/constants/notification-catalog";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { runConditionSourceOnce } from "../src/jobs/notification-condition.job";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { renderNotification } from "../src/services/helpers/notification-render.helper";
import { notificationBaselineKey } from "../src/services/helpers/notification-baseline.helper";
import { READY_WORK_KIND, readyWorkSubjects, registerReadyWorkConditionSource, resetReadyWorkScanClock } from "../src/services/notification-sources/is";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// Sorgu sayacı — pg istemcisini sarar (yalnız ölçüm penceresinde sayar); ilk sorgudan ÖNCE kurulmalı.
let capture = false;
let queries = 0;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) queries++;
    return orig(...args);
  };
});
async function measure(fn: () => Promise<unknown>): Promise<number> {
  queries = 0;
  capture = true;
  try { await fn(); } finally { capture = false; }
  return queries;
}

const SRC = join(__dirname, "..", "src");
const TAG = `TEST-BSH-${process.pid}`;
const BASLANGIC = new Date(Date.now() - 1000);
const KIND = READY_WORK_KIND;
const AYARLAR = [
  SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.EMANET_ENABLED,
  SETTING_KEYS.SHIPPING_READY_NOTIFY_UNITS, SETTING_KEYS.SHIPPING_READY_SCAN_MINUTES, SETTING_KEYS.SHIPPING_READY_RULE,
  SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT, notificationBaselineKey(KIND),
];
const ids = { item: "", customers: [] as string[], rolls: [] as string[], notes: [] as string[], users: [] as string[] };

// ── §0 statik ────────────────────────────────────────────────────────────────
/** Hazırlık yüklemini yeniden kuran izler: sınıflayıcı/küme adları, statü literal'i, sayaç kıyası. */
export function predicateCopies(file: string, text: string): string[] {
  const rules: Array<[string, RegExp]> = [
    ["hazırlık sınıflayıcısı", /\b(classifyShipReadiness|readinessClassOf|readinessClassSql|effectiveShipReadyPolicy\(\)\.then)\b/],
    ["statü kümesi", /\bSHIP_READY_\w*STATUSES\b|\bREADY_STATUSES\b|RollStatus\.(WAREHOUSE|A1_STOCK|IN_PRODUCTION)|["'](WAREHOUSE|A1_STOCK|IN_PRODUCTION)["']/],
    ["sayaç kıyası", /\b(inProcessCount|inProcessMeters|targetMeters|shippedMeters|scrapMeters)\b|\breadyCount\s*[<>=!]|\breadyMeters\s*[<>=!]/],
  ];
  return rules.filter(([, re]) => re.test(text)).map(([ad]) => `${file}: ${ad}`);
}
function statik(): void {
  const dir = join(SRC, "services/notification-sources");
  const copies = readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) => predicateCopies(f, readFileSync(join(dir, f), "utf8")));
  check("§0a ⭐ notification-sources/ altında hazırlık yüklemi kopyası yok", copies.length === 0, copies.join(" · ") || "temiz");
  const sonda = predicateCopies("y.ts", "if (r.inProcessCount === 0 && r.readyCount > 0) x(RollStatus.WAREHOUSE);");
  check("§0b sonda: kopya tarayıcısı sayaç kıyasını ve statüyü görür", sonda.length === 2, sonda.join(", "));
  const is = readFileSync(join(dir, "is.ts"), "utf8");
  check("§0c is.ts gerçek okuyucusu computeReadyWorks + effectiveShipReadyPolicy; karar yalnız `state`ten",
    /computeReadyWorks\(unit, await effectiveShipReadyPolicy\(\)\)/.test(is) && /r\.state !== "READY"/.test(is));
}

// ── DB yardımcıları ────────────────────────────────────────────────────────────
async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null || value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
}
async function person(ad: string, codes: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `${TAG}-${ad}`.toLowerCase(), fullName: `${TAG} ${ad}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: true },
    select: { id: true },
  });
  ids.users.push(u.id);
  await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
  return u.id;
}
let seq = 0;
async function roll(owner: string, status: RollStatus, qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: `${TAG}-R${++seq}`, itemId: ids.item, status, initialQty: qty, currentQty: qty, entrySource: "SEMI_FINISHED", ownerCustomerId: owner },
    select: { id: true },
  });
  ids.rolls.push(r.id);
  return r.id;
}
/** Müşteri partisi: tek irsaliye, verilen statülerde toplar (her biri 100 m). */
async function batch(owner: string, no: string, statuses: RollStatus[]): Promise<{ key: string; rolls: string[] }> {
  const rolls: string[] = [];
  for (const s of statuses) rolls.push(await roll(owner, s, 100));
  const n = await prisma.customerDeliveryNote.create({
    data: {
      noteNo: `${TAG}-${no}`.slice(0, 32), status: "APPROVED", sourceKind: "MANUAL", ownerCustomerId: owner, customerBatchNo: no,
      lines: { create: rolls.map((rollId, i) => ({ lineNo: i + 1, meters: 100, rollId, status: "ENTERED" as const })) },
    },
    select: { id: true },
  });
  ids.notes.push(n.id);
  return { key: `customerBatch:${owner}:${no}`, rolls };
}
async function dispatch(): Promise<void> {
  for (let i = 0; i < 100; i++) if ((await runNotificationDispatchOnce()).processed === 0) break;
}
const outbox = (key: string, phase?: string) =>
  prisma.notificationOutbox.findMany({ where: { kind: KIND, subjectKey: key, createdAt: { gte: BASLANGIC }, ...(phase ? { phase } : {}) } });
const inbox = (userId: string) => prisma.notificationInbox.count({ where: { userId, kind: KIND, createdAt: { gte: BASLANGIC } } });
const openCond = (key: string) => prisma.notificationCondition.findFirst({ where: { kind: KIND, subjectKey: key, resolvedAt: null } });
async function scan() {
  resetReadyWorkScanClock();
  return runConditionSourceOnce(KIND);
}

// ── gövde ─────────────────────────────────────────────────────────────────────
async function body(): Promise<void> {
  statik();
  registerReadyWorkConditionSource();
  await setSetting(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
  await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
  await setSetting(SETTING_KEYS.EMANET_ENABLED, true);
  await setSetting(SETTING_KEYS.SHIPPING_READY_RULE, null);
  await setSetting(SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT, null);
  await setSetting(SETTING_KEYS.SHIPPING_READY_SCAN_MINUTES, null);
  const sevkci = await person("sevk", ["shipping:read", "shipping:write"]);
  const muhasebe = await person("muh", ["finance:read", "finance:invoice"]);

  ids.item = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const cust = (await prisma.customer.create({ data: { code: `${TAG}-A`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  ids.customers.push(cust);
  const W = RollStatus.WAREHOUSE;
  const P = RollStatus.IN_PRODUCTION;
  const pA = await batch(cust, "PA", [W, W]);
  const pB = await batch(cust, "PB", [W, P]);

  console.log("\n── §1 notifyUnits boş ──");
  await setSetting(SETTING_KEYS.SHIPPING_READY_NOTIFY_UNITS, null);
  await prisma.systemSetting.deleteMany({ where: { key: notificationBaselineKey(KIND) } });
  resetReadyWorkScanClock();
  const q0 = await measure(() => readyWorkSubjects());
  const bos = await scan();
  await dispatch();
  const condCount = await prisma.notificationCondition.count({ where: { kind: KIND, subjectKey: { startsWith: `customerBatch:${cust}` } } });
  check("§1 ⭐ notifyUnits boş → konu 0, koşul satırı 0, outbox 0; tek sorgu (ayar okuma)",
    (await readyWorkSubjects()).length === 0 && condCount === 0 && (await outbox(pA.key)).length === 0 && q0 <= 1,
    `${JSON.stringify(bos)} koşul=${condCount} sorgu=${q0}`);

  const stamped = async () => typeof (await prisma.systemSetting.findUnique({ where: { key: notificationBaselineKey(KIND) } }))?.value === "string";
  check("§1b boş turda da taban damgası basılır (gerçek akış — §2 bunu ELLE SİLMEZ)", await stamped());

  console.log("\n── §2 {PARTI} — panel/paket yazım yolu (setFeatureFlags) ──");
  await systemSettingService.setFeatureFlags({ shippingReadyNotifyUnits: ["PARTI"] }, sevkci);
  check("§2 ⭐ birim eklenince ayar yazımı tür damgasını düşürür", !(await stamped()));
  const t = await scan();
  await dispatch();
  check("§2a ⭐ ilk tur SESSİZ TABAN: READY parti için koşul açık, ACILDI 0",
    typeof t === "object" && t.baseline !== undefined && !!(await openCond(pA.key)) && (await outbox(pA.key)).length === 0, JSON.stringify(t));
  check("§2b PARTIAL parti konu değil", !(await openCond(pB.key)));

  await prisma.roll.update({ where: { id: pB.rolls[1]! }, data: { status: W } });
  const r2 = await scan();
  await dispatch();
  const ob = await outbox(pB.key, "ACILDI");
  check("§2c tabandan sonra READY'ye geçen parti → tek ACILDI", typeof r2 === "object" && ob.length === 1, `${JSON.stringify(r2)} acildi=${ob.length}`);
  check("§2d shipping:read'li sevkiyatçı gelen kutusunda alır; shipping:read'siz muhasebeci almaz", (await inbox(sevkci)) === 1 && (await inbox(muhasebe)) === 0);
  for (let i = 0; i < 2; i++) await scan();
  check("§2e sürer (2 tur) → yeni ACILDI yok", (await outbox(pB.key, "ACILDI")).length === 1);
  await systemSettingService.setFeatureFlags({ shippingReadyNotifyUnits: ["PARTI"] }, sevkci);
  check("§2e2 aynı küme yeniden kaydedilince damga KORUNUR (gereksiz taban yok)", await stamped());

  const pl = (ob[0]?.payload ?? {}) as Record<string, unknown>;
  const declared = [...NOTIFICATION_CATALOG[KIND].payloadAlanlari].sort();
  const money = Object.keys(pl).filter((k) => /tutar|fiyat|bakiye|amount|price|ucret|ücret/i.test(k));
  check("§2f ⭐ yük = katalog beyanı (tutar yok); top/metre doğru",
    JSON.stringify(Object.keys(pl).sort()) === JSON.stringify(declared) && money.length === 0 && pl.hazirTop === 2 && pl.hazirMetre === 200 && pl.sekme === "customerBatch",
    JSON.stringify(pl));
  const acik = renderNotification(KIND, pl, "ACILDI");
  check("§2g metin + derin bağlantı Parti sekmesine", acik.govde.includes("2 top, 200 m") && acik.yol === "/operations/sevke-hazir-isler?tab=customerBatch", `${acik.govde} · ${acik.yol}`);

  await prisma.roll.update({ where: { id: pB.rolls[0]! }, data: { status: P } });
  await runConditionSourceOnce(KIND); // saat sıfırlanmadı → periyot dolmadı
  check("§2h periyot dolmadan koşul KORUNUR (KAPANDI yok)", !!(await openCond(pB.key)) && (await outbox(pB.key, "KAPANDI")).length === 0);
  const rc = await scan();
  await dispatch();
  const kap = await outbox(pB.key, "KAPANDI");
  const kapMetin = renderNotification(KIND, (kap[0]?.payload ?? {}) as Record<string, unknown>, "KAPANDI").govde;
  check("§2i top geri açıldı → periyotta KAPANDI + 'çözüldü' metni; READY parti açık kalır",
    typeof rc === "object" && kap.length === 1 && !(await openCond(pB.key)) && kapMetin.includes("artık sevke hazır değil") && !!(await openCond(pA.key)), kapMetin);

  console.log("\n── §3 gelen belge modülü kapalı ──");
  await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, false);
  resetReadyWorkScanClock();
  const kapali = await readyWorkSubjects();
  await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
  check("§3 gelen belge kapalı → PARTI konusu yok", kapali.length === 0, `${kapali.length}`);

  console.log("\n── §4 sorgu bütçesi ──");
  resetReadyWorkScanClock();
  const q1 = await measure(() => readyWorkSubjects());
  for (const no of ["PC", "PD", "PE"]) await batch(cust, no, [W]);
  resetReadyWorkScanClock();
  let n4 = 0;
  const q4 = await measure(async () => { n4 = (await readyWorkSubjects()).filter((s) => s.key.startsWith(`customerBatch:${cust}`)).length; });
  check("§4 ⭐ tarama sorgu sayısı READY birim sayısından bağımsız (1 ↔ 4 parti) ve ≤ 8", n4 === 4 && q1 === q4 && q4 <= 8 && q1 > 0, `1 parti=${q1} · 4 parti=${q4} (konu ${n4})`);

  console.log("\n── §5 gelen belge modülü kapalıdan açığa (D4-KUC3a) ──");
  // Kapalıyken taranır (taban damgası basılır, konu yok); kapalıyken READY olan yeni parti açılışta toplu bildirim üretmemeli.
  await systemSettingService.setFeatureFlags({ gelenBelgeEnabled: false }, sevkci);
  await scan();
  check("§5 zemin: kapalıyken taranınca damga var", await stamped());
  const pF = await batch(cust, "PF", [W, W]);
  await systemSettingService.setFeatureFlags({ gelenBelgeEnabled: true }, sevkci);
  check("§5a ⭐ modül açılış yazımı tür damgasını düşürür", !(await stamped()));
  const t5 = await scan();
  await dispatch();
  check("§5b ⭐ açılıştan sonraki ilk tur SESSİZ TABAN: kapalıyken hazır olan parti için koşul açık, ACILDI 0 (toplu bildirim yok)",
    typeof t5 === "object" && t5.baseline !== undefined && !!(await openCond(pF.key)) && (await outbox(pF.key, "ACILDI")).length === 0, JSON.stringify(t5));
  await systemSettingService.setFeatureFlags({ gelenBelgeEnabled: true }, sevkci);
  check("§5c açıkken yeniden kaydetmek damgayı KORUR (gereksiz taban yok)", await stamped());
  await systemSettingService.setFeatureFlags({ shippingReadyNotifyUnits: ["IE"] }, sevkci);
  await systemSettingService.setFeatureFlags({ gelenBelgeEnabled: false }, sevkci);
  await scan();
  await systemSettingService.setFeatureFlags({ gelenBelgeEnabled: true }, sevkci);
  check("§5d yalnız IE bildirimi açıkken modül açılışı damgayı düşürmez", await stamped());
  await systemSettingService.setFeatureFlags({ shippingReadyNotifyUnits: ["PARTI"] }, sevkci);
}

async function cleanup(): Promise<void> {
  await prisma.notificationInbox.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { kind: KIND, createdAt: { gte: BASLANGIC } }] } });
  await prisma.notificationOutbox.deleteMany({ where: { kind: KIND, createdAt: { gte: BASLANGIC } } });
  await prisma.notificationCondition.deleteMany({ where: { kind: KIND, createdAt: { gte: BASLANGIC } } });
  await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: ids.notes } } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: ids.notes } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim — sevke hazır (D4-J2) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`⛔ DURDURULDU — ${engel}`);
  const snapshot = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  try {
    await body();
  } finally {
    stopNotificationJobs();
    await cleanup().catch((e) => {
      fail++;
      console.error("❌ temizlik", e);
    });
    for (const key of AYARLAR) await setSetting(key, snapshot.find((s) => s.key === key)?.value ?? null);
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ beklenmeyen hata", err);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
