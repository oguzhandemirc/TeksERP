// =============================================================================
// BEKÇİ — sahadan gelen üç bildirim türü (2026-11-19): `stok.top-fire-iptal` · `sevkiyat.olusturuldu` · `genel.gun-sonu-ozeti`
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_saha_turleri
// =============================================================================
// NEDEN: üç tür gerçek yazma yoluna bağlı olmalı; bağ kopunca bildirim sessizce kesilir. Ölçülenler:
//   §0 AST — OLAY türlerinin TEK emit literali `notification-sources/depo.ts`; `emitRollRetiredTx` yalnız tek iptal/fire
//      motorundan (`inventory/cancel.ts`), `emitShipmentCreatedTx` tek doğuş çekirdeğinden (`shipping/create.ts`); özet türü
//      literalsiz; varsayılanlar (KAPALI · fire yetkilileri · KAPALI) ve yükte tutar yok.
//   §1 gerçek yol `softDelete` (kendi tx'i): fire → `kip=fire` tek satır; iki iptal → aynı birleştirme anahtarı; bayrak kapalı → satır yok.
//   §2 gerçek çekirdek `createShipmentCoreTx` (geri sarılan tx): tek `sevkiyat.olusturuldu` satırı, durum "onay bekliyor".
//   §3 birleşik özet: pencere `00:00` = GUN_SONU kadansı; `18:30` = o gün 00:00→18:30, saatten önce dünün penceresi;
//      gerçek tur yükü alan özetlerinin sayım fonksiyonlarıyla eşit (tek kaynak); ayarlar `finally`de birebir geri.
//   §4 görme: `report:sales` görür, yalnız `order:read` görmez.
// NEGATİF SONDA (2026-11-19): bkz. arşiv notu (cancel.ts emit satırı silindi ⇒ §0b + §1a ❌; dailySummaryWindow'da
//   saat yok sayıldı ⇒ §3b ❌).
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { Prisma, RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG } from "../src/constants/notification-catalog";
import { canSeeNotificationType } from "../src/services/helpers/notification-visibility.helper";
import { softDelete } from "../src/services/inventory/cancel";
import { shippingService } from "../src/services/shipping.service";
import {
  dailySummaryWindow, registerDepotDigestSources, shipmentWindowCounts, stockWindowCounts, subcontractWindowCounts,
} from "../src/services/notification-sources/depo-ozet";
import { orderWindowCounts } from "../src/services/notification-sources/satis-ozet";
import { productionWindowCounts } from "../src/services/notification-sources/uretim-ozet";
import { digestStampKey, lastClosedWindow, registeredDigestKinds, runDigestOnce } from "../src/jobs/notification-digest.job";
import { factoryDayStart, factoryMinuteOfDay } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const FIRE = "stok.top-fire-iptal";
const SEVK = "sevkiyat.olusturuldu";
const OZET = "genel.gun-sonu-ozeti";
const INBOX = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
const SAAT = SETTING_KEYS.NOTIFICATION_DAILY_SUMMARY_TIME;
const ek = Date.now().toString(36);

type AyarGoruntusu = { keys: string[]; ilk: Awaited<ReturnType<typeof prisma.systemSetting.findMany>> };
/** Global ayarların anlık görüntüsü; `ayarGeriYukle` (yalnız finally'den) birebir geri yükler. */
async function ayarGoruntusu(keys: string[]): Promise<AyarGoruntusu> {
  return { keys, ilk: await prisma.systemSetting.findMany({ where: { key: { in: keys } } }) };
}
async function ayarGeriYukle(g: AyarGoruntusu): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: { in: g.keys } } });
  for (const row of g.ilk) await prisma.systemSetting.create({ data: { ...row, value: (row.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
}
const ayarla = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

// ── §0 AST ──────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 AST — tek yayma noktası + çağrı yerleri + katalog beyanı");
  const SRC = join(__dirname, "..", "src");
  const literaller = new Map<string, string[]>();
  const cagrilar = new Map<string, string[]>();
  const IZLENEN = new Set(["emitRollRetiredTx", "emitShipmentCreatedTx"]);
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const sf = ts.createSourceFile(rel, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const ad = n.expression.text;
        const a = n.arguments[1];
        if (ad === "emitNotification" && a && ts.isStringLiteral(a)) literaller.set(a.text, [...(literaller.get(a.text) ?? []), rel]);
        if (IZLENEN.has(ad)) cagrilar.set(ad, [...(cagrilar.get(ad) ?? []), rel]);
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  const tek = (k: string) => JSON.stringify(literaller.get(k)) === JSON.stringify(["services/notification-sources/depo.ts"]);
  check("§0a ⭐ OLAY türlerinin TEK emit literali notification-sources/depo.ts", tek(FIRE) && tek(SEVK), `${FIRE}: ${JSON.stringify(literaller.get(FIRE))} · ${SEVK}: ${JSON.stringify(literaller.get(SEVK))}`);
  check("§0b ⭐ emitRollRetiredTx yalnız tek iptal/fire motorundan (inventory/cancel.ts)",
    JSON.stringify(cagrilar.get("emitRollRetiredTx")) === JSON.stringify(["services/inventory/cancel.ts"]), JSON.stringify(cagrilar.get("emitRollRetiredTx") ?? []));
  check("§0c ⭐ emitShipmentCreatedTx yalnız tek doğuş çekirdeğinden (shipping/create.ts)",
    JSON.stringify(cagrilar.get("emitShipmentCreatedTx")) === JSON.stringify(["services/shipping/create.ts"]), JSON.stringify(cagrilar.get("emitShipmentCreatedTx") ?? []));
  const oz = NOTIFICATION_CATALOG[OZET] as { ozet?: string };
  check("§0d özet türü GUN_SONU beyanlı ve emit literali yok (zamanlayıcı yazar)", oz.ozet === "GUN_SONU" && !literaller.has(OZET));
  check("§0e varsayılanlar: oluşturuldu KAPALI · gün sonu KAPALI · fire/iptal yalnız fire yetkilileri",
    NOTIFICATION_CATALOG[SEVK].varsayilan === "KAPALI" && NOTIFICATION_CATALOG[OZET].varsayilan === "KAPALI"
      && JSON.stringify(NOTIFICATION_CATALOG[FIRE].varsayilan) === JSON.stringify(["roll:manual-adjust"]));
  check("§0f yüklerde tutar alanı yok", [FIRE, SEVK, OZET].every((k) => !NOTIFICATION_CATALOG[k as typeof FIRE].payloadAlanlari.some((a) => /tutar|fiyat|bedel/i.test(a))));
}

// ── §1 gerçek yol: softDelete ───────────────────────────────────────────────
async function bolum1(): Promise<void> {
  console.log("\n§1 gerçek yol — softDelete → stok.top-fire-iptal");
  const geri = await ayarGoruntusu([INBOX]);
  const item = await prisma.item.create({ data: { code: `TEST-BST-${ek}`, name: `TEST-BST Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `TBST${ek}`.slice(0, 16), name: `TEST-BST Depo ${ek}` }, select: { id: true } });
  const yeni = (n: number) => prisma.roll.create({ data: { itemId: item.id, initialQty: new Prisma.Decimal(40), currentQty: new Prisma.Decimal(40), barcode: `TBST${n}${ek}`, status: RollStatus.STOCK, warehouseId: wh.id }, select: { id: true } });
  const rolls = [await yeni(1), await yeni(2), await yeni(3), await yeni(4)];
  const ids = rolls.map((r) => r.id);
  try {
    await ayarla(INBOX, true);
    await softDelete(ids[0]!, undefined, { mode: "SCRAP", reason: "TEST yandı" });
    await softDelete(ids[1]!, undefined, { reason: "TEST mükerrer giriş" });
    await softDelete(ids[2]!, undefined, { reason: "TEST yanlış metraj" });
    await ayarla(INBOX, false);
    await softDelete(ids[3]!, undefined, { reason: "TEST bayrak kapalı" });
    const rows = await prisma.notificationOutbox.findMany({ where: { kind: FIRE, subjectId: { in: ids } }, select: { id: true, subjectId: true, payload: true, dedupeKey: true } });
    const of = (id: string) => rows.filter((r) => r.subjectId === id);
    const p0 = (of(ids[0]!)[0]?.payload ?? {}) as Record<string, unknown>;
    check("§1a ⭐ fire tek satır: kip=fire, 40 m, sebep, ürün", of(ids[0]!).length === 1 && p0.kip === "fire" && p0.metre === 40 && p0.sebep === "TEST yandı" && p0.urunAd === `TEST-BST Kumaş ${ek}`, JSON.stringify(p0));
    const i1 = of(ids[1]!)[0];
    const i2 = of(ids[2]!)[0];
    check("§1b iki iptal → kip=iptal, aynı birleştirme anahtarı; fireden ayrı",
      !!i1 && !!i2 && (i1.payload as Record<string, unknown>).kip === "iptal" && i1.dedupeKey === i2.dedupeKey && i1.dedupeKey !== of(ids[0]!)[0]?.dedupeKey,
      `${i1?.dedupeKey} | ${i2?.dedupeKey}`);
    check("§1c bayrak kapalıyken iptal satır doğurmaz", of(ids[3]!).length === 0, `${of(ids[3]!).length}`);
    const statu = await prisma.roll.findMany({ where: { id: { in: ids } }, select: { status: true } });
    check("§1d iş yolu yine çalıştı (1 SCRAP + 3 CANCELLED)", statu.filter((s) => s.status === RollStatus.SCRAP).length === 1 && statu.filter((s) => s.status === RollStatus.CANCELLED).length === 3);
    await prisma.notificationOutbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids } } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.warehouse.delete({ where: { id: wh.id } });
    await ayarGeriYukle(geri);
  }
}

// ── §2 gerçek çekirdek: createShipmentCoreTx (geri sarılan tx) ──────────────
class GeriSar extends Error {}
type CoreFn = (tx: Prisma.TransactionClient, p: Record<string, unknown>) => Promise<{ id: string; shipmentNo: string }>;

async function bolum2(): Promise<void> {
  console.log("\n§2 gerçek çekirdek — createShipmentCoreTx → sevkiyat.olusturuldu");
  const sonuc: Array<[string, boolean, string]> = [];
  try {
    await prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({ where: { key: INBOX }, create: { key: INBOX, value: true }, update: { value: true } });
      const cust = await tx.customer.create({ data: { code: `TEST-BSS-${ek}`, name: `TEST-BSS Müşteri ${ek}` }, select: { id: true } });
      const core = (shippingService as unknown as { createShipmentCoreTx: CoreFn }).createShipmentCoreTx.bind(shippingService);
      const sh = await core(tx, {
        sackIds: [], customerId: cust.id, branchId: null, orderIds: [], assertDestination: () => undefined,
        confirmationEnabled: true, orderless: true, userId: undefined,
      });
      const rows = await tx.notificationOutbox.findMany({ where: { kind: SEVK, subjectId: sh.id }, select: { payload: true } });
      const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
      sonuc.push(["§2a ⭐ çekirdek tek sevkiyat.olusturuldu satırı yazar (PLANNED, onay bekliyor)",
        rows.length === 1 && p.sevkiyatNo === sh.shipmentNo && p.musteriAd === `TEST-BSS Müşteri ${ek}` && p.durum === "onay bekliyor" && p.topSayisi === 0,
        `${rows.length} satır ${JSON.stringify(p).slice(0, 160)}`]);
      throw new GeriSar();
    });
  } catch (e) {
    if (!(e instanceof GeriSar)) throw e;
  }
  for (const [l, ok, d] of sonuc) check(l, ok, d);
  check("§2b geri sarma: test carisi kalıcı değil", (await prisma.customer.count({ where: { code: `TEST-BSS-${ek}` } })) === 0);
}

// ── §3 birleşik gün sonu özeti ──────────────────────────────────────────────
async function bolum3(): Promise<void> {
  console.log("\n§3 birleşik gün sonu özeti — pencere + tek kaynak yük");
  registerDepotDigestSources();
  check("§3a özet kaynağı kayıtlı", registeredDigestKinds().includes(OZET));
  const geri = await ayarGoruntusu([INBOX, SAAT, digestStampKey(OZET)]);
  const gun = new Date("2001-04-16T12:00:00Z");
  const cust = await prisma.customer.create({ data: { code: `TEST-BSO-${ek}`, name: `TEST-BSO ${ek}` }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `TEST-BSO-${ek}`, name: `TEST-BSO ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  const at = new Date(factoryDayStart(gun).getTime() + 3_600_000);
  const sh = await prisma.shipment.create({ data: { shipmentNo: `TEST-BSO-${ek}`, customerId: cust.id, status: ShipmentStatus.DISPATCHED, dispatchedAt: at }, select: { id: true } });
  const roll = await prisma.roll.create({ data: { itemId: item.id, initialQty: new Prisma.Decimal(70), currentQty: new Prisma.Decimal(70), barcode: `TBSO${ek}`, shipmentId: sh.id, status: RollStatus.SHIPPED }, select: { id: true } });
  try {
    await prisma.systemSetting.deleteMany({ where: { key: SAAT } });
    const varsayilan = await dailySummaryWindow(prisma, gun);
    const kadans = await lastClosedWindow(prisma, "GUN_SONU", gun);
    check("§3b ⭐ saat yok (00:00) → pencere GUN_SONU kadansıyla aynı (biten fabrika günü)", JSON.stringify(varsayilan) === JSON.stringify(kadans), `${varsayilan?.key}`);
    await ayarla(SAAT, "18:30");
    const kesim = factoryMinuteOfDay(gun, 18 * 60 + 30);
    const sonra = await dailySummaryWindow(prisma, factoryMinuteOfDay(gun, 20 * 60));
    const once = await dailySummaryWindow(prisma, factoryMinuteOfDay(gun, 17 * 60));
    check("§3c ⭐ 18:30 sonrası: bugün 00:00 → 18:30", sonra?.from.getTime() === factoryDayStart(gun).getTime() && sonra?.to.getTime() === kesim.getTime(), `${sonra?.from.toISOString()} → ${sonra?.to.toISOString()}`);
    check("§3d 18:30 öncesi: dünün 00:00 → 18:30 penceresi", !!once && once.to.getTime() < factoryDayStart(gun).getTime() && once.key !== sonra?.key, `${once?.key} · ${once?.to.toISOString()}`);
    // Gerçek tur: dünün penceresi taban, bugünün penceresi bir kez yazılır.
    await ayarla(INBOX, true);
    await prisma.systemSetting.deleteMany({ where: { key: digestStampKey(OZET) } });
    const r1 = await runDigestOnce(OZET, factoryMinuteOfDay(gun, 17 * 60));
    const r2 = await runDigestOnce(OZET, factoryMinuteOfDay(gun, 20 * 60));
    const r3 = await runDigestOnce(OZET, factoryMinuteOfDay(gun, 21 * 60));
    const rows = await prisma.notificationOutbox.findMany({ where: { kind: OZET, subjectKey: sonra!.key }, select: { id: true, payload: true } });
    check("§3e ⭐ taban → yazıldı → zaten (gün başına tek)", r1 === "baseline" && r2 === "emitted" && r3 === "already" && rows.length === 1, `${r1}/${r2}/${r3} · ${rows.length}`);
    const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
    const s = await orderWindowCounts(prisma, sonra!);
    const u = await productionWindowCounts(prisma, sonra!);
    const v = await shipmentWindowCounts(prisma, sonra!);
    const d = await stockWindowCounts(prisma, sonra!);
    const f = await subcontractWindowCounts(prisma, sonra!);
    const beklenen = { siparis: s.yeni, uretimTop: u.top, uretimMetre: u.metre, sevkTop: v.top, sevkMetre: v.metre, girisTop: d.giris, fasonCikis: f.cikis, fasonDonus: f.donus };
    const esit = Object.entries(beklenen).every(([k, x]) => p[k] === x);
    check("§3f ⭐ yük alan özetlerinin sayım fonksiyonlarıyla eşit (tek kaynak) ve test sevki sayıldı", esit && v.top >= 1 && v.metre >= 70 && p.aralik === "00:00–18:30", JSON.stringify(p));
    await prisma.notificationOutbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  } finally {
    await prisma.roll.delete({ where: { id: roll.id } });
    await prisma.shipment.delete({ where: { id: sh.id } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await ayarGeriYukle(geri);
  }
}

// ── §4 görme ────────────────────────────────────────────────────────────────
function bolum4(): void {
  console.log("\n§4 görme süzgeci");
  const env = { modules: {}, gates: {} };
  check("§4a ⭐ report:sales görür, yalnız order:read görmez (gün sonu özeti)",
    canSeeNotificationType({ permissions: ["report:sales"] }, OZET, env) && !canSeeNotificationType({ permissions: ["order:read"] }, OZET, env));
  check("§4b roll:read top fire/iptal türünü görür, shipping:read görmez",
    canSeeNotificationType({ permissions: ["roll:read"] }, FIRE, env) && !canSeeNotificationType({ permissions: ["shipping:read"] }, FIRE, env));
}

async function main(): Promise<void> {
  console.log("=== Bildirim — sahadan gelen üç tür ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  bolum0();
  bolum4();
  await bolum1();
  await bolum2();
  await bolum3();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
