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
export async function generateRollBarcodeTx(
  db: Prisma.TransactionClient,
  type: RollBarcodeType,
  date: Date = new Date(),
): Promise<string> {
  const [barcode] = await reserveRollBarcodesTx(db, type, 1, date);
  return barcode!;
}

/**
 * N barkodu **TEK ifadede** rezerve eder (`n = n + :count RETURNING n` → aralık
 * `[n-count+1, n]`). Döngüde `generateRollBarcodeTx` çağırmanın yerine geçer.
 *
 * ⚠️ **BU FONKSİYON TX DIŞINDA, tx AÇILMADAN ÖNCE ÇAĞRILMAK İÇİNDİR.** Sayaç
 * satırının kilidi, artışı yapan transaction COMMIT edene kadar tutulur; çağrı
 * uzun bir tx'in İÇİNDEYSE kilit o tx'in geri kalanı boyunca (finalize'da 225
 * satır + 8 yazma + 3 tx-helper) tutulur ve **sistemdeki her top girişi** o
 * satırda kuyruğa girer. Ölçüldü (2026-08-10 denetimi, F-CORE-VER-001):
 *
 *   sayaç tx İÇİNDE          → paralel istek **1345 ms** bekliyor
 *   sayaç tx AÇILMADAN ÖNCE  → **39 ms**  (34 kat), havuz 30/30 sağlıklı
 *
 * ⚠️ **HAVUZ CLIENT'INI TX AÇIKKEN KULLANMA.** Rezervasyonu `prisma` ile ama
 * `$transaction` callback'inin İÇİNDE çağırmak kilidi kısaltır (2 ms) ama
 * **ikinci bir bağlantı** ister ve havuz (max 30) tükenir: 30 eş zamanlı
 * işlemin **yalnız 3'ü** tamamlandı, kalanı `timeout exceeded when trying to
 * connect` aldı (ölçüldü). Kabul kriteri bu yüzden İKİ koşulludur:
 * **T1 < 100 ms VE T2 = 30/30**. Yalnız kilit süresine bakan bir "düzeltme"
 * üretimi durdurur.
 *
 * **Boşluk (gap) bilinçlidir:** tx sonradan geri sararsa rezerve edilen numaralar
 * kullanılmaz. Barkod bir KİMLİKTİR, sayaç değil — boşluk zararsızdır (helper'ın
 * kendi sözleşmesi bunu zaten söylüyordu; `tambur.service.ts:1990` ve `:2578`
 * 2026-07'den beri aynı şeyi yapıyor). Kapasite 9.999/gün/tip, boşluk payı bol.
 */
export async function reserveRollBarcodesTx(
  db: Prisma.TransactionClient,
  type: RollBarcodeType,
  count: number,
  date: Date = new Date(),
): Promise<string[]> {
  if (count <= 0) return [];
  const day = ddmmyy(date);
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    INSERT INTO "roll_barcode_counters" ("day", "type", "n")
    VALUES (${day}, ${type}, ${count})
    ON CONFLICT ("day", "type") DO UPDATE SET "n" = "roll_barcode_counters"."n" + ${count}
    RETURNING "n"
  `;
  const last = Number(rows[0]?.n ?? 0);
  const first = last - count + 1;
  if (first < 1 || last > MAX_ROLL_SEQ) {
    throw AppError.conflict(
      `Bu gün için ${type} top barkod sırası doldu (${MAX_ROLL_SEQ}). Yarın 0001'den başlar.`,
    );
  }
  return Array.from({ length: count }, (_, i) => `T${day}${type}${String(first + i).padStart(4, "0")}`);
}

/**
 * Karışık tipli bir dizi için barkod rezerve eder ve **verilen SIRAYI korur**.
 * `types[i]`'nin barkodu dönen dizinin `i`. elemanıdır.
 *
 * ⚠️ **SIRA KORUMASI LOAD-BEARING.** Çağıran (Tambur finalize) segmentleri
 * operatörün makinede kestiği sırayla gezer ve barkodu o sırayla basar; dizi
 * tip bazında gruplanıp düz döndürülseydi `H`'ler ve `F`'ler yer değiştirir,
 * yani **fiziksel toplara yanlış barkod etiketi** basılırdı — hata yok, log yok.
 *
 * Tip başına TEK ifade koşar (en fazla iki), gereksiz sayaç satırına dokunmaz.
 */
export async function reserveRollBarcodesInOrderTx(
  db: Prisma.TransactionClient,
  types: RollBarcodeType[],
  date: Date = new Date(),
): Promise<string[]> {
  const out = new Array<string>(types.length);
  for (const type of ["H", "F"] as const) {
    const slots: number[] = [];
    types.forEach((t, i) => {
      if (t === type) slots.push(i);
    });
    if (slots.length === 0) continue;
    const codes = await reserveRollBarcodesTx(db, type, slots.length, date);
    slots.forEach((slot, i) => {
      out[slot] = codes[i]!;
    });
  }
  return out;
}
