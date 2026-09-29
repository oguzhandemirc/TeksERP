// ANLIK projeksiyonlar (§3.3): her turda bütünüyle yeniden hesaplanan toplamlar. Kaynak
// servisler aynen çağrılır (yeni iş mantığı YOK); çıktı ADIYLA seçilen alanlardan kurulur
// ve KATI tel şemasından geçer — servis yarın operatör adı ya da top barkodu eklese de o
// alan buluta gitmez (opt-in). İçerik özeti son ONAYLANANLA aynıysa paketlenmez.
import { z } from "zod";
import prisma from "../lib/prisma";
import { FLOW_COLUMNS, getBossOverview, bossShippingSection, bossSubcontractSection } from "../services/boss/overview.service";
import { getStockScorecard } from "../services/reports/stock-scorecard.report.service";
import { getOpenOrderCoverage } from "../services/reports/open-order-coverage.report.service";
import { getShipmentScorecard } from "../services/reports/shipment-scorecard.report.service";
import { getSubcontractScorecard } from "../services/reports/subcontract-scorecard.report.service";
import { AGING_BUCKETS, getAgingReport } from "../services/reports/finance-aging.report";
import { chequeService } from "../services/cheque.service";
import { InventoryService } from "../services/inventory.service";
import { DashboardService } from "../services/dashboard.service";
import { STANDARD_PERIODS, periodRange, type StandardPeriod } from "./periods";
import { SNAPSHOT_PROJECTIONS, type SnapshotProjection } from "./projections";
import { toWireValue, type WireContainer } from "./wire";
import { remoteReportCatalog } from "./report-requests";
import { snapshotDigest } from "./digest";

export interface BuiltSnapshot {
  /** Tel adı (`ozet.stok`, `stok-karnesi`…). */
  readonly projection: string;
  readonly digest: string;
  readonly data: WireContainer;
}

const Num = z.number();
const Str = z.string();
const NumStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const Label = z.strictObject({ etiket: Str, miktar: Num });
const PERIOD_KEY: Readonly<Record<StandardPeriod, string>> = { bugun: "bugun", "bu-ay": "buAy", "gecen-ay": "gecenAy", "son-30-gun": "son30Gun" };
const periodsOf = <T extends z.ZodType>(row: T) => z.strictObject({ bugun: row, buAy: row, gecenAy: row, son30Gun: row });

const ShippingWire = z.strictObject({ sevkMiktari: Num, sevkTopSayisi: Num, zamanindaYuzde: Num, tamamlananSiparis: Num, ortGecikmeGun: Num.nullable() });
const SubcontractWire = z.strictObject({ acikMiktar: Num, acikKalem: Num, fireYuzde: Num, ortDonusGun: Num.nullable(), enEskiAcikGun: Num.nullable() });

/** Tel şemaları — anlık başına KATI; tanımadığı anahtar varsa kurucu FIRLATIR (sözleşme dışı çıktı gitmez). */
export const SNAPSHOT_WIRE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "ozet.stok": z.strictObject({ hamMiktar: Num, yariMamulMiktar: Num, bitmisMiktar: Num, oluMiktar: Num, oluStokGun: Num, enCokUrun: z.array(Label) }),
  "ozet.siparis": z.strictObject({ acikKalem: Num, acikMiktar: Num, karsilanmayanMiktar: Num, karsilanmaYuzde: Num, gecikenKalem: Num, gecikenMiktar: Num, enCokCari: z.array(Label) }),
  "ozet.uretim": z.strictObject({
    kolonlar: z.array(z.strictObject({ anahtar: Str, etiket: Str, adet: Num })),
    istasyonlar: z.array(z.strictObject({ ad: Str, kuyruk: Num, aktif: Num, bugunTamamlanan: Num })),
  }),
  "ozet.sevkiyat": periodsOf(ShippingWire),
  "ozet.fason": periodsOf(SubcontractWire),
  "ozet-finans": z.strictObject({
    kasalar: z.array(z.strictObject({ id: Str, kod: Str.nullable(), ad: Str, doviz: Str, bakiye: NumStr })),
    bankalar: z.array(z.strictObject({ id: Str, kod: Str.nullable(), ad: Str, doviz: Str, bakiye: NumStr })),
    cekDurum: z.array(z.strictObject({ tur: Str, durum: Str, doviz: Str, adet: Num, tutar: NumStr })),
    cekVade: z.array(z.strictObject({ kova: Str, tur: Str, doviz: Str, adet: Num, tutar: NumStr })),
    yaslandirma: z.array(z.strictObject({ doviz: Str, kovalar: z.record(z.enum(AGING_BUCKETS), NumStr), acikToplam: NumStr, gecikmis: NumStr, avans: NumStr })),
  }),
  "stok-karnesi": z.strictObject({
    ozet: z.strictObject({
      bitmisMiktar: Num, bitmisAdet: Num, hamMiktar: Num, hamAdet: Num, yariMamulMiktar: Num, yariMamulAdet: Num,
      yasliMiktar: Num, oluMiktar: Num, oluStokGun: Num, yassizAdet: Num, yassizMiktar: Num,
    }),
    yasKovalari: z.array(z.strictObject({ anahtar: Str, etiket: Str, adet: Num, miktar: Num, yuzde: Num })),
    urunler: z.array(z.strictObject({ anahtar: Str, etiket: Str, adet: Num, miktar: Num, enEskiGun: Num.nullable(), siparissizMiktar: Num })),
  }),
  "acik-siparis-karsilama": z.strictObject({
    ozet: z.strictObject({
      acikKalem: Num, acikMiktar: Num, depodanMiktar: Num, uretimdenMiktar: Num, karsilanmayanMiktar: Num, hamEksikMiktar: Num,
      tamKarsilanan: Num, kismiKarsilanan: Num, karsilanmayan: Num, gecikenKalem: Num, gecikenMiktar: Num, karsilanmaYuzde: Num,
    }),
    cariler: z.array(z.strictObject({ anahtar: Str, etiket: Str, kalem: Num, acikMiktar: Num, depodanMiktar: Num, uretimdenMiktar: Num, karsilanmayanMiktar: Num, karsilanmaYuzde: Num })),
    urunler: z.array(z.strictObject({ anahtar: Str, etiket: Str, kalem: Num, acikMiktar: Num, depodanMiktar: Num, uretimdenMiktar: Num, karsilanmayanMiktar: Num, karsilanmaYuzde: Num })),
  }),
  "rapor-katalogu": z.strictObject({
    raporlar: z.array(z.strictObject({ anahtar: Str, baslik: Str, soru: Str, aile: Str, izin: Str, parametreler: z.array(Str), standartDonemler: z.array(Str) })),
  }),
  "uretim-akisi": z.strictObject({
    kolonlar: z.array(z.strictObject({ anahtar: Str, etiket: Str, adet: Num })),
    istasyonlar: z.array(z.strictObject({ id: Str, kod: Str, ad: Str, tur: Str, kuyruk: Num, aktif: Num, bugunTamamlanan: Num, bugunSevk: Num })),
  }),
};

function seal(projection: string, raw: unknown): BuiltSnapshot {
  const schema = SNAPSHOT_WIRE_SCHEMAS[projection];
  if (!schema) throw new Error(`Anlık tel şeması yok: ${projection}`);
  const data = toWireValue(schema.parse(toWireValue(raw)));
  // Tel sözleşmesi anlık veriyi nesne ya da dizi ister (`SnapshotEntrySchema.veri`); skaler sessizce gitmez.
  if (data === null || typeof data !== "object") throw new Error(`Anlık veri nesne/dizi değil: ${projection}`);
  return { projection, digest: snapshotDigest(data), data };
}

async function buildOverview(now: Date, productionOn: boolean): Promise<BuiltSnapshot[]> {
  // İzin süzmesiz çekirdek: bulutta izin sınırı bölüm adıdır (§3.3), fabrika izinleri taşınmaz.
  const o = await getBossOverview({ permissions: ["*"], range: periodRange("son-30-gun", now) });
  const out: BuiltSnapshot[] = [];
  if (o.stock) {
    out.push(seal("ozet.stok", {
      hamMiktar: o.stock.rawQty, yariMamulMiktar: o.stock.semiQty, bitmisMiktar: o.stock.finishedQty,
      oluMiktar: o.stock.deadQty, oluStokGun: o.stock.deadStockDays,
      enCokUrun: o.stock.topItems.map((t) => ({ etiket: t.label, miktar: t.qty })),
    }));
  }
  if (o.orders) {
    out.push(seal("ozet.siparis", {
      acikKalem: o.orders.openLineCount, acikMiktar: o.orders.openQty, karsilanmayanMiktar: o.orders.uncoveredQty,
      karsilanmaYuzde: o.orders.coveragePct, gecikenKalem: o.orders.overdueLines, gecikenMiktar: o.orders.overdueQty,
      enCokCari: o.orders.topCustomers.map((t) => ({ etiket: t.label, miktar: t.qty })),
    }));
  }
  if (o.production && productionOn) {
    out.push(seal("ozet.uretim", {
      kolonlar: o.production.columns.map((c) => ({ anahtar: c.key, etiket: c.label, adet: c.count })),
      istasyonlar: o.production.stations.map((s) => ({ ad: s.name, kuyruk: s.queueCount, aktif: s.activeCount, bugunTamamlanan: s.todayCompleted })),
    }));
  }
  const shipping: Record<string, unknown> = {};
  const subcontract: Record<string, unknown> = {};
  for (const p of STANDARD_PERIODS) {
    const range = periodRange(p, now);
    const s = bossShippingSection(await getShipmentScorecard(range));
    shipping[PERIOD_KEY[p]] = { sevkMiktari: s.shippedQty, sevkTopSayisi: s.shippedRollCount, zamanindaYuzde: s.onTimePct, tamamlananSiparis: s.completedOrders, ortGecikmeGun: s.avgLateDays };
    const f = bossSubcontractSection(await getSubcontractScorecard(range));
    subcontract[PERIOD_KEY[p]] = { acikMiktar: f.openQty, acikKalem: f.openItems, fireYuzde: f.firePct, ortDonusGun: f.avgTurnaroundDays, enEskiAcikGun: f.oldestOpenDays };
  }
  out.push(seal("ozet.sevkiyat", shipping));
  out.push(seal("ozet.fason", subcontract));
  return out;
}

async function buildFinance(now: Date): Promise<BuiltSnapshot> {
  const boxes = await prisma.cashBox.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, currency: true, balance: true }, orderBy: { name: "asc" } });
  const banks = await prisma.bankAccount.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, currency: true, balance: true }, orderBy: { name: "asc" } });
  const status = (await chequeService.summary()).data;
  const due = (await chequeService.dueSummary()).data;
  const { blocks } = await getAgingReport({ asOf: now });
  return seal("ozet-finans", {
    kasalar: boxes.map((b) => ({ id: b.id, kod: b.code, ad: b.name, doviz: b.currency, bakiye: b.balance })),
    bankalar: banks.map((b) => ({ id: b.id, kod: b.code, ad: b.name, doviz: b.currency, bakiye: b.balance })),
    cekDurum: status.map((c) => ({ tur: c.kind, durum: c.status, doviz: c.currency, adet: c.count, tutar: c.amount })),
    cekVade: (due?.buckets ?? []).map((b) => ({ kova: b.bucket, tur: b.kind, doviz: b.currency, adet: b.count, tutar: b.amount })),
    yaslandirma: blocks.map((b) => ({ doviz: b.currency, kovalar: b.totals.net, acikToplam: b.totals.openTotal, gecikmis: b.totals.overdueTotal, avans: b.totals.unappliedCredit })),
  });
}

async function buildStock(): Promise<BuiltSnapshot> {
  const r = await getStockScorecard();
  const s = r.summary;
  return seal("stok-karnesi", {
    ozet: {
      bitmisMiktar: s.finishedQty, bitmisAdet: s.finishedCount, hamMiktar: s.rawQty, hamAdet: s.rawCount,
      yariMamulMiktar: s.semiQty, yariMamulAdet: s.semiCount, yasliMiktar: s.agedQty, oluMiktar: s.deadQty,
      oluStokGun: s.deadStockDays, yassizAdet: s.unagedCount, yassizMiktar: s.unagedQty,
    },
    yasKovalari: r.byAge.map((a) => ({ anahtar: a.key, etiket: a.label, adet: a.count, miktar: a.qty, yuzde: a.pct })),
    urunler: r.byItem.map((i) => ({ anahtar: i.key, etiket: i.label, adet: i.count, miktar: i.qty, enEskiGun: i.oldestDays, siparissizMiktar: i.uncoveredQty })),
  });
}

async function buildCoverage(): Promise<BuiltSnapshot> {
  const r = await getOpenOrderCoverage();
  const s = r.summary;
  const bucket = (b: (typeof r.byCustomer)[number]) => ({
    anahtar: b.key, etiket: b.label, kalem: b.lineCount, acikMiktar: b.openQty, depodanMiktar: b.fromWarehouseQty,
    uretimdenMiktar: b.fromProductionQty, karsilanmayanMiktar: b.uncoveredQty, karsilanmaYuzde: b.coveragePct,
  });
  return seal("acik-siparis-karsilama", {
    ozet: {
      acikKalem: s.openLineCount, acikMiktar: s.openQty, depodanMiktar: s.fromWarehouseQty, uretimdenMiktar: s.fromProductionQty,
      karsilanmayanMiktar: s.uncoveredQty, hamEksikMiktar: s.materialGapQty, tamKarsilanan: s.fullyCoveredLines,
      kismiKarsilanan: s.partiallyCoveredLines, karsilanmayan: s.uncoveredLines, gecikenKalem: s.overdueUncoveredLines,
      gecikenMiktar: s.overdueUncoveredQty, karsilanmaYuzde: s.coveragePct,
    },
    cariler: r.byCustomer.map(bucket),
    urunler: r.byItem.map(bucket),
  });
}

async function buildProductionFlow(): Promise<BuiltSnapshot> {
  const flow = await new InventoryService().getProductionFlow({ includeQueues: true, includeSevk: true });
  const stations = await DashboardService.getStationsLiveState();
  const data = flow.data;
  return seal("uretim-akisi", {
    kolonlar: FLOW_COLUMNS.map(([key, label]) => ({ anahtar: key, etiket: label, adet: data ? data[key].total : 0 })),
    istasyonlar: stations.map((s) => ({
      id: s.id, kod: s.code, ad: s.name, tur: s.type, kuyruk: s.queueCount, aktif: s.activeCount,
      bugunTamamlanan: s.todayCompletedCount, bugunSevk: s.todayDispatchedCount,
    })),
  });
}

async function buildReportCatalog(): Promise<BuiltSnapshot> {
  return seal("rapor-katalogu", { raporlar: await remoteReportCatalog() });
}

export interface SnapshotContext {
  readonly now: Date;
  readonly productionOn: boolean;
  readonly financeOn: boolean;
  /** Bu tura düşen sıklıklar (HER_TUR her turda; SAATLIK/GUNLUK zamanı gelince). */
  readonly cadences: ReadonlySet<SnapshotProjection["cadence"]>;
}

/** Turun anlık kayıtları — modülü kapalı projeksiyon ÜRETİLMEZ (§4.6). */
export async function buildSnapshots(ctx: SnapshotContext): Promise<BuiltSnapshot[]> {
  const out: BuiltSnapshot[] = [];
  for (const p of SNAPSHOT_PROJECTIONS) {
    if (!ctx.cadences.has(p.cadence)) continue;
    if (p.module === "production.enabled" && !ctx.productionOn) continue;
    if (p.module === "finance.enabled" && !ctx.financeOn) continue;
    switch (p.name) {
      case "ozet":
        out.push(...(await buildOverview(ctx.now, ctx.productionOn)));
        break;
      case "ozet-finans":
        out.push(await buildFinance(ctx.now));
        break;
      case "stok-karnesi":
        out.push(await buildStock());
        break;
      case "acik-siparis-karsilama":
        out.push(await buildCoverage());
        break;
      case "rapor-katalogu":
        out.push(await buildReportCatalog());
        break;
      case "uretim-akisi":
        out.push(await buildProductionFlow());
        break;
      default:
        throw new Error(`Anlık kurucu yok: ${p.name}`);
    }
  }
  return out;
}
