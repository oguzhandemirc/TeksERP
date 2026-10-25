// =============================================================================
// BİLDİRİM EŞİKLERİ — katalog `paramSemasi` varsayılanı ⊕ fabrika varsayılanı (`notification_factory_defaults.params`)
// =============================================================================
// Koşul kaynakları eşiği SENKRON okur (`deps.params`); fabrika değeri DB'dedir. Köprü süreç içi
// anlık görüntüdür: koşul turu değerlendirmeden ÖNCE tazeler (`refreshNotificationParams`), yönetici
// PUT'u yazdıktan sonra tazeler. Görüntü bayatsa yalnız bir tur eski eşikle çalışır (doğruluk DB'de).
// Bozuk/şemaya uymayan satır yok sayılır → katalog varsayılanı (fail-closed: eşik uydurulmaz).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { getNotificationEntry, NOTIFICATION_KINDS, type NotificationKind } from "../../constants/notification-catalog";
import { notificationFactoryParamsSchema } from "../../constants/notification-preference";

let snapshot = new Map<string, Record<string, unknown>>();

/** Katalog şemasıyla doğrulanmış tam eşik kümesi (eksik alan varsayılanla dolar). */
export function parseKindParams(kind: NotificationKind, degerler: unknown): Record<string, unknown> {
  const schema = getNotificationEntry(kind).paramSemasi;
  return schema ? (schema.parse(degerler ?? {}) as Record<string, unknown>) : {};
}

/** Koşul kaynaklarının okuyucusu: fabrika görüntüsü varsa o, yoksa katalog varsayılanı. */
export function effectiveNotificationParams(kind: NotificationKind): Record<string, unknown> {
  return snapshot.get(kind) ?? parseKindParams(kind, {});
}

/** Fabrika eşiklerini DB'den okuyup görüntüyü yeniler (tek sorgu). */
export async function refreshNotificationParams(db: Pick<Prisma.TransactionClient, "notificationFactoryDefault">): Promise<void> {
  const rows = await db.notificationFactoryDefault.findMany({
    where: { kind: { in: NOTIFICATION_KINDS } },
    select: { kind: true, params: true },
  });
  const next = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (r.params === null) continue;
    const env = notificationFactoryParamsSchema.safeParse(r.params);
    if (!env.success) continue;
    try {
      next.set(r.kind, parseKindParams(r.kind as NotificationKind, env.data.degerler));
    } catch {
      // Katalog şeması daralmış (sürüm düşüşü): satır yok sayılır, varsayılan geçerli.
    }
  }
  snapshot = next;
}
