// =============================================================================
// AÇILIŞ PANOSU — dönem pencereleri ve eğilim kovaları (fabrika dilimi)
// =============================================================================
// Sınırlar yalnız `constants/time.ts`ten; önceki dönem aynı uzunlukta, takvimde geri kaydırılmış
// penceredir ("dünün aynı saatine kadar" · "7/30 gün önce" · "12 ay önce") — kısmi bugünü tam günle
// kıyaslamamak için.
// =============================================================================
import { Prisma } from "@prisma/client";
import { factoryDayStartOfKey, factoryHourSql, factoryDaySql, factoryMonthSql, factoryTimeHms, factoryYmd } from "../../constants/time";
import { factoryMonthStart } from "../../cloud-sync/periods";
import type { DateRange } from "../reports/_shared";

export const PANO_DONEMLERI = ["bugun", "hafta", "ay", "yil"] as const;
export type PanoDonem = (typeof PANO_DONEMLERI)[number];

/** Eğilim çözünürlüğü: bugün saat saat, hafta/ay gün gün, yıl ay ay. */
export type PanoKova = "saat" | "gun" | "ay";

export interface PanoPencere {
  donem: PanoDonem;
  aralik: DateRange;
  oncekiAralik: DateRange;
  kova: PanoKova;
  /** Eğilim serisinin sıralı anahtarları (`saat` "00".."HH", `gun` YYYY-MM-DD, `ay` YYYY-MM). */
  anahtarlar: string[];
}

const DAY_COUNT: Record<"hafta" | "ay", number> = { hafta: 7, ay: 30 };

/** `YYYY-MM-DD` takvim anahtarını `k` gün kaydırır (takvim aritmetiği; dilimden bağımsız). */
export function shiftDayKey(key: string, k: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
}

function monthKeyOf(at: Date): string {
  return factoryYmd(at).slice(0, 7);
}

export function resolvePanoPencere(donem: PanoDonem, now: Date = new Date()): PanoPencere {
  const today = factoryYmd(now);
  const todayStart = factoryDayStartOfKey(today);
  const elapsedToday = now.getTime() - todayStart.getTime();

  if (donem === "bugun") {
    const prevFrom = factoryDayStartOfKey(shiftDayKey(today, -1));
    const hour = Number(factoryTimeHms(now).slice(0, 2));
    return {
      donem,
      aralik: { from: todayStart, to: now },
      oncekiAralik: { from: prevFrom, to: new Date(prevFrom.getTime() + elapsedToday) },
      kova: "saat",
      anahtarlar: Array.from({ length: hour + 1 }, (_, h) => String(h).padStart(2, "0")),
    };
  }

  if (donem === "yil") {
    const from = factoryMonthStart(now, -11);
    const prevFrom = factoryMonthStart(now, -23);
    const elapsedMonth = now.getTime() - factoryMonthStart(now, 0).getTime();
    return {
      donem,
      aralik: { from, to: now },
      oncekiAralik: { from: prevFrom, to: new Date(factoryMonthStart(now, -12).getTime() + elapsedMonth) },
      kova: "ay",
      anahtarlar: Array.from({ length: 12 }, (_, i) => monthKeyOf(factoryMonthStart(now, i - 11))),
    };
  }

  const n = DAY_COUNT[donem];
  const firstKey = shiftDayKey(today, -(n - 1));
  return {
    donem,
    aralik: { from: factoryDayStartOfKey(firstKey), to: now },
    oncekiAralik: {
      from: factoryDayStartOfKey(shiftDayKey(firstKey, -n)),
      to: new Date(factoryDayStartOfKey(shiftDayKey(today, -n)).getTime() + elapsedToday),
    },
    kova: "gun",
    anahtarlar: Array.from({ length: n }, (_, i) => shiftDayKey(firstKey, i)),
  };
}

/** Kova anahtarının SQL ifadesi (metin) — `anahtarlar` biçimiyle birebir. */
export function bucketKeySql(kova: PanoKova, columnExpr: string): Prisma.Sql {
  if (kova === "saat") return Prisma.sql`lpad(${factoryHourSql(columnExpr)}::text, 2, '0')`;
  if (kova === "gun") return Prisma.sql`to_char(${factoryDaySql(columnExpr)}, 'YYYY-MM-DD')`;
  return Prisma.sql`to_char(${factoryMonthSql(columnExpr)}, 'YYYY-MM')`;
}

/** Önceki döneme göre % değişim; önceki 0 (ya da yok) → null. Bir ondalık. */
export function changePct(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) * 1000) / previous) / 10;
}
