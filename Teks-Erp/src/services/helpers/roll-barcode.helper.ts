import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { ddmmyy } from "../../utils/code-format";

/**
 * Kısa top barkodu: `T` + `GGAAYY` + tip(`H`|`F`) + sıra(`NNNN`, 4 hane).
 * Örn `T120726H0001` (12 karakter). Ayraçsız (el tarayıcı klavye-taklidi Türkçe
 * düzende `-`'yi `*`'a çeviriyordu → salt harf-rakam her düzende sorunsuz).
 * Tarih Türkiye sırasında (GG.AA.YY). Diğer tüm belge kodlarıyla aynı kalıp
 * (PREFIX+GGAAYY+NNNN) — bkz. `utils/code-format.ts`.
 *
 * - **Tip:** `H` = ham/işlenecek top (KK1 girişi, STOCK'a giden çıktı), `F` = final
 *   (biten) kumaş — depoya (WAREHOUSE) inen çıktı. Oluşturmada sabitlenir, sonradan
 *   değişmez (topun o andaki bitmişliğinin damgası).
 * - **Sıra:** gün + tip başına `0001`→`9999` = **9.999/gün/tip**. Günlük 0001'den
 *   başlar. Sıralı olduğu için **sunucu** üretir (offline istemci üretemez —
 *   idempotency ayrı `Roll.clientToken` ile).
 */
export const ROLL_BARCODE_RE = /^T\d{6}[HF]\d{4}$/;

export type RollBarcodeType = "H" | "F";

/** Gün+tip başına toplam kapasite (0001..9999). */
export const MAX_ROLL_SEQ = 9999;

/** Gün+tip barkod prefix'i (sıra kuyruğu hariç): `T{GGAAYY}{H|F}`. */
export function rollBarcodePrefix(type: RollBarcodeType, date: Date = new Date()): string {
  return `T${ddmmyy(date)}${type}`;
}

/**
 * Aynı gün+tip için SIRADAKİ top barkodu — atomik sayaç (`roll_barcode_counters`).
 * `INSERT … ON CONFLICT (day,type) DO UPDATE n=n+1 RETURNING n`: satır kilidi eşzamanlı
 * üreticileri serileştirir → **çakışmasız** (withBarcodeRetry gerekmez). `db` hem taban
 * `prisma` hem tx client olabilir (ikisi de $queryRaw taşır); tx verilirse sayaç artışı
 * tx'e bağlıdır (rollback'te geri alınır, boşluk yok — kilit tx boyunca tutulur), taban
 * prisma verilirse anında commit (boşluk olabilir; barkod ID'dir, boşluk zararsız).
 */
export async function generateRollBarcode(
  db: Prisma.TransactionClient,
  type: RollBarcodeType,
  date: Date = new Date(),
): Promise<string> {
  const day = ddmmyy(date);
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    INSERT INTO "roll_barcode_counters" ("day", "type", "n")
    VALUES (${day}, ${type}, 1)
    ON CONFLICT ("day", "type") DO UPDATE SET "n" = "roll_barcode_counters"."n" + 1
    RETURNING "n"
  `;
  const n = Number(rows[0]?.n ?? 0);
  if (n < 1 || n > MAX_ROLL_SEQ) {
    throw AppError.conflict(
      `Bu gün için ${type} top barkod sırası doldu (${MAX_ROLL_SEQ}). Yarın 0001'den başlar.`,
    );
  }
  return `T${day}${type}${String(n).padStart(4, "0")}`;
}
