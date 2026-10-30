// =============================================================================
// KASA HAREKETLERİ KATEGORİ SÜZGECİ (D4-KUC e / H1c)
// =============================================================================
// Süzgeç değeri Masraf Özeti'nin kategori ANAHTARIDIR (`cashCategoryKey`) — ayrı
// bir eşleşme kuralı yazılsaydı özet satırındaki sayı ile süzülü liste ayrışırdı
// (ör. " Kira " ile "Kira" özette tek kova, düz eşitlikte iki ayrı liste).
// Kolon serbest metin olarak (trim'siz) saklandığı için anahtar, aynı kovaya düşen
// HAM değerlere çözülür; where tek nesnedir, liste ve toplam sayı aynı where'i görür.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { cashCategoryKey } from "./expense-summary.helper";

/** Anahtarın metin kısmı; tanınmayan biçim → null (çağıran 400 verir). */
export function parseCashCategoryKey(key: string): string | null {
  const prefix = cashCategoryKey(null).key;
  if (!key.startsWith(prefix)) return null;
  const text = key.slice(prefix.length);
  return cashCategoryKey(text).key === key ? text : null;
}

/** Anahtar → Prisma where parçası. FAIL-CLOSED: tanınmayan anahtar 400 (sessizce süzmemek yanlış listedir). */
export async function cashCategoryWhere(key: string): Promise<Prisma.CashTransactionWhereInput> {
  const text = parseCashCategoryKey(key);
  if (text === null) {
    throw AppError.badRequest("Kategori süzgeci tanınmadı — Masraf Özeti'ndeki kategori anahtarı beklenir.", {
      code: "CASH_CATEGORY_FILTER_INVALID",
    });
  }
  const rows = await prisma.$queryRaw<Array<{ category: string }>>(Prisma.sql`
    SELECT DISTINCT ct.category FROM cash_transactions ct
     WHERE ct.category IS NOT NULL AND btrim(ct.category) = ${text}
  `);
  const raws = rows.map((r) => r.category);
  return text === "" ? { OR: [{ category: null }, { category: { in: raws } }] } : { category: { in: raws } };
}

/** Panel süzgecinin seçenekleri: kasa hareketlerinde geçen kategoriler (anahtar + etiket), etikete göre. */
export async function listCashCategoryOptions(): Promise<Array<{ key: string; label: string }>> {
  const rows = await prisma.$queryRaw<Array<{ category: string | null }>>(Prisma.sql`
    SELECT DISTINCT ct.category FROM cash_transactions ct
  `);
  const byKey = new Map<string, { key: string; label: string }>();
  for (const r of rows) {
    const c = cashCategoryKey(r.category);
    byKey.set(c.key, c);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/**
 * Sorgu parametresi → tek anahtar. CSV'ye BÖLÜNMEZ: kategori metni virgül içerebilir
 * ("Yemek, içecek"); çoklu değer (tekrarlı parametre) tanınmaz → 400 (sessiz düşme yok).
 */
export function readCategoryParam(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    throw AppError.badRequest("Kategori süzgeci tek değer alır.", { code: "CASH_CATEGORY_FILTER_INVALID" });
  }
  return value;
}
