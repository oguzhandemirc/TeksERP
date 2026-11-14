// =============================================================================
// BEKÇİ — `stok.yaslanan` (KOSUL): depoda N gündür (varsayılan 30) duran toplar, iki yaş kipi × iki top kapsamı
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_stok_yaslanan
// =============================================================================
// NEDEN: kullanıcı kararı 2026-11-14 "depoya giriş tarihinden say, eşik 30 gün, ayardan değişir" + iki aday kuvvetli
// → iki kip (`bildirim.stokYaslanan.kaynak`). Ölçülenler:
//   §0 katalog/ayar — KOSUL, eşik `gun` 30, yükte tutar yok; ayar kayıtsız/çöp → `depo-giris`; kaynak yüklemi helper'dan.
//   §1 depo-giris — çıpa defter girişi; 29 gün / 30 gün − 1 ms kenarı; girişsiz top durum tarihine düşer ve sayılır;
//      ölü top hariç; sevk stornosu ilk girişe döner; girişten sonra terslenmemiş çıkış → düşüş.
//   §2 durum-degisimi — çıpa `statusChangedAt`, kenar ±1 ms, düşüş yok.
//   §3 tarayıcı — taban → açıldı (ACILDI) → top sevk edilince KAPANDI ("çözüldü").
//   §4 kapsam (karar 2026-11-15, `bildirim.stokYaslanan.kapsam`) — `raf` (varsayılan) Stok & Ölü Stok raf kümesiyle
//      AYNI adet (çuvaldaki/planlı sevkiyattaki/fasondan dönmüş top yok; emanet açıkken müşteri malı yok);
//      `depodaki-her-top` hepsini sayar; ayar kayıtsız/çöp → `raf`; metinde "kapsam: raf|tümü".
//   §0e tek kaynak — rapor ve helper raf yüklemini `stock-shelf.helper.ts#shelfRollSql`ten okur (kopya yok).
// NEGATİF SONDA (2026-11-14, helper md5 ile geri alındı): ① giriş adayında `reversesMovementId IS NULL` kalktı ⇒ §1d ❌
//   (11/1) · ② düşüş dalı `statusChangedAt` yerine `e."createdAt"` ⇒ §1a/§1b/§1e ❌ (9/3) · ③ ölü küme süzgeci kalkıp
//   CANCELLED kümeye girdi ⇒ §1a/§1b/§2a/§2b ❌ (8/4).
// NEGATİF SONDA (2026-11-15, kopya + md5 ile geri alındı): ④ `shelfRollSql`ten `"sackId" IS NULL` kalktı ⇒ §4a/§4b/§4c/§4d ❌
//   (15/4) · ⑤ raf dalında emanet süzgeci kalktı ⇒ §0e/§4b/§4c ❌ (16/3) · ⑥ kapsam varsayılanı `depodaki-her-top` ⇒
//   §0f/§3a/§4d ❌ (16/3).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, RollForm, RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { NOTIFICATION_CATALOG } from "../src/constants/notification-catalog";
import { SETTING_KEYS, readStockAgingScope, readStockAgingSource } from "../src/services/system-setting.service";
import { loadShelfCells } from "../src/services/reports/stock-scorecard.report.service";
import { splitByOwnership } from "../src/services/helpers/stock-ownership.helper";
import { postStockMove } from "../src/services/helpers/warehouse-ledger.helper";
import { loadAgedStockGroups } from "../src/services/helpers/stock-aging.helper";
import { notificationBaselineKey } from "../src/services/helpers/notification-baseline.helper";
import { runConditionSourceOnce } from "../src/jobs/notification-condition.job";
import { STOCK_AGING_KIND, agedStockSubjects, overrideStockAgingDeps, registerStockAgingConditionSource } from "../src/services/notification-sources/stok-yaslanan";
import type { StockAgingScope } from "../src/services/system-setting/defaults";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const ek = Date.now().toString(36);
const DAY = 86_400_000;
const T0 = Date.now();
const ids = { wh: [] as string[], rolls: [] as string[], item: "", customer: "", sack: "", shipment: "" };
const SETTING_KEYS_TOUCHED = [SETTING_KEYS.NOTIFICATION_STOCK_AGING_SOURCE, SETTING_KEYS.NOTIFICATION_STOCK_AGING_SCOPE, SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, notificationBaselineKey(STOCK_AGING_KIND)];

async function bolum0(): Promise<void> {
  console.log("\n§0 katalog + ayar");
  const e = NOTIFICATION_CATALOG[STOCK_AGING_KIND];
  check("§0a KOSUL, eşik `gun` varsayılan 30, `cozuldu` var", e.altTur === "KOSUL" && e.paramSemasi?.parse({}).gun === 30 && !!e.cozuldu);
  check("§0b yükte tutar yok", !e.payloadAlanlari.some((a) => /tutar|fiyat|bedel|amount/i.test(a)));
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.NOTIFICATION_STOCK_AGING_SOURCE } });
  const yok = await readStockAgingSource();
  await prisma.systemSetting.create({ data: { key: SETTING_KEYS.NOTIFICATION_STOCK_AGING_SOURCE, value: "copp" } });
  const cop = await readStockAgingSource();
  check("§0c ⭐ ayar kayıtsız/çöp → depo-giris (kullanıcı kararı)", yok === "depo-giris" && cop === "depo-giris", `${yok}/${cop}`);
  const src = readFileSync(join(__dirname, "..", "src", "services", "notification-sources", "stok-yaslanan.ts"), "utf8");
  check("§0d kaynak yüklemi kopyalamaz (helper'dan, ham SQL yok)", src.includes("loadAgedStockGroups") && !/warehouse_movements|queryRaw/.test(src));
  const oku = (...p: string[]) => readFileSync(join(__dirname, "..", "src", "services", ...p), "utf8");
  const rapor = oku("reports", "stock-scorecard.report.service.ts");
  const yardimci = oku("helpers", "stock-aging.helper.ts");
  check("§0e ⭐ raf yüklemi TEK kaynak: rapor ve yaşlanma helper'ı `shelfRollSql`ten okur, ikisinde de elle `sackId`/`shipmentId` süzgeci yok",
    rapor.includes('shelfRollSql("r")') && yardimci.includes('shelfRollSql("r")') && yardimci.includes('consignedRollSql("r")')
      && ![rapor, yardimci].some((t) => /"sackId"\s+IS\s+NULL|"shipmentId"\s+IS\s+NULL/i.test(t))
      && src.includes("readEmanetEnabled") && rapor.includes("readEmanetEnabled"));
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.NOTIFICATION_STOCK_AGING_SCOPE } });
  const kYok = await readStockAgingScope();
  await prisma.systemSetting.create({ data: { key: SETTING_KEYS.NOTIFICATION_STOCK_AGING_SCOPE, value: "copp" } });
  const kCop = await readStockAgingScope();
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.NOTIFICATION_STOCK_AGING_SCOPE } });
  check("§0f ⭐ kapsam kayıtsız/çöp → raf (karar 2026-11-15)", kYok === "raf" && kCop === "raf", `${kYok}/${kCop}`);
}

async function mkWarehouse(tag: string): Promise<string> {
  const w = await prisma.warehouse.create({ data: { code: `TEST-SY-${tag}-${ek}`, name: `TEST-SY ${tag} ${ek}` }, select: { id: true } });
  ids.wh.push(w.id);
  return w.id;
}

type RollExtra = { sackId?: string; shipmentId?: string; ownerCustomerId?: string };
async function mkRoll(tag: string, warehouseId: string | null, statusChangedAt: number, status: RollStatus = RollStatus.WAREHOUSE, extra: RollExtra = {}): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: `TEST-SY-${tag}-${ek}`, itemId: ids.item, initialQty: 100, currentQty: 100, status, form: RollForm.TOP, warehouseId, statusChangedAt: new Date(statusChangedAt), ...extra },
    select: { id: true },
  });
  ids.rolls.push(r.id);
  return r.id;
}

type Move = { roll: string; type: WarehouseEventType; from?: string; to?: string; fromStatus?: RollStatus; toStatus?: RollStatus; reverses?: string };
async function move(m: Move): Promise<{ id: string; at: number }> {
  const id = await prisma.$transaction((tx) => postStockMove(tx, {
    rollId: m.roll, eventType: m.type, qty: 100, reasonCode: "TEST",
    from: m.from !== undefined || m.fromStatus ? { warehouseId: m.from ?? null, status: m.fromStatus ?? RollStatus.WAREHOUSE } : undefined,
    to: m.to !== undefined || m.toStatus ? { warehouseId: m.to ?? null, status: m.toStatus ?? RollStatus.WAREHOUSE } : undefined,
    reversesMovementId: m.reverses ?? null,
  }));
  const row = await prisma.warehouseMovement.findUniqueOrThrow({ where: { id }, select: { createdAt: true } });
  return { id, at: row.createdAt.getTime() };
}

// §1–§2 yaş çıpasını ölçer; kapsamı PR #723'ün kümesinde (`depodaki-her-top`) sabit tutar. Kapsam §4'te.
const groups = (source: "depo-giris" | "durum-degisimi", cutoff: number, wh: string, scope: StockAgingScope = "depodaki-her-top", emanetOn = false) =>
  loadAgedStockGroups(prisma, { source, scope, emanetOn, cutoff: new Date(cutoff), warehouseIds: [wh] }).then((g) => g[0] ?? { rollCount: 0, fallbackCount: 0, meters: 0 });

async function bolum12(): Promise<void> {
  console.log("\n§1 depo-giris · §2 durum-degisimi");
  const A = await mkWarehouse("A");
  const B = await mkWarehouse("B");
  const r1 = await mkRoll("r1", A, T0 + 10 * DAY); // giriş eski, durum yeni
  const r2 = await mkRoll("r2", A, T0 - 20 * DAY); // durum eski
  await mkRoll("r3", A, T0 - 40 * DAY); // hareketsiz → düşüş
  let olu = "deposuz";
  try { await mkRoll("r5", A, T0 - 40 * DAY, RollStatus.CANCELLED); olu = "depolu"; } catch { await mkRoll("r5b", null, T0 - 40 * DAY, RollStatus.CANCELLED); }
  const e1 = await move({ roll: r1, type: WarehouseEventType.ENTRY, to: A });
  const e2 = await move({ roll: r2, type: WarehouseEventType.ENTRY, to: A });
  const lo = Math.min(e1.at, e2.at);
  const hi = Math.max(e1.at, e2.at);
  const g30 = await groups("depo-giris", hi, A);
  check(`§1a ⭐ 30 gün: girişli 2 + girişsiz 1 (düşüş sayılır), ölü top (${olu}) hariç`, g30.rollCount === 3 && g30.fallbackCount === 1 && g30.meters === 300, JSON.stringify(g30));
  const g29 = await groups("depo-giris", hi - DAY, A);
  const gKenar = await groups("depo-giris", lo - 1, A);
  check("§1b ⭐ 29 gün ve 30 gün − 1 ms: yalnız girişsiz top", g29.rollCount === 1 && gKenar.rollCount === 1 && gKenar.fallbackCount === 1, `${g29.rollCount}/${gKenar.rollCount}`);

  const r4 = await mkRoll("r4", B, T0 + 10 * DAY);
  const e4 = await move({ roll: r4, type: WarehouseEventType.ENTRY, to: B });
  const s4 = await move({ roll: r4, type: WarehouseEventType.SHIPMENT, from: B, toStatus: RollStatus.SHIPPED });
  await move({ roll: r4, type: WarehouseEventType.SHIPMENT_REVERSAL, fromStatus: RollStatus.SHIPPED, to: B, reverses: s4.id });
  const gS = await groups("depo-giris", e4.at, B);
  check("§1d ⭐ sevk stornosu ilk girişe döner (ters kayıt giriş değil, terslenen çıkış yok sayılır)", gS.rollCount === 1 && gS.fallbackCount === 0, JSON.stringify(gS));
  const r6 = await mkRoll("r6", B, T0 - 40 * DAY, RollStatus.STOCK);
  await move({ roll: r6, type: WarehouseEventType.ENTRY, to: B, toStatus: RollStatus.STOCK });
  await move({ roll: r6, type: WarehouseEventType.PRODUCTION, from: B, fromStatus: RollStatus.STOCK, toStatus: RollStatus.IN_PRODUCTION });
  const gT = await groups("depo-giris", e4.at - 1, B);
  check("§1e girişten sonra terslenmemiş çıkış (tutarsız defter) → durum tarihine düşer, sayılır", gT.rollCount === 1 && gT.fallbackCount === 1, JSON.stringify(gT));

  const sc2 = (await prisma.roll.findUniqueOrThrow({ where: { id: r2 }, select: { statusChangedAt: true } })).statusChangedAt!.getTime();
  const d30 = await groups("durum-degisimi", hi, A);
  const dEsit = await groups("durum-degisimi", sc2, A);
  const dOnce = await groups("durum-degisimi", sc2 - 1, A);
  check("§2a ⭐ durum kipinde çıpa statusChangedAt (r1 girişi eski ama durumu yeni → sayılmaz), düşüş yok", d30.rollCount === 2 && d30.fallbackCount === 0, JSON.stringify(d30));
  check("§2b kenar: çıpa = eşik sayılır, 1 ms önce sayılmaz", dEsit.rollCount === 2 && dOnce.rollCount === 1, `${dEsit.rollCount}/${dOnce.rollCount}`);
}

async function bolum3(): Promise<void> {
  console.log("\n§3 koşul tarayıcısı: aç → çözüldü");
  registerStockAgingConditionSource();
  const C = await mkWarehouse("C");
  const r8 = await mkRoll("r8", C, T0);
  const e8 = await move({ roll: r8, type: WarehouseEventType.ENTRY, to: C });
  await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED }, create: { key: SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, value: true }, update: { value: true } });
  await prisma.systemSetting.deleteMany({ where: { key: { in: [notificationBaselineKey(STOCK_AGING_KIND), SETTING_KEYS.NOTIFICATION_STOCK_AGING_SOURCE] } } });
  const geri = overrideStockAgingDeps({ warehouseIds: [C], now: () => new Date(e8.at + 29 * DAY), emanetOn: async () => false });
  try {
    const t1 = await runConditionSourceOnce(STOCK_AGING_KIND);
    overrideStockAgingDeps({ now: () => new Date(e8.at + 30 * DAY) });
    const t2 = await runConditionSourceOnce(STOCK_AGING_KIND);
    const ac = await prisma.notificationOutbox.findFirst({ where: { kind: STOCK_AGING_KIND, subjectKey: C, phase: "ACILDI" }, select: { payload: true } });
    const p = (ac?.payload ?? {}) as Record<string, unknown>;
    check("§3a ⭐ taban (29 gün, sessiz) → 30 gün ACILDI, yük adet/gün/metre/kapsam(raf varsayılan)/yaş kaynağı", typeof t1 === "object" && t1.baseline === 0 && typeof t2 === "object" && t2.opened === 1
      && p.adet === 1 && p.gun === 30 && p.metre === 100 && p.kapsam === "raf" && p.yasKaynagi === "depoya girişten", `${JSON.stringify(t1)} ${JSON.stringify(t2)} ${JSON.stringify(p)}`);
    await prisma.roll.update({ where: { id: r8 }, data: { status: RollStatus.SHIPPED, warehouseId: null } });
    await move({ roll: r8, type: WarehouseEventType.SHIPMENT, from: C, toStatus: RollStatus.SHIPPED });
    const t3 = await runConditionSourceOnce(STOCK_AGING_KIND);
    const kap = await prisma.notificationOutbox.count({ where: { kind: STOCK_AGING_KIND, subjectKey: C, phase: "KAPANDI" } });
    check("§3b ⭐ top sevk edilince koşul kapanır (KAPANDI = çözüldü)", typeof t3 === "object" && t3.closed === 1 && kap === 1, JSON.stringify(t3));
  } finally {
    geri();
    await prisma.notificationOutbox.deleteMany({ where: { kind: STOCK_AGING_KIND, subjectKey: { in: ids.wh } } });
    await prisma.notificationCondition.deleteMany({ where: { kind: STOCK_AGING_KIND, subjectKey: { in: ids.wh } } });
  }
}

async function bolum4(): Promise<void> {
  console.log("\n§4 kapsam: raf (rapor kümesi) ↔ depodaki-her-top");
  const D = await mkWarehouse("D");
  ids.customer = (await prisma.customer.create({ data: { code: `TSY-${ek}`, name: `TEST-SY musteri ${ek}` }, select: { id: true } })).id;
  ids.sack = (await prisma.sack.create({ data: { sackNo: `TEST-SY-CV-${ek}` }, select: { id: true } })).id;
  ids.shipment = (await prisma.shipment.create({ data: { shipmentNo: `TEST-SY-SV-${ek}`, customerId: ids.customer }, select: { id: true } })).id;
  const eski = T0 - 40 * DAY;
  const ilkSira = ids.rolls.length; // körlük zemini: yalnız bu bölümün D topları karşılaştırılır
  const raf = [await mkRoll("kA", D, eski), await mkRoll("kF", D, eski, RollStatus.STOCK)];
  const emanet = await mkRoll("kD", D, eski, RollStatus.WAREHOUSE, { ownerCustomerId: ids.customer });
  const cuval = await mkRoll("kB", D, eski, RollStatus.WAREHOUSE, { sackId: ids.sack });
  const sevk = await mkRoll("kC", D, eski, RollStatus.WAREHOUSE, { shipmentId: ids.shipment });
  await mkRoll("kE", D, eski, RollStatus.RETURNED_FROM_SUBCONTRACTOR);
  const cutoff = T0 - 30 * DAY;
  const g = (scope: StockAgingScope, emanetOn: boolean) => groups("durum-degisimi", cutoff, D, scope, emanetOn);
  const [rK, rA, hK, hA] = [await g("raf", false), await g("raf", true), await g("depodaki-her-top", false), await g("depodaki-her-top", true)];
  check("§4a ⭐ emanet kapalı: raf 3 (düz + ham + emanet), her-top 6 (çuval + planlı sevkiyat + fasondan dönen dahil)", rK.rollCount === 3 && hK.rollCount === 6 && rK.meters === 300, `${rK.rollCount}/${hK.rollCount}`);
  check("§4b ⭐ emanet açık: raf 2 (müşteri malı raporda olduğu gibi dışarıda), her-top yine 6", rA.rollCount === 2 && hA.rollCount === 6, `${rA.rollCount}/${hA.rollCount}`);
  const mine = new Set(ids.rolls.slice(ilkSira));
  const cells = (await loadShelfCells()).filter((c) => mine.has(c.rollId) && c.days !== null && c.days >= 30);
  const raporOff = splitByOwnership(cells, false, (c) => c.consigned).own;
  const raporOn = splitByOwnership(cells, true, (c) => c.consigned).own;
  const hepsi = new Set(cells.map((c) => c.rollId));
  check("§4c ⭐ raf kipinde rapor ile bildirim adedi EŞİT (emanet kapalı/açık), çuvaldaki/sevkiyattaki rapor kümesinde de yok",
    raporOff.length === rK.rollCount && raporOn.length === rA.rollCount && !hepsi.has(cuval) && !hepsi.has(sevk)
      && raf.every((id) => hepsi.has(id)) && hepsi.has(emanet) && !raporOn.some((c) => c.rollId === emanet),
    `rapor ${raporOff.length}/${raporOn.length} · bildirim ${rK.rollCount}/${rA.rollCount}`);
  const geri = overrideStockAgingDeps({ warehouseIds: [D], now: () => new Date(T0), source: async () => "durum-degisimi", emanetOn: async () => false });
  try {
    const yuk = async () => ((await agedStockSubjects())[0]?.payload ?? {}) as Record<string, unknown>;
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.NOTIFICATION_STOCK_AGING_SCOPE } });
    const pYok = await yuk();
    await prisma.systemSetting.create({ data: { key: SETTING_KEYS.NOTIFICATION_STOCK_AGING_SCOPE, value: "depodaki-her-top" } });
    const pHer = await yuk();
    check("§4d ⭐ tarayıcı: ayar yok → raf (3 top, \"kapsam: raf\"); depodaki-her-top → 6 top, \"kapsam: tümü\"",
      pYok.adet === 3 && pYok.kapsam === "raf" && pHer.adet === 6 && pHer.kapsam === "tümü", `${JSON.stringify(pYok)} ${JSON.stringify(pHer)}`);
    const govde = NOTIFICATION_CATALOG[STOCK_AGING_KIND].govde;
    check("§4e metin kapsamı yazar (`kapsam: {kapsam}`), yük alanı beyanlı", govde.includes("kapsam: {kapsam}") && NOTIFICATION_CATALOG[STOCK_AGING_KIND].payloadAlanlari.includes("kapsam"));
  } finally {
    geri();
  }
}

async function main(): Promise<void> {
  console.log("=== Bildirim — stok.yaslanan ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const ilk = await prisma.systemSetting.findMany({ where: { key: { in: SETTING_KEYS_TOUCHED } } });
  ids.item = (await prisma.item.create({ data: { code: `TEST-SY-${ek}`, name: `TEST-SY ${ek}`, itemType: "FABRIC" }, select: { id: true } })).id;
  try {
    await bolum0();
    await bolum12();
    await bolum3();
    await bolum4();
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls }, reversesMovementId: { not: null } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.shipment) await prisma.shipment.delete({ where: { id: ids.shipment } });
    if (ids.sack) await prisma.sack.delete({ where: { id: ids.sack } });
    if (ids.customer) await prisma.customer.delete({ where: { id: ids.customer } });
    await prisma.warehouse.deleteMany({ where: { id: { in: ids.wh } } });
    await prisma.item.delete({ where: { id: ids.item } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: SETTING_KEYS_TOUCHED } } });
    for (const row of ilk) await prisma.systemSetting.create({ data: { ...row, value: (row.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
