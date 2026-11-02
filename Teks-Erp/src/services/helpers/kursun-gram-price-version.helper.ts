// =============================================================================
// KURŞUN GRAM FİYATI SÜRÜMLERİ — tek yazıcı + geçmiş okuması (K14, kullanıcı kararı 2026-11-02)
// =============================================================================
// Kolon (`Station.kursunGramPrice` · `CariAccount.kursunGramPrice`) "şu an ne"dir; sürüm satırı "o gün
// neydi"dir ve ASLA güncellenmez/silinmez (bekçi `test_kursun_gram_gecmisi` §6). Kolonu yazan HER yol aynı
// tx'te `recordKursunGramPriceVersionTx` çağırır: değer son sürümden farklıysa yeni satır (validFrom = şimdi),
// aynıysa yazım yok. Sıra: önce kolon UPDATE (satır kilidi) → sonra son sürüm okuması; eşzamanlı iki yazar
// sahibin satırında sıralanır, ikincisi birincinin sürümünü görür (READ COMMITTED).
// Finans yardımcısı İÇE ALINMAZ: istasyon router'ı ön muhasebe rejim kapısına bağlanmasın (input helper emsali).
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";

type Db = Prisma.TransactionClient | typeof prisma;

export type KursunGramPriceOwner = { stationId: string } | { cariAccountId: string };

const ownerWhere = (o: KursunGramPriceOwner): Prisma.KursunGramPriceVersionWhereInput =>
  "stationId" in o ? { stationId: o.stationId } : { cariAccountId: o.cariAccountId };

/** Sürüm sırası — belirlenimli (eşitlik bozucu createdAt, id): "en son" okuyucusu tek. */
export const KURSUN_GRAM_VERSION_ORDER: Prisma.KursunGramPriceVersionOrderByWithRelationInput[] = [
  { validFrom: "desc" }, { createdAt: "desc" }, { id: "desc" },
];

function sameValue(a: { price: Prisma.Decimal | null; currency: Currency | null }, price: string | null, currency: Currency | null): boolean {
  if (a.price === null || price === null) return a.price === null && price === null;
  return a.price.equals(new Prisma.Decimal(price)) && a.currency === currency;
}

/**
 * Kolon yazıldıktan SONRA, aynı tx'te çağrılır. Değer son sürümle aynıysa (ya da sürüm yok + değer boş) yazmaz.
 * Döner: sürüm yazıldı mı.
 */
export async function recordKursunGramPriceVersionTx(
  tx: Prisma.TransactionClient,
  owner: KursunGramPriceOwner,
  value: { price: string | null; currency: Currency | null },
  userId?: string | null,
): Promise<boolean> {
  const last = await tx.kursunGramPriceVersion.findFirst({ where: ownerWhere(owner), orderBy: KURSUN_GRAM_VERSION_ORDER, select: { price: true, currency: true } });
  if (last ? sameValue(last, value.price, value.currency) : value.price === null) return false;
  await tx.kursunGramPriceVersion.create({
    data: {
      ...("stationId" in owner ? { stationId: owner.stationId } : { cariAccountId: owner.cariAccountId }),
      price: value.price,
      currency: value.price === null ? null : value.currency,
      validFrom: new Date(),
      createdById: userId ?? null,
    },
  });
  return true;
}

export interface KursunGramPriceHistoryItem {
  id: string;
  validFrom: string;
  /** null = fiyat kaldırıldı. */
  price: string | null;
  currency: Currency | null;
  createdById: string | null;
  /** Yazanın görünen adı (kullanıcı silinmişse null). */
  createdByName: string | null;
}

/** Fiyat geçmişi — en yeni önce (createdAt DESC, id DESC), opak cursor; bozuk cursor 400. */
export async function listKursunGramPriceHistory(
  owner: KursunGramPriceOwner,
  opt: { cursor?: string; limit?: number } = {},
  db: Db = prisma,
): Promise<{ items: KursunGramPriceHistoryItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opt.limit ?? 20, 1), 100);
  let where: Prisma.KursunGramPriceVersionWhereInput = ownerWhere(owner);
  if (opt.cursor) {
    const c = decodeCursor(opt.cursor);
    if (!c) throw AppError.badRequest("Geçersiz sayfa imleci", { code: "INVALID_CURSOR" });
    where = { AND: [where, cursorWhere(c)] };
  }
  const rows = await db.kursunGramPriceVersion.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    select: { id: true, validFrom: true, price: true, currency: true, createdById: true, createdAt: true },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const userIds = [...new Set(page.map((r) => r.createdById).filter((v): v is string => v !== null))];
  const users = userIds.length === 0 ? [] : await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } });
  const nameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));
  return {
    items: page.map((r) => ({
      id: r.id, validFrom: r.validFrom.toISOString(), price: r.price?.toString() ?? null, currency: r.currency,
      createdById: r.createdById, createdByName: r.createdById ? nameById.get(r.createdById) ?? null : null,
    })),
    nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null,
  };
}
