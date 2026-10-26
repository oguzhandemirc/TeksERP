// =============================================================================
// İPLİK İHTİYAÇ PLANI BEKÇİSİ (MAL-7; plan MALIYET-TEKLIF-PLAN §4.5)
// =============================================================================
//   §0 statik: servis kg'ı `number`a çevirmez; iplik/ticaret/devere modellerine köprü dışında dokunmaz
//   §1 iptal edilmiş kalem talebe girmez · §2 KG birimli kalem `olculemeyen`de, kg'a katılmaz
//   §3 iplik kapalı → serbestStokKg null (0 değil), eksikBelirsiz · §4 ticaret kapalı → acikAlisKg null;
//      açıkken OPEN/PARTIAL düşülür, CLOSED/CANCELLED düşülmez · §5 READY levent kalanı çözgüyü azaltır,
//      devere kapalıyken düşüm yok · §6 emanet lot ayrı kolon, serbest stoğa katılmaz · §7 yapısı eksik
//      ürün `yapisiEksik`te, rapor düşmez · §8 netleme = ProductionBalanceService · §9 ALTIN (§2.3 ürünü
//      5.000 m = motor × metre) · §10 modül kapalı 403 MODULE_DISABLED, izin yok 403, tanınmayan 400
//   §11 iplik/ticaret/devere kapalıyken ilgili tablolara SIFIR sorgu · §12 sunum: null → "bilinmiyor"
// Koşum: npx tsx scripts/test_iplik_ihtiyaci.ts (kendi _test DB'n)
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PurchaseOrderStatus, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { yarnNeedReport, type YarnNeedReport } from "../src/services/reports/yarn-need.report.service";
import { buildYarnNeedSunumu, BILINMIYOR } from "../src/services/reports/yarn-need.sunum";
import { ProductionBalanceService } from "../src/services/production-balance.service";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { yarnUsagePerM } from "../src/services/helpers/fabric-cost.helper";
import { requireMaliyetEnabled } from "../src/middlewares/module.middleware";
import { requirePermission } from "../src/middlewares/rbac.middleware";
import { yarnNeedQuerySchema } from "../src/routes/reports/maliyet.report.routes";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
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

async function withSettings<T>(values: Record<string, boolean>, fn: () => Promise<T>): Promise<T> {
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
const ALL_ON = {
  [SETTING_KEYS.MALIYET_ENABLED]: true, [SETTING_KEYS.IPLIK_ENABLED]: true, [SETTING_KEYS.TICARET_ENABLED]: true,
  [SETTING_KEYS.DEVERE_ENABLED]: true, [SETTING_KEYS.EMANET_ENABLED]: true,
};

/** Prisma model delegesine erişim sayacı — "sorgu atılmadı" kanıtı (emsal `test_standart_maliyet_surum` §5). */
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

interface Fx {
  f: MaliyetFikstur;
  customerId: string;
  ownerId: string;
  orderId: string;
  bareFabricId: string;
  whId: string;
  lotId: string;
  beamId: string;
  poIds: string[];
}

async function kur(f: MaliyetFikstur): Promise<Fx> {
  await altinYapiYaz(f);
  // Alış miktarı yalnız KG birimli kalemde okunur — fikstür iplikleri KG.
  await prisma.item.updateMany({ where: { id: { in: [f.warpYarnId, f.weftAId, f.weftBId] } }, data: { unit: "KG" } });
  const cust = await prisma.customer.create({ data: { code: `${f.tag}-M`, name: `${f.tag} müşteri` }, select: { id: true } });
  const owner = await prisma.customer.create({ data: { code: `${f.tag}-E`, name: `${f.tag} emanetçi` }, select: { id: true } });
  const bare = await prisma.item.create({ data: { code: `${f.tag}-Y`, name: `${f.tag} yapısız kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `${f.tag}-S`, customerId: cust.id,
      lines: {
        create: [
          { itemId: f.fabricId, quantity: D(5000) },
          { itemId: f.fabricId, quantity: D(700), cancelledAt: new Date() },
          { itemId: f.fabricId, quantity: D(80), unit: "KG" },
          { itemId: bare.id, quantity: D(300) },
        ],
      },
    },
    select: { id: true },
  });
  const wh = await prisma.warehouse.create({ data: { code: `${f.tag}-D`, name: `${f.tag} depo` }, select: { id: true } });
  // Çözgü ipliği: toplam 300 kg, bunun 50 kg'ı emanet lotta (müşterinin malı).
  await prisma.yarnStock.create({ data: { itemId: f.warpYarnId, warehouseId: wh.id, balanceKg: D(300) } });
  const lot = await prisma.yarnLot.create({ data: { itemId: f.warpYarnId, lotNo: `${f.tag}-L`, ownerCustomerId: owner.id }, select: { id: true } });
  await prisma.yarnMovement.create({ data: { itemId: f.warpYarnId, warehouseId: wh.id, lotId: lot.id, kind: YarnMovementKind.IN, qtyKg: D(50) } });
  const po = (status: PurchaseOrderStatus, qty: number, received: number, n: number) =>
    prisma.purchaseOrder.create({
      data: { orderNo: `${f.tag}-PO${n}`, orderDate: new Date(), status, lines: { create: [{ lineNo: 1, itemId: f.weftAId, qty: D(qty), receivedQty: D(received) }] } },
      select: { id: true },
    });
  const pos = [await po("OPEN", 100, 0, 1), await po("PARTIAL", 50, 20, 2), await po("CLOSED", 40, 0, 3), await po("CANCELLED", 60, 0, 4)];
  const beam = await prisma.warpBeam.create({
    data: { beamNo: `${f.tag}-LV`, warpSpecId: f.warpSpecId, status: WarpBeamStatus.READY, plannedLengthM: D(1200), originKind: WarpBeamOrigin.IN_HOUSE },
    select: { id: true },
  });
  await prisma.warpBeamEvent.create({
    data: {
      beamId: beam.id, kind: "WOUND", fromStatus: WarpBeamStatus.PLANNED, toStatus: WarpBeamStatus.READY, lengthM: D(1000),
      endsCount: 9600, denier: D(75), theoreticalKg: D(80), kgSource: WarpKgSource.THEORETICAL,
    },
  });
  return { f, customerId: cust.id, ownerId: owner.id, orderId: order.id, bareFabricId: bare.id, whId: wh.id, lotId: lot.id, beamId: beam.id, poIds: pos.map((p) => p.id) };
}

/** Etiket tabanlı temizlik — kurulum yarıda kalsa da kalıntı bırakmaz (yalnız test DB). */
async function temizle(f: MaliyetFikstur): Promise<void> {
  const tag = { startsWith: `${f.tag}-` };
  await prisma.warpBeamEvent.deleteMany({ where: { beam: { beamNo: tag } } });
  await prisma.warpBeam.deleteMany({ where: { beamNo: tag } });
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { orderNo: tag } } });
  await prisma.purchaseOrder.deleteMany({ where: { orderNo: tag } });
  await prisma.yarnMovement.deleteMany({ where: { warehouse: { code: tag } } });
  await prisma.yarnLot.deleteMany({ where: { lotNo: tag } });
  await prisma.yarnStock.deleteMany({ where: { warehouse: { code: tag } } });
  await prisma.warehouse.deleteMany({ where: { code: tag } });
  await prisma.orderLine.deleteMany({ where: { order: { orderNumber: tag } } });
  await prisma.order.deleteMany({ where: { orderNumber: tag } });
  await prisma.item.deleteMany({ where: { code: `${f.tag}-Y` } });
  await prisma.customer.deleteMany({ where: { code: tag } });
  await fiksturSil(f);
}

const row = (r: YarnNeedReport, id: string) => r.satirlar.find((s) => s.iplikId === id);

function bolum0(): void {
  const src = readFileSync(join(__dirname, "../src/services/reports/yarn-need.report.service.ts"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  check("§0a İç hesap Decimal: servis `Number(`/`parseFloat`/`.toNumber()` kullanmaz", !/\bNumber\(|parseFloat\(|\.toNumber\(\)/.test(code));
  const forbidden = /prisma\.(yarnStock|yarnLot|yarnMovement|purchaseOrder|purchaseOrderLine|warpBeam|warpBeamEvent)\b/;
  const staticOwner = /from "\.\.\/(yarn|purchase-order|warp-beam)\.service"|helpers\/warp-beam\.helper/;
  check("§0b Köprü dışı erişim YOK: iplik/ticaret/devere modellerine ve servislerine doğrudan dokunulmaz", !forbidden.test(code) && !staticOwner.test(code));
  check("§0c Talep tek kaynakları: `...ACTIVE_LINE` ve `MEASURED_LINE` taşınır", /\.\.\.ACTIVE_LINE\b/.test(code) && /MEASURED_LINE\b/.test(code) && !/cancelledAt:\s*null/.test(code));
  check("§0d İzin kataloğunda `report:yarn-need` (REPORTS)", PERMISSION_CATALOG.some((p) => p.code === "report:yarn-need" && p.module === "REPORTS"));
}

async function bolumlerAcik(x: Fx): Promise<void> {
  const { f } = x;
  const brut = await yarnNeedReport({ musteriId: x.customerId, netle: false, leventDus: false });
  check("§1 ⭐ İptal edilmiş kalem talebe girmez: kumaş metresi 5000 (700 m iptal sayılmadı)", brut.ozet.kumasMetre === "5000.0", brut.ozet.kumasMetre);
  const kgLine = brut.meta.olculemeyen.find((o) => o.urunId === f.fabricId);
  check("§2 ⭐ KG birimli kalem `olculemeyen`de (1 kalem, 80), kg'a katılmadı", kgLine?.birim === "KG" && kgLine.kalemSayisi === 1 && kgLine.miktar === "80.000");
  const bare = brut.meta.yapisiEksik.find((y) => y.urunId === x.bareFabricId);
  check("§7 ⭐ Yapısı eksik ürün listede (300 m, WARP_SPEC_MISSING); rapor düşmedi, diğer ürün hesaplandı",
    bare?.metre === "300.0" && bare.kalemSayisi === 1 && bare.eksikler.includes("WARP_SPEC_MISSING") && brut.satirlar.length === 3, JSON.stringify(bare));

  // §9 ALTIN: motor × metre.
  const input = await assembleCostInputTx(prisma as unknown as Prisma.TransactionClient, { itemId: f.fabricId });
  const u = yarnUsagePerM(input);
  const wA = u.weft.find((w) => w.yarnItemId === f.weftAId)!.kgPerM;
  const wB = u.weft.find((w) => w.yarnItemId === f.weftBId)!.kgPerM;
  const warp = row(brut, f.warpYarnId);
  check("§9a ⭐ ALTIN çözgü kg = yarnUsagePerM × 5000 (≈ 436,445)", warp?.cozguKg === kg3(u.warp!.kgPerM.mul(5000)) && D(warp!.cozguKg).minus("436.445").abs().lte("0.01"), warp?.cozguKg);
  check("§9b ⭐ ALTIN atkı A ≈ 372,85 · B ≈ 745,705 (motor × metre, çözgü kolonu 0)",
    row(brut, f.weftAId)?.atkiKg === kg3(wA.mul(5000)) && row(brut, f.weftBId)?.atkiKg === kg3(wB.mul(5000))
      && D(row(brut, f.weftAId)!.atkiKg).minus("372.85").abs().lte("0.01") && D(row(brut, f.weftBId)!.atkiKg).minus("745.705").abs().lte("0.01")
      && row(brut, f.weftAId)?.cozguKg === "0.000", `${row(brut, f.weftAId)?.atkiKg} ${row(brut, f.weftBId)?.atkiKg}`);

  // §6 emanet + stok
  check("§6 ⭐ Emanet lot AYRI kolon (50) ve serbest stoğa katılmaz (300 − 50 = 250)", warp?.emanetKg === "50.000" && warp.serbestStokKg === "250.000" && brut.meta.kaynaklar.emanet, `${warp?.serbestStokKg} / ${warp?.emanetKg}`);
  const eksikBeklenen = D(warp!.ihtiyacKg).minus(250);
  check("§6b Eksik = ihtiyaç − serbest stok (emanet düşülmez)", warp?.eksikKg === kg3(eksikBeklenen) && warp.eksikBelirsiz === false, warp?.eksikKg);

  // §4 açık alış
  const a = row(brut, f.weftAId);
  check("§4a ⭐ Açık alış: OPEN 100 + PARTIAL (50−20) = 130; CLOSED/CANCELLED düşülmez", a?.acikAlisKg === "130.000" && brut.meta.kaynaklar.acikAlis, String(a?.acikAlisKg));
  check("§4b Eksik açık alışı düşer (A: ihtiyaç − 0 stok − 130)", a?.eksikKg === kg3(D(a!.ihtiyacKg).minus(130)), a?.eksikKg);

  // §5 hazır levent
  const lv = await yarnNeedReport({ musteriId: x.customerId, netle: false, leventDus: true });
  const beklenen = kg3(u.warp!.kgPerM.mul(D(5000).minus(D(1000).mul("0.94"))));
  check("§5a ⭐ READY levent (1000 m çözgü × (1 − %6) = 940 m kumaş) çözgü ihtiyacını azaltır", row(lv, f.warpYarnId)?.cozguKg === beklenen && lv.meta.kaynaklar.leventDusumu, `${row(lv, f.warpYarnId)?.cozguKg} / ${beklenen}`);
  const lvMeta = lv.meta.leventler.find((l) => l.cozguKartiId === f.warpSpecId);
  check("§5b Levent beyanı: 1 levent, 1000 m kalan, 940 m kumaş düşüldü; atkı etkilenmez", lvMeta?.leventSayisi === 1 && lvMeta.kalanCozguM === "1000.0" && lvMeta.dusulenKumasM === "940.0" && row(lv, f.weftAId)?.atkiKg === row(brut, f.weftAId)?.atkiKg, JSON.stringify(lvMeta));

  // §8 netleme dengesi
  const net = await yarnNeedReport({ musteriId: x.customerId, netle: true, leventDus: false });
  const bal = (await new ProductionBalanceService().getBalance({ itemId: f.fabricId })).data ?? [];
  const acik = bal.reduce((s, g) => s.plus(g.malzemeAcigi), D(0));
  check("§8 ⭐ netle=true metre = ProductionBalanceService kumaş açığı (aynı sayı)", net.ozet.kumasMetre === acik.toFixed(1) && net.meta.netle, `${net.ozet.kumasMetre} / ${acik.toFixed(1)}`);

  // §12 sunum
  const s = buildYarnNeedSunumu(brut, { musteriId: x.customerId });
  check("§12a Sunum tablosu servis satırlarıyla aynı sayıda; emanet kolonu açık", s.tablo?.satirlar.length === brut.satirlar.length && !!s.tablo?.kolonlar.some((k) => k.anahtar === "emanetKg"));
}

async function bolumlerKapali(x: Fx): Promise<void> {
  const { f } = x;
  const off = { ...ALL_ON, [SETTING_KEYS.IPLIK_ENABLED]: false, [SETTING_KEYS.TICARET_ENABLED]: false, [SETTING_KEYS.DEVERE_ENABLED]: false };
  const s = spy(["yarnStock", "yarnLot", "yarnMovement", "purchaseOrder", "purchaseOrderLine", "warpBeam", "warpBeamEvent"]);
  let r: YarnNeedReport;
  try {
    r = await withSettings(off, () => yarnNeedReport({ musteriId: x.customerId, netle: false, leventDus: true }));
  } finally {
    s.restore();
  }
  check("§11 ⭐ İplik/ticaret/devere kapalı: ilgili tablolara SIFIR sorgu", s.count() === 0, `sorgu=${s.count()}`);
  const s2 = spy(["yarnStock", "purchaseOrderLine", "warpBeam"]);
  try {
    await withSettings(ALL_ON, () => yarnNeedReport({ musteriId: x.customerId, netle: false, leventDus: true }));
  } finally {
    s2.restore();
  }
  check("§11b Sonda canlı: modüller açıkken aynı sayaç sorgu görür (> 0)", s2.count() > 0, `sorgu=${s2.count()}`);
  const w = row(r, f.warpYarnId);
  check("§3 ⭐ İplik kapalı → serbestStokKg null (0 DEĞİL), emanet null, eksikBelirsiz", w?.serbestStokKg === null && w.emanetKg === null && w.eksikBelirsiz === true && r.meta.kaynaklar.stok === false);
  check("§3b Stok bilinmiyorken eksik = ihtiyaç (stok sıfır sayıldı, bayrakla)", w?.eksikKg === w?.ihtiyacKg);
  const a = row(r, f.weftAId);
  check("§4c ⭐ Ticaret kapalı → acikAlisKg null ve alış düşülmez", a?.acikAlisKg === null && a.eksikKg === a.ihtiyacKg && r.meta.kaynaklar.acikAlis === false);
  check("§5c ⭐ Devere kapalı → levent düşümü yok, kaynaklar.leventDusumu=false", r.meta.kaynaklar.leventDusumu === false && r.meta.leventler.length === 0 && w?.cozguKg !== undefined
    && D(w!.cozguKg).minus("436.445").abs().lte("0.01"));
  const sun = buildYarnNeedSunumu(r, {});
  const cell = sun.tablo?.satirlar.find((c) => String(c.iplik).includes(`${f.tag} C75`));
  check("§12b ⭐ Sunum: bilinmeyen hücre \"bilinmiyor\" (0 yazılmaz); uyarı beyanı var", cell?.serbestStokKg === BILINMIYOR && cell.acikAlisKg === BILINMIYOR && sun.uyarilar.some((u) => u.includes("stok bilinmiyor")), JSON.stringify(cell));

  const emanetOff = await withSettings({ ...ALL_ON, [SETTING_KEYS.EMANET_ENABLED]: false }, () => yarnNeedReport({ musteriId: x.customerId, netle: false, leventDus: false }));
  const we = row(emanetOff, f.warpYarnId);
  check("§6c Emanet kapalı → emanet kolonu null, stok toplamı serbest (300)", we?.emanetKg === null && we.serbestStokKg === "300.000" && emanetOff.meta.kaynaklar.emanet === false, `${we?.serbestStokKg}`);
}

async function bolum10(): Promise<void> {
  const mw = await withSettings({ [SETTING_KEYS.MALIYET_ENABLED]: false }, () =>
    new Promise<{ statusCode?: number; details?: { code?: string } } | null>((resolve) => void requireMaliyetEnabled({} as never, {} as never, (err?: unknown) => resolve((err as never) ?? null))));
  check("§10a ⭐ Maliyet kapalı → 403 MODULE_DISABLED (details.code)", mw?.statusCode === 403 && mw.details?.code === "MODULE_DISABLED", JSON.stringify(mw));
  const perm = await new Promise<{ statusCode?: number } | null>((resolve) =>
    requirePermission("report:yarn-need")({ user: { userId: "x", permissions: ["report:production"] } } as never, {} as never, (err?: unknown) => resolve((err as never) ?? null)));
  check("§10b İzin yok → 403", perm?.statusCode === 403);
  check("§10c Tanınmayan anahtar ve bozuk değer → 400 (strict zod)", !yarnNeedQuerySchema.safeParse({ x: "1" }).success && !yarnNeedQuerySchema.safeParse({ netle: "evet" }).success && yarnNeedQuerySchema.safeParse({ netle: "0" }).success);
  const route = readFileSync(join(__dirname, "../src/routes/reports/maliyet.report.routes.ts"), "utf8");
  check("§10d Route: `requireMaliyetEnabled` router kapısı + `report:yarn-need` + rapor kapısı", /router\.use\(verifyToken, requireMaliyetEnabled\)/.test(route) && route.includes('requirePermission("report:yarn-need")') && route.includes('requireReportOpen("maliyet/iplik-ihtiyaci")'));
}

async function main(): Promise<void> {
  console.log("=== İPLİK İHTİYAÇ PLANI BEKÇİSİ (MAL-7) ===");
  bolum0();
  assertGelistirmeVeritabani("test_iplik_ihtiyaci");
  const f = await fiksturKur("YNP");
  try {
    const x = await kur(f);
    await withSettings(ALL_ON, () => bolumlerAcik(x));
    await bolumlerKapali(x);
    await bolum10();
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
