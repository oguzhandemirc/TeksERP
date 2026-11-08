// =============================================================================
// FASON TERMİNİ — `SubcontractorDispatch.expectedReturnAt` TEK ÇÖZÜCÜSÜ (F6)
// =============================================================================
// Termin PLAN kolonudur, durum değil: gecikme ondan türer (kokpit F10). Zincir: gövde (açık değer ya da açık
// `null` = termin yok) > fason firma `expectedReturnDays` > süreç türü (kategori) `expectedReturnDays` > genel ayar
// `fason.expectedReturnDays` > NULL (bugünkü davranış; eski istemci alanı göndermez, ayarsız kurulumda NULL).
// Gün sayısı FABRİKA GÜNÜYLE eklenir ve terminin o günün SON anı yazılır (`constants/time.ts`); geçmiş fabrika günü
// 400 `EXPECTED_RETURN_IN_PAST`. Gecikme/yakında hesabı da aynı dosyadan (kokpit ↔ sevk tek kaynak).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDayEndOfKey, factoryDayStart, factoryDayStartOfKey, factoryYmd } from "../../constants/time";
import { AppError } from "../../utils/app-error";
import { readFasonExpectedReturnDays } from "../system-setting.service";
import type { ExpectedReturnSource } from "../subcontractor/types";

type Db = Pick<typeof prisma, "subcontractor" | "subcontractorCategory" | "systemSetting">;

export interface ResolvedExpectedReturn {
  at: Date | null;
  source: ExpectedReturnSource;
}

/** `YYYY-MM-DD` + n takvim günü (fabrika günü anahtarı üzerinde; saat dilimi kayması yok). */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** İki fabrika günü anahtarı arasındaki gün farkı (`b − a`). */
export function dayKeyDiff(a: string, b: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Gövde değeri: gün-yalnız `YYYY-MM-DD` o fabrika gününün son anına; tam ISO an olduğu gibi. Bozuk → 400. */
export function parseExpectedReturnBody(raw: string, now: Date = new Date()): Date {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? factoryDayEndOfKey(raw) : new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw AppError.badRequest("Beklenen dönüş tarihi geçersiz", { code: "EXPECTED_RETURN_INVALID" });
  }
  if (factoryYmd(at) < factoryYmd(now)) {
    throw AppError.badRequest("Beklenen dönüş tarihi geçmiş bir gün olamaz", { code: "EXPECTED_RETURN_IN_PAST" });
  }
  return at;
}

/**
 * Sevkin terminini çözer. `body` undefined ⇒ varsayılan zinciri; `null` ⇒ termin yok (kaynak BODY);
 * string ⇒ doğrulanmış gövde değeri. `categoryId` = adımın süreç türü (dokuma sevkinde yok).
 */
export async function resolveExpectedReturn(
  input: { body: string | null | undefined; subcontractorId: string; categoryId: string | null; dispatchedAt: Date },
  db: Db = prisma,
): Promise<ResolvedExpectedReturn> {
  if (input.body === null) return { at: null, source: "BODY" };
  if (input.body !== undefined) return { at: parseExpectedReturnBody(input.body, input.dispatchedAt), source: "BODY" };
  const sub = await db.subcontractor.findUnique({ where: { id: input.subcontractorId }, select: { expectedReturnDays: true } });
  const cat = input.categoryId
    ? await db.subcontractorCategory.findUnique({ where: { id: input.categoryId }, select: { expectedReturnDays: true } })
    : null;
  const setting = await readFasonExpectedReturnDays(db);
  const picked: { days: number; source: ExpectedReturnSource } | null =
    sub?.expectedReturnDays != null ? { days: sub.expectedReturnDays, source: "SUBCONTRACTOR" }
    : cat?.expectedReturnDays != null ? { days: cat.expectedReturnDays, source: "CATEGORY" }
    : setting > 0 ? { days: setting, source: "SETTING" }
    : null;
  if (!picked) return { at: null, source: "NONE" };
  return { at: factoryDayEndOfKey(addDaysToDayKey(factoryYmd(input.dispatchedAt), picked.days)), source: picked.source };
}

/** "Yakında" penceresi: termini bugünden itibaren bu kadar fabrika günü içinde (bugün dahil) olan açık sevk. */
export const COCKPIT_DUE_SOON_DAYS = 2;

/** Fabrika günü farkı (gecikmede pozitif); termin yoksa null. */
export function overdueDaysOf(expectedReturnAt: Date | null, now: Date = new Date()): number | null {
  return expectedReturnAt ? dayKeyDiff(factoryYmd(expectedReturnAt), factoryYmd(now)) : null;
}

/** `expectedReturnStateWhere`in bellek-içi İKİZİ (özet sayaçları): aynı fabrika günü sınırları; ileri termin null. */
export function expectedReturnStateOf(expectedReturnAt: Date | null, now: Date = new Date()): "OVERDUE" | "DUE_SOON" | "NO_DUE_DATE" | null {
  const d = overdueDaysOf(expectedReturnAt, now);
  if (d === null) return "NO_DUE_DATE";
  if (d > 0) return "OVERDUE";
  return d >= -COCKPIT_DUE_SOON_DAYS ? "DUE_SOON" : null;
}

/** Kokpit durum süzgeçleri — liste, özet ve satır hesabı (`overdueDaysOf`) aynı fabrika günü sınırlarından. */
export function expectedReturnStateWhere(state: "OVERDUE" | "DUE_SOON" | "NO_DUE_DATE", now: Date = new Date()): Prisma.SubcontractorDispatchWhereInput {
  const todayStart = factoryDayStart(now);
  if (state === "NO_DUE_DATE") return { expectedReturnAt: null };
  if (state === "OVERDUE") return { expectedReturnAt: { lt: todayStart } };
  const soonEnd = factoryDayEndOfKey(addDaysToDayKey(factoryYmd(now), COCKPIT_DUE_SOON_DAYS));
  return { expectedReturnAt: { gte: factoryDayStartOfKey(factoryYmd(now)), lte: soonEnd } };
}
