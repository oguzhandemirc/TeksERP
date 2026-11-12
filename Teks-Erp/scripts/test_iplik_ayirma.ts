// =============================================================================
// İPLİK AYIRMA BEKÇİSİ (Seyitoğlu 3. bölüm I1) — ayar `dokuma.yarnReservationEnabled`, türetilmiş, engellemez
// =============================================================================
// Ayrılan = açık (PLANNED/IN_PROGRESS) KENDİ tezgâh işlerinin kalan ham metresi × kg/m; hazır levent önce işlere.
//   §1 ⭐ ayar KAPALI: rapor/sunum/öneri özeti açık işler varken de işler yokken de AYNI (JSON eşit), ek anahtar
//      YOK, dokuma işi tablosuna SIFIR sorgu; üretim/dokuma kapalıyken ayar açık olsa da kapalı davranır
//   (§2–§7 `netle=0`: talep brüt 5000 m — işin 200 m topu netlemede depodan da düşerdi; ayrı sorudur.)
//   §2 ayar AÇIK: ayrılan = kg/m × Σ kalan (1000 − 200 top + 500); serbest = stok − ayrılan; talep netlenir
//      (5000 − 1300); eksik serbest miktara göre; özet ve meta
//   §3 iptal / tamamlanan / fason iş ayırmaz
//   §4 müşteri süzgecinde talep netlenmez (uyarıyla)
//   §5 ayrılan stoğu aşınca `warnings` (rapor ve öneri) — engellemez
//   §6 talebi olmayan ama işe ayrılan iplik süzgeçsiz görünümde satırdır
//   §7 hazır levent ÖNCE işlere düşülür; `leventDus=0` iken düşüm yok
//   §8 üretim önerisi iplik özeti: açıkken reservedKg/freeKg ve shortKg serbest miktara göre; kapalıyken anahtar yok
// Koşum: npx tsx scripts/test_iplik_ayirma.ts (kendi _test DB'n)
// =============================================================================
import { Prisma, WarpBeamOrigin, WarpBeamStatus, WarpKgSource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { yarnNeedReport, yarnShortKg, type YarnNeedReport } from "../src/services/reports/yarn-need.report.service";
import { buildYarnNeedSunumu, yarnReservationWarnings } from "../src/services/reports/yarn-need.sunum";
import { yarnSummaries, yarnReservationWarnings as proposalWarnings } from "../src/services/helpers/production-proposal-insight.helper";
import type { WeavingProposal } from "../src/services/helpers/production-proposal.helper";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { yarnUsagePerM } from "../src/services/helpers/fabric-cost.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg3 = (v: Prisma.Decimal) => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);

async function withSettings<T>(values: Record<string, boolean | number>, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(values);
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  try {
    for (const k of keys) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: values[k] }, update: { value: values[k] } });
    return await fn();
  } finally {
    for (const k of keys) {
      const b = before.find((x) => x.key === k);
      if (b) await prisma.systemSetting.update({ where: { key: k }, data: { value: b.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.delete({ where: { key: k } });
    }
  }
}
const BASE = {
  [SETTING_KEYS.MALIYET_ENABLED]: true, [SETTING_KEYS.IPLIK_ENABLED]: true, [SETTING_KEYS.TICARET_ENABLED]: false,
  [SETTING_KEYS.DEVERE_ENABLED]: true, [SETTING_KEYS.EMANET_ENABLED]: false,
  [SETTING_KEYS.PRODUCTION_ENABLED]: true, [SETTING_KEYS.DOKUMA_ENABLED]: true, [SETTING_KEYS.DOKUMA_WEAVING_WASTE_PCT]: 0,
};
const OFF = { ...BASE, [SETTING_KEYS.DOKUMA_YARN_RESERVATION_ENABLED]: false };
const ON = { ...BASE, [SETTING_KEYS.DOKUMA_YARN_RESERVATION_ENABLED]: true };

function spy(models: string[]): { count: () => number; restore: () => void } {
  let n = 0;
  const client = prisma as unknown as Record<string, unknown>;
  const originals = models.map((m) => [m, client[m]] as const);
  for (const [m, orig] of originals) Object.defineProperty(client, m, { get: () => (n++, orig), configurable: true });
  return {
    count: () => n,
    restore: () => originals.forEach(([m, orig]) => Object.defineProperty(client, m, { value: orig, configurable: true, writable: true })),
  };
}

interface Fx { f: MaliyetFikstur; customerId: string; lineId: string; wo: Record<"p" | "ip" | "c" | "done" | "fason", string>; beamId: string | null }

async function kur(f: MaliyetFikstur): Promise<Fx> {
  await altinYapiYaz(f);
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { lengthShrinkPct: D(0) } }); // mamul = ham
  const cust = await prisma.customer.create({ data: { code: `${f.tag}-M`, name: `${f.tag} müşteri` }, select: { id: true } });
  const order = await prisma.order.create({
    data: { orderNumber: `${f.tag}-S`, customerId: cust.id, lines: { create: [{ itemId: f.fabricId, quantity: D(5000) }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const wh = await prisma.warehouse.create({ data: { code: `${f.tag}-D`, name: `${f.tag} depo` }, select: { id: true } });
  await prisma.yarnStock.create({ data: { itemId: f.warpYarnId, warehouseId: wh.id, balanceKg: D(300) } });
  const dye = await ensureTestDyeHouse();
  const mk = async (n: string, status: "PLANNED" | "IN_PROGRESS" | "CANCELLED" | "COMPLETED", plannedM: number, fason = false) =>
    (await prisma.weavingOrder.create({
      data: {
        weavingOrderNumber: `${f.tag}-DO${n}`, itemId: f.fabricId, plannedM: D(plannedM), status,
        executionKind: fason ? "SUBCONTRACTED" : "IN_HOUSE", ...(fason ? { subcontractorId: dye.id } : {}),
      },
      select: { id: true },
    })).id;
  const wo = { p: await mk("1", "PLANNED", 1000), ip: await mk("2", "IN_PROGRESS", 500), c: await mk("3", "CANCELLED", 700), done: await mk("4", "COMPLETED", 900), fason: await mk("5", "PLANNED", 400, true) };
  await prisma.roll.create({ data: { barcode: `${f.tag}-R1`, itemId: f.fabricId, initialQty: D(200), currentQty: D(200), entrySource: "WEAVING", weavingOrderId: wo.p } });
  return { f, customerId: cust.id, lineId: order.lines[0]!.id, wo, beamId: null };
}

async function temizle(f: MaliyetFikstur): Promise<void> {
  const tag = { startsWith: `${f.tag}-` };
  await prisma.warpBeamEvent.deleteMany({ where: { beam: { beamNo: tag } } });
  await prisma.warpBeam.deleteMany({ where: { beamNo: tag } });
  await prisma.roll.deleteMany({ where: { barcode: tag } });
  await prisma.weavingOrder.deleteMany({ where: { weavingOrderNumber: tag } });
  await prisma.yarnStock.deleteMany({ where: { warehouse: { code: tag } } });
  await prisma.warehouse.deleteMany({ where: { code: tag } });
  await prisma.orderLine.deleteMany({ where: { order: { orderNumber: tag } } });
  await prisma.order.deleteMany({ where: { orderNumber: tag } });
  await prisma.customer.deleteMany({ where: { code: tag } });
  await fiksturSil(f);
}

const row = (r: YarnNeedReport, id: string) => r.satirlar.find((s) => s.iplikId === id);
const stable = (r: YarnNeedReport) => JSON.stringify({ ...r, meta: { ...r.meta, hesapZamani: "-" } });
const stableSunum = (r: YarnNeedReport) => {
  const s = buildYarnNeedSunumu(r, {});
  return JSON.stringify({ ...s, donem: null });
};
const group = (x: Fx, plannedM: number): WeavingProposal =>
  ({ key: "G1", itemId: x.f.fabricId, itemName: "Kumaş", recipeId: null, plannedM, orderLines: [] }) as unknown as WeavingProposal;

async function bolum1(x: Fx): Promise<void> {
  // Ayar kapalı: açık işler VAR iken ölç; sonra tüm işleri geçici iptal edip yeniden ölç → eşit olmalı.
  const s = spy(["weavingOrder"]);
  let off: YarnNeedReport;
  let offSummary: Awaited<ReturnType<typeof yarnSummaries>>;
  try {
    off = await withSettings(OFF, () => yarnNeedReport({ leventDus: false }));
    offSummary = await withSettings(OFF, () => yarnSummaries([group(x, 100)]));
  } finally {
    s.restore();
  }
  check("§1a ⭐ Kapalı: dokuma işi tablosuna SIFIR erişim (rapor + öneri özeti)", s.count() === 0, String(s.count()));
  const hasKey = JSON.stringify(off).match(/"ayrilanKg"|"serbestKg"|"ayirma"/);
  check("§1b ⭐ Kapalı: satır/özet/meta'da ayırma anahtarı YOK", hasKey === null, hasKey?.[0] ?? "");
  const ids = Object.values(x.wo);
  const before = await prisma.weavingOrder.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  let noOrders: YarnNeedReport;
  let noOrdersSummary: Awaited<ReturnType<typeof yarnSummaries>>;
  try {
    await prisma.weavingOrder.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
    noOrders = await withSettings(OFF, () => yarnNeedReport({ leventDus: false }));
    noOrdersSummary = await withSettings(OFF, () => yarnSummaries([group(x, 100)]));
  } finally {
    for (const b of before) await prisma.weavingOrder.update({ where: { id: b.id }, data: { status: b.status } });
  }
  check("§1c ⭐ Kapalı: rapor açık işlerden BAĞIMSIZ (JSON eşit = bugünkü yanıt)", stable(off) === stable(noOrders));
  check("§1d ⭐ Kapalı: sunum zarfı (kolonlar/tanımlar/uyarılar) eşit", stableSunum(off) === stableSunum(noOrders));
  const sumOff = JSON.stringify([...offSummary]);
  check("§1e ⭐ Kapalı: öneri iplik özeti eşit ve reservedKg/freeKg anahtarı yok", sumOff === JSON.stringify([...noOrdersSummary]) && !/reservedKg|freeKg/.test(sumOff));
  check("§1f Kapalı: `warnings` boş (rapor + öneri)", yarnReservationWarnings(off).length === 0 && proposalWarnings([{ itemName: "K", yarnSummary: offSummary.get("G1") }]).length === 0);
  const dokumaOff = await withSettings({ ...ON, [SETTING_KEYS.DOKUMA_ENABLED]: false }, () => yarnNeedReport({ leventDus: false }));
  check("§1g Dokuma kapalıyken ayar açık olsa da ayırma yok (ebeveyn kapısı)", dokumaOff.meta.ayirma === undefined && row(dokumaOff, x.f.warpYarnId)?.ayrilanKg === undefined);
}

async function bolum2ila6(x: Fx): Promise<void> {
  const { f } = x;
  const input = await assembleCostInputTx(prisma as unknown as Prisma.TransactionClient, { itemId: f.fabricId });
  const u = yarnUsagePerM(input);
  const kWarp = u.warp!.kgPerM;
  const kA = u.weft.find((w) => w.yarnItemId === f.weftAId)!.kgPerM;
  const on = await withSettings(ON, () => yarnNeedReport({ netle: false, leventDus: false }));
  const w = row(on, f.warpYarnId)!;
  const reservedWarp = kWarp.mul(1300);
  check("§2a ⭐ Çözgü ayrılan = kg/m × (1000 − 200 top + 500)", w.ayrilanKg === kg3(reservedWarp), `${w.ayrilanKg} vs ${kg3(reservedWarp)}`);
  check("§2b ⭐ Serbest = stok (300) − ayrılan", w.serbestKg === kg3(D(300).minus(reservedWarp)) && w.serbestStokKg === "300.000", String(w.serbestKg));
  check("§2c ⭐ Talep netlenir: çözgü ihtiyacı = kg/m × (5000 − 1300)", w.ihtiyacKg === kg3(kWarp.mul(3700)), w.ihtiyacKg);
  check("§2d ⭐ Eksik serbest miktara göre", w.eksikKg === kg3(yarnShortKg(kWarp.mul(3700), D(300).minus(reservedWarp), null)), w.eksikKg);
  check("§2e Atkı A ayrılan = kg/m × 1300; stok yok → serbest eksi", row(on, f.weftAId)?.ayrilanKg === kg3(kA.mul(1300)) && row(on, f.weftAId)?.serbestKg === kg3(kA.mul(1300).neg()));
  const sumRes = on.satirlar.reduce((a, r) => a.plus(r.ayrilanKg!), D(0));
  check("§2f Özet: ayrilanKg = Σ satır; meta.ayirma {isSayisi 2, talepNetlendi, netlenenKumasM 1300.0}",
    on.ozet.ayrilanKg === kg3(sumRes) && on.meta.ayirma?.isSayisi === 2 && on.meta.ayirma.talepNetlendi === true && on.meta.ayirma.netlenenKumasM === "1300.0" && on.ozet.kumasMetre === "3700.0",
    JSON.stringify(on.meta.ayirma));
  const sun = buildYarnNeedSunumu(on, {});
  check("§2g Sunum: 'Ayrılan' ve 'Serbest' kolonları + tanım", sun.tablo!.kolonlar.some((k) => k.anahtar === "ayrilanKg") && sun.tablo!.kolonlar.some((k) => k.anahtar === "serbestKg") && sun.tanimlar.some((t) => t.ad === "Ayrılan"));

  // §3 iptal/tamamlanan/fason: IN_PROGRESS işi iptal → 800 kalır.
  await prisma.weavingOrder.update({ where: { id: x.wo.ip }, data: { status: "CANCELLED" } });
  try {
    const r3 = await withSettings(ON, () => yarnNeedReport({ netle: false, leventDus: false }));
    check("§3 ⭐ İptal/tamamlanan/fason ayırmaz: yalnız PLANNED kalan 800 m", row(r3, f.warpYarnId)?.ayrilanKg === kg3(kWarp.mul(800)) && r3.meta.ayirma?.isSayisi === 1, row(r3, f.warpYarnId)?.ayrilanKg);
  } finally {
    await prisma.weavingOrder.update({ where: { id: x.wo.ip }, data: { status: "IN_PROGRESS" } });
  }

  // §4 müşteri süzgeci
  const r4 = await withSettings(ON, () => yarnNeedReport({ netle: false, leventDus: false, musteriId: x.customerId }));
  check("§4 Müşteri süzgecinde talep netlenmez (ihtiyaç 5000 m'den), uyarı var", row(r4, f.warpYarnId)?.ihtiyacKg === kg3(kWarp.mul(5000)) && r4.meta.ayirma?.talepNetlendi === false
    && yarnReservationWarnings(r4).some((m) => m.includes("Müşteri süzgecinde")));

  // §5 uyarı
  const warn = yarnReservationWarnings(on);
  check("§5 ⭐ Ayrılan stoğu aşan iplik → warnings (engellemez, rapor döndü)", warn.some((m) => m.includes("serbest stoğu aşıyor")), warn.join(" | "));

  // §6 talep yokken ayrılan iplik satırı
  await prisma.orderLine.update({ where: { id: x.lineId }, data: { cancelledAt: new Date() } });
  try {
    const r6 = await withSettings(ON, () => yarnNeedReport({ netle: false, leventDus: false }));
    const r6w = row(r6, f.warpYarnId);
    check("§6 Talep yok: işe ayrılan iplik yine satır (ihtiyaç 0, ayrılan dolu)", r6w?.ihtiyacKg === "0.000" && r6w.ayrilanKg === kg3(reservedWarp) && r6.satirlar.length === 3, JSON.stringify(r6w));
  } finally {
    await prisma.orderLine.update({ where: { id: x.lineId }, data: { cancelledAt: null } });
  }
}

async function bolum7(x: Fx): Promise<void> {
  const { f } = x;
  const beam = await prisma.warpBeam.create({
    data: { beamNo: `${f.tag}-LV`, warpSpecId: f.warpSpecId, status: WarpBeamStatus.READY, plannedLengthM: D(1200), originKind: WarpBeamOrigin.IN_HOUSE },
    select: { id: true },
  });
  try {
    await prisma.warpBeamEvent.create({
      data: {
        beamId: beam.id, kind: "WOUND", fromStatus: WarpBeamStatus.PLANNED, toStatus: WarpBeamStatus.READY, lengthM: D(1000),
        endsCount: 9600, denier: D(75), theoreticalKg: D(80), kgSource: WarpKgSource.THEORETICAL,
      },
    });
    const input = await assembleCostInputTx(prisma as unknown as Prisma.TransactionClient, { itemId: f.fabricId });
    const kWarp = yarnUsagePerM(input).warp!.kgPerM;
    const off = await withSettings(OFF, () => yarnNeedReport({ netle: false, leventDus: true }));
    const on = await withSettings(ON, () => yarnNeedReport({ netle: false, leventDus: true }));
    // 1000 m çözgü = 940 m kumaş (take-up %6): işler 1300 m'nin 940'ını leventten alır.
    check("§7a ⭐ Hazır levent ÖNCE işlere: ayrılan çözgü = kg/m × (1300 − 940)", row(on, f.warpYarnId)?.ayrilanKg === kg3(kWarp.mul(360)), row(on, f.warpYarnId)?.ayrilanKg);
    check("§7b Talep leventin kalanını görür (kalmadı): ihtiyaç = kg/m × 3700", row(on, f.warpYarnId)?.cozguKg === kg3(kWarp.mul(3700)), row(on, f.warpYarnId)?.cozguKg);
    check("§7c Kapalıyken levent talebe (bugünkü): çözgü = kg/m × (5000 − 940)", row(off, f.warpYarnId)?.cozguKg === kg3(kWarp.mul(4060)), row(off, f.warpYarnId)?.cozguKg);
    const nb = await withSettings(ON, () => yarnNeedReport({ netle: false, leventDus: false }));
    check("§7d leventDus=0 → işlere de düşüm yok (ayrılan = kg/m × 1300)", row(nb, f.warpYarnId)?.ayrilanKg === kg3(kWarp.mul(1300)));
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: beam.id } });
    await prisma.warpBeam.delete({ where: { id: beam.id } });
  }
}

async function bolum8(x: Fx): Promise<void> {
  const { f } = x;
  const input = await assembleCostInputTx(prisma as unknown as Prisma.TransactionClient, { itemId: f.fabricId });
  const kWarp = yarnUsagePerM(input).warp!.kgPerM;
  const on = await withSettings(ON, () => yarnSummaries([group(x, 100)]));
  const y = on.get("G1")?.yarns.find((r) => r.yarnItemId === f.warpYarnId);
  const res = Number(kg3(kWarp.mul(1300)));
  const free = Math.round((300 - Number(kWarp.mul(1300))) * 1000) / 1000;
  check("§8a ⭐ Öneri özeti: reservedKg tesis geneli ayrılan, freeKg = stok − ayrılan", y?.reservedKg === res && y.freeKg === free, JSON.stringify(y));
  const need = kWarp.mul(100);
  check("§8b ⭐ shortKg serbest miktara göre", y?.shortKg === Number(kg3(yarnShortKg(need, D(300).minus(kWarp.mul(1300)), null))), String(y?.shortKg));
  const ws = proposalWarnings([{ itemName: "Kumaş", yarnSummary: on.get("G1") }]);
  check("§8c Ayrılan yüzünden eksik → öneri warnings", ws.length > 0 && ws.every((m) => m.includes("açık dokuma iş emirlerine ayrılmış")), ws.join(" | "));
}

async function main(): Promise<void> {
  console.log("=== İPLİK AYIRMA BEKÇİSİ (SY-3 I1) ===");
  assertGelistirmeVeritabani("test_iplik_ayirma");
  const f = await fiksturKur("MIA");
  try {
    const x = await kur(f);
    await bolum1(x);
    await bolum2ila6(x);
    await bolum7(x);
    await bolum8(x);
  } finally {
    await temizle(f);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
