// =============================================================================
// BEKÇİ — `stok.yaslanan` (KOSUL): depoda N gündür (varsayılan 30) duran toplar, iki yaş kipi
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_stok_yaslanan
// =============================================================================
// NEDEN: kullanıcı kararı 2026-11-14 "depoya giriş tarihinden say, eşik 30 gün, ayardan değişir" + iki aday kuvvetli
// → iki kip (`bildirim.stokYaslanan.kaynak`). Ölçülenler:
//   §0 katalog/ayar — KOSUL, eşik `gun` 30, yükte tutar yok; ayar kayıtsız/çöp → `depo-giris`; kaynak yüklemi helper'dan.
//   §1 depo-giris — çıpa defter girişi; 29 gün / 30 gün − 1 ms kenarı; girişsiz top durum tarihine düşer ve sayılır;
//      ölü top hariç; sevk stornosu ilk girişe döner; girişten sonra terslenmemiş çıkış → düşüş.
//   §2 durum-degisimi — çıpa `statusChangedAt`, kenar ±1 ms, düşüş yok.
//   §3 tarayıcı — taban → açıldı (ACILDI) → top sevk edilince KAPANDI ("çözüldü").
// NEGATİF SONDA (2026-11-14, helper md5 ile geri alındı): ① giriş adayında `reversesMovementId IS NULL` kalktı ⇒ §1d ❌
//   (11/1) · ② düşüş dalı `statusChangedAt` yerine `e."createdAt"` ⇒ §1a/§1b/§1e ❌ (9/3) · ③ ölü küme süzgeci kalkıp
//   CANCELLED kümeye girdi ⇒ §1a/§1b/§2a/§2b ❌ (8/4).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, RollForm, RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { NOTIFICATION_CATALOG } from "../src/constants/notification-catalog";
import { SETTING_KEYS, readStockAgingSource } from "../src/services/system-setting.service";
import { postStockMove } from "../src/services/helpers/warehouse-ledger.helper";
import { loadAgedStockGroups } from "../src/services/helpers/stock-aging.helper";
import { notificationBaselineKey } from "../src/services/helpers/notification-baseline.helper";
import { runConditionSourceOnce } from "../src/jobs/notification-condition.job";
import { STOCK_AGING_KIND, overrideStockAgingDeps, registerStockAgingConditionSource } from "../src/services/notification-sources/stok-yaslanan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const ek = Date.now().toString(36);
const DAY = 86_400_000;
const T0 = Date.now();
const ids = { wh: [] as string[], rolls: [] as string[], item: "" };
const SETTING_KEYS_TOUCHED = [SETTING_KEYS.NOTIFICATION_STOCK_AGING_SOURCE, SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, notificationBaselineKey(STOCK_AGING_KIND)];

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
}

async function mkWarehouse(tag: string): Promise<string> {
  const w = await prisma.warehouse.create({ data: { code: `TEST-SY-${tag}-${ek}`, name: `TEST-SY ${tag} ${ek}` }, select: { id: true } });
  ids.wh.push(w.id);
  return w.id;
}

async function mkRoll(tag: string, warehouseId: string | null, statusChangedAt: number, status: RollStatus = RollStatus.WAREHOUSE): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: `TEST-SY-${tag}-${ek}`, itemId: ids.item, initialQty: 100, currentQty: 100, status, form: RollForm.TOP, warehouseId, statusChangedAt: new Date(statusChangedAt) },
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

const groups = (source: "depo-giris" | "durum-degisimi", cutoff: number, wh: string) =>
  loadAgedStockGroups(prisma, { source, cutoff: new Date(cutoff), warehouseIds: [wh] }).then((g) => g[0] ?? { rollCount: 0, fallbackCount: 0, meters: 0 });

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
  const geri = overrideStockAgingDeps({ warehouseIds: [C], now: () => new Date(e8.at + 29 * DAY) });
  try {
    const t1 = await runConditionSourceOnce(STOCK_AGING_KIND);
    overrideStockAgingDeps({ now: () => new Date(e8.at + 30 * DAY) });
    const t2 = await runConditionSourceOnce(STOCK_AGING_KIND);
    const ac = await prisma.notificationOutbox.findFirst({ where: { kind: STOCK_AGING_KIND, subjectKey: C, phase: "ACILDI" }, select: { payload: true } });
    const p = (ac?.payload ?? {}) as Record<string, unknown>;
    check("§3a ⭐ taban (29 gün, sessiz) → 30 gün ACILDI, yük adet/gün/metre/yaş kaynağı", typeof t1 === "object" && t1.baseline === 0 && typeof t2 === "object" && t2.opened === 1
      && p.adet === 1 && p.gun === 30 && p.metre === 100 && p.yasKaynagi === "depoya girişten", `${JSON.stringify(t1)} ${JSON.stringify(t2)} ${JSON.stringify(p)}`);
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
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls }, reversesMovementId: { not: null } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
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
