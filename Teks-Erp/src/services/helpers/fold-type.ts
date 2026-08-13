// =============================================================================
// TeksERP - Kat Tipi (foldType) tek kaynak / kanonikleştirme (D-13)
// =============================================================================
// 2026-08-10: kat artık KATALOĞA bağlı. İzin verilen değerler kodda değil,
// `FabricProperty(code="KAT", valueType=CHOICE)` altındaki `FabricPropertyValue`
// satırlarındadır — fabrika "6-KAT"ı panelden ekler, sürüm gerekmez.
//
// İKİ AYRI SORU, İKİ AYRI FONKSİYON — karıştırma:
//   1. BİÇİM  (`normalizeFoldType`, SENKRON): "4 kat" / "4KAT" / "4_kat" → "4-KAT".
//      Saf metin işi; DB'ye gitmez, Zod `.transform`ında koşar.
//   2. GEÇERLİLİK (`resolveFoldTypeForWrite`, ASENKRON): biçimlenmiş değer
//      katalogda var mı? Varsa katalogun KANONİK kodu döner ("tüp" → "TÜP").
//      Servis katmanında, yazma yolunda çağrılır.
//
// ⚠️ Karşılaştırma `toUpperCase()` ile yapılır, `toLocaleUpperCase("tr")` ile
// DEĞİL: Türkçe upper "i"yi "İ" yapar ve kod eşleşmesini sessizce bozar (aynı
// tuzak 2026-08-02'de etiket `showIf` koşulunda yaşandı). Kod KİMLİKTİR,
// görüntü metni değil.
//
// ⚠️ KATALOG BOŞSA FAIL-OPEN. Göç script'i (`seed_fold_catalog_and_modes.ts`)
// koşmamış bir kurulumda her değeri reddetmek, iş emri açmayı ve Tambur
// finalize'ı tamamen durdururdu. Katalog yoksa eski davranış sürer: biçim
// normalleştirilir, değer olduğu gibi kabul edilir.
//
// ⚠️ Doğrulama AKTİF/PASİF ayrımı YAPMAZ. Pasif değer "yeni kayıtta
// seçilemesin" demektir (seçici listesi `isActive` süzer); yazma yolunda
// reddetmek, katalogdan kaldırılan bir katı taşıyan ESKİ iş emrinin
// düzenlenemez hale gelmesi demekti.
//
// ⚠️ Katalog CACHE'LENMEZ. 3-4 satırlık indeksli bir sorgu; cache, panelden
// eklenen değerin sunucu yeniden başlayana kadar görünmemesi demekti — yani
// özelliğin var oluş sebebini ortadan kaldırırdı.
// =============================================================================

import { z } from "zod";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

/** Kat değerlerini taşıyan katalog satırının kodu. */
export const FOLD_PROPERTY_CODE = "KAT";

/**
 * Kat ailesini kanonikleştirir; tanınmayan değer TRİM'lenip DEĞİŞMEDEN geçer.
 * "4-kat" / "4 Kat" / "4KAT" / "4_kat" → "4-KAT". Boş/whitespace → null.
 * "TÜP" / özel → olduğu gibi (trim) — reddedilmez.
 *
 * ⚠️ Rakam sınıfı `\d+` — eskiden `[24]` idi ve katalog 6-KAT'ı öğrense bile
 * "6 kat" yazımı "6-KAT"a normalleşmez, katalog eşleşmesi kaçar, değer ham
 * geçerdi. Kat sayısını burada sabitleme; sınırı katalog koyar.
 */
export function normalizeFoldType(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const m = t.toUpperCase().replace(/[\s_]+/g, "-").match(/^(\d+)-?KAT$/);
  return m ? `${m[1]}-KAT` : t;
}

/**
 * Zod alan şeması (yazma uçları) — YALNIZ BİÇİM. string → normalize; boş → null;
 * absent (undefined) KORUNUR (update no-op); null = temizle.
 *
 * Geçerlilik burada ölçülemez (Zod senkron, katalog DB'de) — servis katmanında
 * `resolveFoldTypeForWrite` ile ölçülür.
 */
export const foldTypeSchema = z
  .string()
  .max(64)
  .transform((v) => normalizeFoldType(v))
  .nullable()
  .optional();

export interface FoldTypeValue {
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

/** Prisma client ya da transaction — katalog okuması ikisinde de koşabilir. */
type Reader = Pick<typeof prisma, "fabricProperty">;

/**
 * Kat kataloğunu okur. `configured=false` → katalog satırı hiç yok (fail-open).
 * Değerler `isActive` ayrımı yapılmadan döner; süzmek çağıranın işi.
 */
export async function loadFoldTypeCatalog(
  client: Reader = prisma,
): Promise<{ configured: boolean; values: FoldTypeValue[] }> {
  const prop = await client.fabricProperty.findUnique({
    where: { code: FOLD_PROPERTY_CODE },
    select: {
      isActive: true,
      values: {
        select: { code: true, name: true, isActive: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      },
    },
  });
  if (!prop || !prop.isActive || prop.values.length === 0) {
    return { configured: false, values: [] };
  }
  return { configured: true, values: prop.values };
}

/**
 * Yazma yolu doğrulaması. Girdi zaten `foldTypeSchema`'dan geçmiş olabilir ama
 * geçmemiş de olabilir (generic CRUD) — bu yüzden biçim normalleştirmesini
 * kendisi de uygular. Katalogda eşleşen değerin KANONİK kodunu döner.
 *
 * `undefined` → `undefined` (dokunma), `null`/boş → `null` (temizle).
 */
export async function resolveFoldTypeForWrite(
  value: string | null | undefined,
  client: Reader = prisma,
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = normalizeFoldType(value);
  if (normalized === null) return null;

  const { configured, values } = await loadFoldTypeCatalog(client);
  if (!configured) return normalized; // fail-open (dosya başlığı)

  const wanted = normalized.toUpperCase();
  const hit = values.find((v) => v.code.toUpperCase() === wanted);
  if (hit) return hit.code;

  const offered = values
    .filter((v) => v.isActive)
    .map((v) => v.code)
    .join(", ");
  throw AppError.badRequest(
    `'${normalized}' geçerli bir kat değeri değil. Tanımlı değerler: ${offered || "yok"}. ` +
      `Yeni bir kat eklemek için Tanımlar → Kumaş Özellikleri → KAT ekranını kullanın.`,
  );
}

/**
 * Servis-katmanı yardımcısı (BaseController/generic CRUD yolu — Zod yok).
 * `data.foldType` varsa normalleştirir VE katalogla doğrular; yoksa dokunmaz.
 * Mutasyondan ÖNCE `await` ile çağır.
 */
export async function applyFoldTypeForWriteInPlace(
  data: Record<string, unknown>,
  client: Reader = prisma,
): Promise<void> {
  if (!("foldType" in data)) return;
  const v = data.foldType;
  if (v !== null && typeof v !== "string") return;
  data.foldType = await resolveFoldTypeForWrite(v as string | null, client);
}
