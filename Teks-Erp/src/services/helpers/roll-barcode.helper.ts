import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * Kısa top barkodu: `TEKS` + `YYMMDD` + tip(`H`|`F`) + sıra(`[A-Z][0-9]{3}`).
 * Örn `TEKS260709HA001` (15 karakter). Ayraçsız (el tarayıcı klavye-taklidi Türkçe
 * düzende `-`'yi `*`'a çeviriyordu → salt harf-rakam her düzende sorunsuz).
 *
 * - **Tip:** `H` = ham/işlenecek top (KK1 girişi, STOCK'a giden çıktı), `F` = final
 *   (biten) kumaş — depoya (WAREHOUSE) inen çıktı. Oluşturmada sabitlenir, sonradan
 *   değişmez (topun o andaki bitmişliğinin damgası).
 * - **Sıra:** gün + tip başına `A001`→`A999`→`B001`→…→`Z999` = **25.974/gün/tip**.
 *   Günlük A001'den başlar. Sıralı olduğu için **sunucu** üretir (offline istemci
 *   üretemez — idempotency ayrı `Roll.clientToken` ile).
 *
 * Eski 20-karakterlik format (`TEKS`+`YYYYMMDD`+8hex) taşıyan toplar okunmaya devam
 * eder — prefix `TEKS26…` (yy=26) eski `TEKS2026…` (yyyy) ile çakışmaz.
 */
export const ROLL_BARCODE_RE = /^TEKS\d{6}[HF][A-Z]\d{3}$/;

export type RollBarcodeType = "H" | "F";

/** Sıra harfi başına sayısal kapasite (A001..A999). */
const SEQ_PER_LETTER = 999;
/** Gün+tip başına toplam kapasite (A001..Z999). */
export const MAX_ROLL_SEQ = 26 * SEQ_PER_LETTER; // 25974

/** 1-tabanlı sıra numarası → `[A-Z][0-9]{3}` kuyruğu. n=1→A001, n=1000→B001. */
export function encodeRollSeq(n: number): string {
  const idx = Math.floor((n - 1) / SEQ_PER_LETTER);
  const num = ((n - 1) % SEQ_PER_LETTER) + 1;
  return String.fromCharCode(65 + idx) + String(num).padStart(3, "0");
}

/** `[A-Z][0-9]{3}` kuyruğu → 1-tabanlı sıra numarası; geçersizse null. */
export function decodeRollSeq(tail: string): number | null {
  const m = /^([A-Z])(\d{3})$/.exec(tail);
  if (!m) return null;
  const num = parseInt(m[2]!, 10);
  if (num < 1 || num > SEQ_PER_LETTER) return null;
  return (m[1]!.charCodeAt(0) - 65) * SEQ_PER_LETTER + num;
}

function ymd(date: Date): string {
  return (
    String(date.getFullYear()).slice(2) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0")
  );
}

/** Gün+tip barkod prefix'i (sıra kuyruğu hariç): `TEKS{YYMMDD}{H|F}`. */
export function rollBarcodePrefix(type: RollBarcodeType, date: Date = new Date()): string {
  return `TEKS${ymd(date)}${type}`;
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
  const day = ymd(date);
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    INSERT INTO "roll_barcode_counters" ("day", "type", "n")
    VALUES (${day}, ${type}, 1)
    ON CONFLICT ("day", "type") DO UPDATE SET "n" = "roll_barcode_counters"."n" + 1
    RETURNING "n"
  `;
  const n = Number(rows[0]?.n ?? 0);
  if (n < 1 || n > MAX_ROLL_SEQ) {
    throw AppError.conflict(
      `Bu gün için ${type} top barkod sırası doldu (${MAX_ROLL_SEQ}). Yarın A001'den başlar.`,
    );
  }
  return `TEKS${day}${type}${encodeRollSeq(n)}`;
}
