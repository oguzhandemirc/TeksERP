// ANLIK `karlilik-ozet` (D4-G4; DALGA4 §8.8, kullanıcı kararı S15 a): son 12 fabrika ayı + bu ayın işlem kırılımı +
// müşteri ilk 10 (en kârlı / en zararlı). HESAP FABRİKADA: tek kaynak `computeProfitability`; kırılım ve rozet panel
// raporunun `profitGroups`/`badgeOf`u, sıralama burada — bulut ve uygulama aritmetik yapmaz (`test_bulut_karlilik_ozeti`).
// Tel yalnız ay/işlem/müşteri ADI + TL + rozet taşır: fatura no, top, satır, kişi GİTMEZ (katı şema).
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { computeProfitability, factoryMonthOf, type ProfitabilityResult } from "../services/helpers/profitability.helper";
import { loadNames } from "../services/reports/profitability.report";
import { badgeOf, profitGroups, settingsSummary, totalOf, type Group, type ProfitNames } from "../services/reports/profitability.sunum";
import { factoryMonthStart } from "./periods";

export const PROFIT_SNAPSHOT = "karlilik-ozet";
export const PROFIT_MONTHS = 12;
/** En kârlı ve en zararlı listelerin her birinde en çok bu kadar müşteri. */
export const PROFIT_TOP_CUSTOMERS = 10;

const NumStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const Month = z.string().regex(/^\d{4}-\d{2}$/);
/** Eksik girdili kalem 0 yazılmaz: `null` + rozet ("eksik: sarf normu, döviz kuru" · "tahmini" · ""). */
const Money = { gelir: NumStr, katki: NumStr.nullable(), net: NumStr.nullable(), rozet: z.string() };

/** Katı tel şeması — tanımadığı anahtar (ör. fatura satırı, top, belge no) varsa kurucu FIRLATIR. */
export const PROFIT_SNAPSHOT_SCHEMA = z.strictObject({
  buAy: Month,
  /** Ayarın okuma anındaki özeti (panel başlığındaki "hesap: …" ile aynı metin). */
  hesap: z.string(),
  donem: z.strictObject({ ...Money, sarf: NumStr.nullable(), makine: NumStr.nullable(), disFason: NumStr.nullable() }),
  aylar: z.array(z.strictObject({ ay: Month, ...Money })).max(PROFIT_MONTHS),
  buAyIslemler: z.array(z.strictObject({ etiket: z.string(), metre: NumStr, ...Money })),
  enKarli: z.array(z.strictObject({ etiket: z.string(), ...Money })).max(PROFIT_TOP_CUSTOMERS),
  enZararli: z.array(z.strictObject({ etiket: z.string(), ...Money })).max(PROFIT_TOP_CUSTOMERS),
  /** Katkısı eksik girdi yüzünden hesaplanamayan müşteri sayısı (sıralamaya girmez). */
  hesaplanamayanMusteri: z.number().int(),
});

type SnapshotInput = z.input<typeof PROFIT_SNAPSHOT_SCHEMA>;
const tl = (d: Prisma.Decimal | null): string | null => (d === null ? null : d.toFixed(2));
const money = (g: Group) => ({ gelir: g.revenue.toFixed(2), katki: tl(g.contribution), net: tl(g.net), rozet: badgeOf(g) });

/**
 * Müşteri sıralaması FABRİKADA (S15 a): katkısı olan müşteriler; en kârlı = katkı > 0 azalan, en zararlı = katkı < 0
 * artan, her biri ilk 10. Eşitlikte grup sırası (müşteri kimliği) korunur (sıralama kararlı).
 */
export function rankCustomers(groups: readonly Group[]): { top: Group[]; worst: Group[]; unknown: number } {
  const known = groups.filter((g) => g.contribution !== null);
  const top = known.filter((g) => g.contribution!.gt(0)).sort((a, b) => b.contribution!.comparedTo(a.contribution!)).slice(0, PROFIT_TOP_CUSTOMERS);
  const worst = known.filter((g) => g.contribution!.lt(0)).sort((a, b) => a.contribution!.comparedTo(b.contribution!)).slice(0, PROFIT_TOP_CUSTOMERS);
  return { top, worst, unknown: groups.length - known.length };
}

/** Saf: hesaplanmış sonuçtan tel verisi (bekçi DB'siz sentetik sonuçla ölçer). */
export function profitSnapshotFromResult(result: ProfitabilityResult, names: ProfitNames, thisMonth: string): SnapshotInput {
  const months: string[] = [];
  for (let m = result.fromMonth; m <= result.toMonth; m = nextMonth(m)) months.push(m);
  const total = totalOf(profitGroups(result.rows, "ay", names));
  const ranked = rankCustomers(profitGroups(result.rows, "musteri", names));
  return {
    buAy: thisMonth,
    hesap: settingsSummary(result.settings),
    donem: { ...money(total), sarf: tl(total.consumable), makine: tl(total.machine), disFason: tl(total.subcontract) },
    aylar: months.map((ay) => ({ ay, ...money(totalOf(profitGroups(result.rows.filter((r) => r.month === ay), "ay", names))) })),
    buAyIslemler: profitGroups(result.rows.filter((r) => r.month === thisMonth), "islem", names)
      .map((g) => ({ etiket: g.label, metre: g.meters.toFixed(2), ...money(g) })),
    enKarli: ranked.top.map((g) => ({ etiket: g.label, ...money(g) })),
    enZararli: ranked.worst.map((g) => ({ etiket: g.label, ...money(g) })),
    hesaplanamayanMusteri: ranked.unknown,
  };
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Ham (henüz mühürlenmemiş) veri; maliyet ya da ön muhasebe kapalıysa `null` (anlık üretilmez). */
export async function buildProfitSnapshotData(now: Date): Promise<SnapshotInput | null> {
  const thisMonth = factoryMonthOf(now);
  const fromMonth = factoryMonthOf(factoryMonthStart(now, -(PROFIT_MONTHS - 1)));
  const result = await computeProfitability({ fromMonth, toMonth: thisMonth });
  if (!result) return null;
  return profitSnapshotFromResult(result, await loadNames([result]), thisMonth);
}
