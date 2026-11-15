// =============================================================================
// BEKÇİ — BİLDİRİM S6a: fason fire farkı · yeniden işlem · disk dolu · fason dokuma bağları · acil işareti ·
// brode günlük özeti · büyük sipariş · metin miktarları (2026-11-15)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_s6a
// =============================================================================
// NEDEN: S6a türleri gerçek yazma yollarına bağlı olmalı; bağ kopunca bildirim sessizce kesilir. Ölçülenler:
//   §0 AST — her yeni OLAY türünün `src/`de TEK emit literali (depo.ts / satis.ts) ve yayma fonksiyonu beklenen
//      yazma yolundan çağrılıyor; fason dokuma servisi `fason.cikis`/`fason.donus` tek yayma noktalarını çağırıyor;
//      `sistem.disk-dolu` koşul kaynağında, `brode.gunluk-ozet` özet kaynağında kayıtlı.
//   §1 DB (geri sarılan tx) — eşik üstü/altı ve fabrika eşiği (`notification_factory_defaults`) ile fire farkı;
//      büyük sipariş eşiği metre; yeniden işlem sınıfı + etiket; düz İE yeniden işlem bildirmez; miktar metni.
//   §2 gerçek yol `setQueueUrgent` — yalnız KAPALI→AÇIK geçişi bildirir (yeniden işaretleme ve kaldırma bildirmez).
//   §3 disk koşulu (sahte okuyucu): eşik üstü konu, altı boş, ölçülemez + açık koşul yok → boş.
//   §4 brode özeti: BRODE yetenekli makinedeki iş sayılır, yeteneksiz makine sayılmaz.
// NEGATİF SONDA (2026-11-15, md5 ile geri alındı):
//   ① receive.ts'ten `emitSubcontractShrinkTx(...)` satırı silindi ⇒ §0b ❌ (26/1)
//   ② depo.ts'te eşik kıyası `pct.lessThan(threshold)` → `false` ⇒ §1b + §1d ❌ (25/2)
//   ③ kursun-qc.service.ts'te geçiş claim'inin `isUrgent: !isUrgent` süzgeci silindi ⇒ §2b–§2d ❌ (24/3)
//   ④ uretim-ozet.ts'te BRODE yetenek süzgeci kaldırıldı ⇒ §4a + §4b ❌ (25/2)
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { MachineDataSource, MeterPhase, Prisma, StationKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS, type NotificationKind } from "../src/constants/notification-catalog";
import { NOTIFICATION_PATRON_MAP } from "../src/constants/notification-patron-map";
import { emitSubcontractShrinkTx } from "../src/services/notification-sources/depo";
import { emitOrderCreatedTx, emitOrderTerminalTx, emitWorkOrderReworkTx } from "../src/services/notification-sources/satis";
import { SYSTEM_SOURCE_EVALUATORS, diskSubjects, overrideSystemSourceDeps } from "../src/services/notification-sources/sistem";
import { brodeTotals, registerProductionDigestSources } from "../src/services/notification-sources/uretim-ozet";
import { registeredDigestKinds } from "../src/jobs/notification-digest.job";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { BRODE_PROPERTY_CODE } from "../src/services/helpers/service-quantity.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const S6A_OLAY: Record<string, string> = {
  "fason.fire-farki": "services/notification-sources/depo.ts",
  "fason.yeniden-islem": "services/notification-sources/satis.ts",
  "isemri.acil-isaretlendi": "services/notification-sources/satis.ts",
  "siparis.buyuk-siparis": "services/notification-sources/satis.ts",
};
const S6A_TURLER = [...Object.keys(S6A_OLAY), "sistem.disk-dolu", "brode.gunluk-ozet"] as NotificationKind[];

/** Yayma fonksiyonu → onu çağırması gereken yazma yolu dosyaları (src/ göreli). */
const CAGRI_YERLERI: Record<string, string[]> = {
  emitSubcontractShrinkTx: ["services/subcontractor/receive.ts"],
  emitWorkOrderReworkTx: ["services/workorder/create.ts"],
  emitWorkOrderUrgentTx: ["services/kursun-qc.service.ts"],
  emitSubcontractDispatchedTx: ["services/subcontractor-weaving.service.ts"],
  emitSubcontractReceivedTx: ["services/subcontractor-weaving.service.ts"],
};

// ── §0 AST ──────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 AST — tek yayma noktası + çağrı yerleri");
  const SRC = join(__dirname, "..", "src");
  const literaller = new Map<string, string[]>();
  const cagrilar = new Map<string, Set<string>>();
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const sf = ts.createSourceFile(rel, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const ad = n.expression.text;
        if (ad === "emitNotification") {
          const a = n.arguments[1];
          if (a && ts.isStringLiteral(a)) literaller.set(a.text, [...(literaller.get(a.text) ?? []), rel]);
        }
        if (ad in CAGRI_YERLERI) cagrilar.set(ad, (cagrilar.get(ad) ?? new Set()).add(rel));
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  const ihlal = Object.entries(S6A_OLAY).filter(([k, dosya]) => JSON.stringify(literaller.get(k)) !== JSON.stringify([dosya])).map(([k]) => `${k}: ${JSON.stringify(literaller.get(k) ?? [])}`);
  check("§0a ⭐ her S6a OLAY türünün TEK emit literali kendi kaynak dosyasında", ihlal.length === 0, ihlal.join(" · ") || `${Object.keys(S6A_OLAY).length} tür`);
  const eksik = Object.entries(CAGRI_YERLERI).flatMap(([fn, dosyalar]) => dosyalar.filter((d) => !cagrilar.get(fn)?.has(d)).map((d) => `${fn} ← ${d}`));
  check("§0b ⭐ her yayma fonksiyonu yazma yolundan çağrılıyor (fason dokuma dahil)", eksik.length === 0, eksik.join(" · ") || `${Object.keys(CAGRI_YERLERI).length} fonksiyon`);
  check("§0c S6a türleri katalogda + patron eşlemesinde", S6A_TURLER.every((k) => NOTIFICATION_KINDS.includes(k) && k in NOTIFICATION_PATRON_MAP));
  check("§0d `sistem.disk-dolu` koşul kaynağında kayıtlı, `brode.gunluk-ozet` literalsiz özet", "sistem.disk-dolu" in SYSTEM_SOURCE_EVALUATORS && !literaller.has("brode.gunluk-ozet") && "ozet" in NOTIFICATION_CATALOG["brode.gunluk-ozet"]);
  registerProductionDigestSources();
  check("§0e `brode.gunluk-ozet` özet kaynağı kayıtlı", registeredDigestKinds().includes("brode.gunluk-ozet"));
  check("§0f S6a yüklerinde tutar alanı yok", S6A_TURLER.every((k) => !NOTIFICATION_CATALOG[k].payloadAlanlari.some((a) => /tutar|fiyat|bedel/i.test(a))));
}

// ── §1 DB (geri sarılan tx) ─────────────────────────────────────────────────
class GeriSar extends Error {}
const ek = Date.now().toString(36);
const D = (v: number | string) => new Prisma.Decimal(v);

async function bolum1(): Promise<void> {
  console.log("\n§1 olay → outbox (tek tx, sonda geri sarılır)");
  const firma = await ensureTestDyeHouse();
  const sonuc: Array<[string, boolean, string]> = [];
  try {
    await prisma.$transaction(async (tx) => {
      const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
      await tx.notificationFactoryDefault.deleteMany({ where: { kind: { in: ["fason.fire-farki", "siparis.buyuk-siparis"] } } });
      const t0 = new Date(Date.now() - 1000);
      const AD = `TEST-S6 Ayşe ${ek}`;
      const u = await tx.user.create({ data: { username: `ts6_${ek}`, fullName: AD, passwordHash: "x" }, select: { id: true } });
      const cust = await tx.customer.create({ data: { code: `TEST-S6-${ek}`, name: `TEST-S6 Müşteri ${ek}` }, select: { id: true } });
      const item = await tx.item.create({ data: { code: `TEST-S6-${ek}`, name: `TEST-S6 Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
      const satir = (kind: string, subjectId: string) => tx.notificationOutbox.findMany({ where: { kind, subjectId, createdAt: { gte: t0 } }, select: { payload: true } });
      const olc = async (ad: string, kind: string, subjectId: string, adet: number, ek2?: (p: Record<string, unknown>) => boolean): Promise<void> => {
        const rows = await satir(kind, subjectId);
        const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
        sonuc.push([ad, rows.length === adet && (adet === 0 || !ek2 || ek2(p)), `${rows.length} satır ${JSON.stringify(p).slice(0, 160)}`]);
      };

      // Fire farkı — başlık CHECK'i dokuma emri bağıyla.
      const wv = await tx.weavingOrder.create({ data: { weavingOrderNumber: `TEST-S6-${ek}`, itemId: item.id, executionKind: "SUBCONTRACTED", subcontractorId: firma.id }, select: { id: true } });
      const rec = async (n: number) => (await tx.subcontractorReceipt.create({ data: { receiptNo: `TEST-S6-${ek}-${n}`, subcontractorId: firma.id, weavingOrderId: wv.id }, select: { id: true } })).id;
      const r1 = await rec(1);
      await emitSubcontractShrinkTx(tx, r1, { consumed: D(200), born: D(190) }, u.id);
      await olc("§1a ⭐ fire farkı %5 ≥ varsayılan %3 → bildirim (metre + yüzde + yön)", "fason.fire-farki", r1, 1,
        (p) => p.gidenMetre === 200 && p.donenMetre === 190 && p.farkMetre === 10 && p.oranYuzde === 5 && String(p.yon).startsWith("eksik") && p.kullanici === AD);
      const r2 = await rec(2);
      await emitSubcontractShrinkTx(tx, r2, { consumed: D(200), born: D(198) }, u.id);
      await olc("§1b fire farkı %1 < %3 → bildirim yok", "fason.fire-farki", r2, 0);
      const r3 = await rec(3);
      await emitSubcontractShrinkTx(tx, r3, { consumed: D(100), born: D(108) }, u.id);
      await olc("§1c fazla dönen %8 → bildirim (yön fazla)", "fason.fire-farki", r3, 1, (p) => p.yon === "fazla" && p.oranYuzde === 8);
      await tx.notificationFactoryDefault.create({ data: { kind: "fason.fire-farki", state: "MIRAS", params: { schemaVersion: 1, degerler: { oran: 10 } } } });
      const r4 = await rec(4);
      await emitSubcontractShrinkTx(tx, r4, { consumed: D(200), born: D(190) }, u.id);
      await olc("§1d fabrika eşiği %10 → %5 fark bildirmez (eşik tx'ten taze)", "fason.fire-farki", r4, 0);

      // Büyük sipariş + miktar metni.
      const order = async (no: string, lines: Array<[number, "MT" | "KG" | "ADET"]>) => {
        const o = await tx.order.create({ data: { orderNumber: `TEST-S6-${no}-${ek}`, customerId: cust.id }, select: { id: true } });
        for (const [q, unit] of lines) await tx.orderLine.create({ data: { orderId: o.id, itemId: item.id, quantity: D(q), unit } as Prisma.OrderLineUncheckedCreateInput });
        return o.id;
      };
      const big = await order("B", [[4000, "MT"], [1500.5, "MT"], [30, "ADET"]]);
      await emitOrderCreatedTx(tx, big, u.id);
      await olc("§1e ⭐ 5500,5 m ≥ 5000 → büyük sipariş (metre + eşik, tutar yok)", "siparis.buyuk-siparis", big, 1, (p) => p.metre === 5500.5 && p.esik === 5000 && p.kalemSayisi === 3);
      await olc("§1f ⭐ `siparis.olusturuldu` miktar metni birim başına", "siparis.olusturuldu", big, 1, (p) => p.miktar === "5500,5 m · 30 adet");
      const small = await order("S", [[4999, "MT"], [9000, "KG"]]);
      await emitOrderCreatedTx(tx, small, u.id);
      await olc("§1g 4999 m (KG kalemi sayılmaz) → büyük sipariş yok", "siparis.buyuk-siparis", small, 0);
      await emitOrderTerminalTx(tx, small, "CANCELLED", u.id);
      await olc("§1h `siparis.iptal` miktar taşır", "siparis.iptal", small, 1, (p) => p.miktar === "4999 m · 9000 kg");

      // Yeniden işlem.
      const wo = async (no: string, parameters: Prisma.InputJsonValue | undefined, reworkBillable: boolean | null) =>
        (await tx.workOrder.create({ data: { workOrderNumber: `TEST-S6-${no}-${ek}`, type: "STOCK_PRODUCTION", targetItemId: item.id, parameters, reworkBillable }, select: { id: true } })).id;
      const leke = await tx.reasonPreset.findUnique({ where: { kind_code: { kind: "WORK_ORDER_REWORK", code: "LEKE" } }, select: { label: true } });
      const w1 = await wo("R1", { rework: { reasonCode: "LEKE" } }, false);
      await emitWorkOrderReworkTx(tx, w1, u.id);
      await olc("§1i ⭐ yeniden işlem İE'si → bildirim (sebep etiketi + bizim hatamız)", "fason.yeniden-islem", w1, 1,
        (p) => p.sebep === (leke?.label ?? "LEKE") && String(p.sinif).startsWith("bizim hatamız"));
      const w2 = await wo("R2", { rework: { reasonCode: "MUSTERI_IADESI" } }, true);
      await emitWorkOrderReworkTx(tx, w2, u.id);
      await olc("§1j müşteri talebi sınıfı metinde", "fason.yeniden-islem", w2, 1, (p) => String(p.sinif).startsWith("müşteri talebi"));
      const w3 = await wo("R3", undefined, null);
      await emitWorkOrderReworkTx(tx, w3, u.id);
      await olc("§1k düz İE yeniden işlem bildirmez", "fason.yeniden-islem", w3, 0);
      throw new GeriSar();
    });
  } catch (e) {
    if (!(e instanceof GeriSar)) throw e;
  }
  for (const [ad, ok, detay] of sonuc) check(ad, ok, detay);
}

// ── §2 gerçek yol: acil işareti ─────────────────────────────────────────────
async function bolum2(): Promise<void> {
  console.log("\n§2 setQueueUrgent → isemri.acil-isaretlendi (yalnız geçiş)");
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key } });
  // Bekçi kendi kullanıcısını yaratır; sert silinmez, sonda pasife alınır.
  const admin = await prisma.user.create({ data: { username: `ts6u_${ek}`, fullName: `TEST-S6U Planlamacı ${ek}`, passwordHash: "x" }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `TEST-S6U-${ek}`, name: `TEST-S6U Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  const st = await prisma.station.create({ data: { code: `TS6U-${ek}`.slice(0, 32), name: `TEST-S6U İstasyon ${ek}`, type: "INTERNAL", kind: StationKind.PROCESS_QC }, select: { id: true } });
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `TEST-S6U-${ek}`, type: "STOCK_PRODUCTION", targetItemId: item.id }, select: { id: true } });
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: st.id, stepSequence: 1 }, select: { id: true } });
  const t0 = new Date(Date.now() - 1000);
  const say = () => prisma.notificationOutbox.count({ where: { kind: "isemri.acil-isaretlendi", subjectId: wo.id, createdAt: { gte: t0 } } });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    const svc = new KursunQcService();
    await svc.setQueueUrgent(step.id, true, admin.id);
    check("§2a ⭐ KAPALI→AÇIK → bir bildirim", (await say()) === 1, String(await say()));
    await svc.setQueueUrgent(step.id, true, admin.id);
    check("§2b yeniden acil işaretleme bildirmez (yazım yine başarılı)", (await say()) === 1, String(await say()));
    const r = await svc.setQueueUrgent(step.id, false, admin.id);
    check("§2c kaldırma bildirmez, rozet kapandı", (await say()) === 1 && r.data?.isUrgent === false, String(await say()));
    await svc.setQueueUrgent(step.id, true, admin.id);
    check("§2d yeniden açılış yeni geçiş → ikinci bildirim", (await say()) === 2, String(await say()));
  } finally {
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: wo.id, createdAt: { gte: t0 } } });
    await prisma.workOrderStep.delete({ where: { id: step.id } });
    await prisma.workOrder.delete({ where: { id: wo.id } });
    await prisma.station.delete({ where: { id: st.id } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    await prisma.systemSetting.deleteMany({ where: { key } });
    if (ilk) await prisma.systemSetting.create({ data: { ...ilk, value: (ilk.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }
}

// ── §3 disk koşulu ──────────────────────────────────────────────────────────
async function bolum3(): Promise<void> {
  console.log("\n§3 sistem.disk-dolu (sahte okuyucu)");
  const disk = (pct: number | null) => () => ({ diskTotalBytes: pct === null ? null : 100 * 1024 ** 3, diskFreeBytes: pct === null ? null : (100 - pct) * 1024 ** 3, diskUsedPct: pct });
  let geri = overrideSystemSourceDeps({ appDisk: disk(95.5) });
  try {
    const s = await diskSubjects();
    check("§3a ⭐ %95,5 ≥ %90 → konu (doluluk, eşik, boş GB metinde)", s.length === 1 && s[0]!.payload.doluluk === "95,5" && s[0]!.payload.esik === "90" && s[0]!.payload.bosGb === "4,5", JSON.stringify(s));
    geri();
    geri = overrideSystemSourceDeps({ appDisk: disk(50) });
    check("§3b %50 → konu yok", (await diskSubjects()).length === 0);
    geri();
    geri = overrideSystemSourceDeps({ appDisk: disk(null) });
    const open = await prisma.notificationCondition.count({ where: { kind: "sistem.disk-dolu", resolvedAt: null } });
    check("§3c ölçülemez → yalnız açık koşul korunur (yeni açılmaz)", (await diskSubjects()).length === open, `açık ${open}`);
    geri();
    geri = overrideSystemSourceDeps({ appDisk: disk(92), params: () => ({ oran: 95 }) });
    check("§3d eşik parametresi okunur (%92 < %95 → yok)", (await diskSubjects()).length === 0);
  } finally {
    geri();
  }
}

// ── §4 brode özeti ──────────────────────────────────────────────────────────
async function bolum4(): Promise<void> {
  console.log("\n§4 brode.gunluk-ozet sayımı (geri sarılan tx)");
  const sonuc: Array<[string, boolean, string]> = [];
  try {
    await prisma.$transaction(async (tx) => {
      const from = new Date(Date.now() - 3_600_000);
      const to = new Date(Date.now() + 3_600_000);
      const once = await brodeTotals(tx, { from, to });
      const prop = await tx.fabricProperty.upsert({ where: { code: BRODE_PROPERTY_CODE }, create: { code: BRODE_PROPERTY_CODE, name: "Brode" }, update: {}, select: { id: true } });
      const item = await tx.item.create({ data: { code: `TEST-S6B-${ek}`, name: `TEST-S6B Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
      const mk = async (n: string, brode: boolean) => {
        const st = await tx.station.create({ data: { code: `TS6B${n}-${ek}`.slice(0, 32), name: `TEST-S6B ${n} ${ek}`, type: "INTERNAL", kind: StationKind.OTHER }, select: { id: true } });
        if (brode) await tx.stationProperty.create({ data: { stationId: st.id, propertyId: prop.id } });
        const m = await tx.machine.create({ data: { stationId: st.id, code: `TS6B${n}-${ek}`.slice(0, 32), name: `TEST-S6B M${n} ${ek}` }, select: { id: true } });
        const wo = await tx.workOrder.create({ data: { workOrderNumber: `TEST-S6B${n}-${ek}`, type: "STOCK_PRODUCTION", targetItemId: item.id }, select: { id: true } });
        const step = await tx.workOrderStep.create({ data: { workOrderId: wo.id, stationId: st.id, stepSequence: 1 }, select: { id: true } });
        const roll = await tx.roll.create({ data: { itemId: item.id, initialQty: D(80), currentQty: D(80), barcode: `TS6B${n}${ek}` }, select: { id: true } });
        await tx.rollMeterReading.create({ data: { rollId: roll.id, workOrderStepId: step.id, phase: MeterPhase.CUT, meters: D("75.5"), source: MachineDataSource.OPERATOR, machineId: m.id, clientToken: randomUUID() } as Prisma.RollMeterReadingUncheckedCreateInput });
      };
      await mk("A", true);
      await mk("B", false);
      const sonra = await brodeTotals(tx, { from, to });
      sonuc.push(["§4a ⭐ BRODE yetenekli makinedeki iş sayılır (+1 iş, +75,5 m, +1 makine)", sonra.is === once.is + 1 && Math.abs(sonra.metre - once.metre - 75.5) < 0.05 && sonra.makine === once.makine + 1, `${JSON.stringify(once)} → ${JSON.stringify(sonra)}`]);
      sonuc.push(["§4b yeteneksiz istasyonun makinesi sayılmaz (yalnız +1)", sonra.is - once.is === 1, `${sonra.is - once.is}`]);
      throw new GeriSar();
    });
  } catch (e) {
    if (!(e instanceof GeriSar)) throw e;
  }
  for (const [ad, ok, detay] of sonuc) check(ad, ok, detay);
}

async function main(): Promise<void> {
  console.log("=== Bildirim S6a — fason fire · yeniden işlem · disk · dokuma bağları · acil · brode · büyük sipariş ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  bolum0();
  await bolum1();
  await bolum2();
  await bolum3();
  await bolum4();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
