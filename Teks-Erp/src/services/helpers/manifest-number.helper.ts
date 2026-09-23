// =============================================================================
// ÇEKİ LİSTESİ NO — tek üreteç + basım kaydı (numara serisi `manifest`, ön ek CL)
// =============================================================================
// İki kaynak aynı seriden numara alır: iş emri dökümü (WORK_ORDER) ve Paketleme / Çuvallar →
// "Çeki Listesi" kâğıdı (SACK_SELECTION). Sayaç sorgusu ve çakışma atlaması TEK yerde.
// =============================================================================
import { createHash } from "crypto";
import { ManifestSourceKind, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { nextSeriesNo } from "../number-series.service";
import { p2002TargetsCode, withBarcodeRetry } from "../../utils/barcode-retry";
import { AuditService } from "../audit.service";

/** Sıradaki CL numarası (biçim veriden; kapsam + çakışma atlaması `nextSeriesNo`da). */
export function nextManifestNo(now: Date): Promise<string> {
  return nextSeriesNo(
    "manifest",
    async (prefix) =>
      prisma.manifest
        .findMany({
          where: { manifestNo: { gte: prefix, startsWith: prefix } },
          select: { manifestNo: true, createdAt: true },
        })
        .then((rows) => rows.map((r) => ({ code: r.manifestNo, createdAt: r.createdAt }))),
    now,
  );
}

/**
 * Basılan içeriğin anahtarı. Aynı çuval kümesi + aynı içerik → aynı anahtar (seçim sırası önemsiz).
 * Görünüm seçenekleri (not/iz basılsın mı) anahtara GİRMEZ — onlar aynı kaydın farklı çizimidir.
 */
export function pickListContentKey(rows: ReadonlyArray<{ id: string }>): string {
  const sirali = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(sirali)).digest("hex");
}

export interface PickListPrint {
  id: string;
  manifestNo: string;
  printedAt: Date;
  snapshot: unknown;
  /** true: aynı içerik daha önce basılmış — AYNI numara ve AYNI anlık görüntü döndü. */
  reused: boolean;
}

const PRINT_SELECT = { id: true, manifestNo: true, printedAt: true, snapshot: true } as const;

/**
 * Çeki listesi basım kaydı: ilk basımda CL doğar ve basılan içerik donar; aynı içerik yeniden
 * basılınca aynı satır döner. Farklı içerik yeni CL alır, eski liste tarihte kalır (iptal edilmez —
 * kâğıt sahada zaten var). Yarış: içerik/token tekilliği P2002 verirse kazananın satırı okunur.
 */
export async function recordSackPickList(
  rows: ReadonlyArray<{ id: string }>,
  userId: string | undefined,
  clientToken: string,
): Promise<PickListPrint> {
  const byToken = await prisma.manifest.findUnique({ where: { clientToken }, select: PRINT_SELECT });
  if (byToken) return { ...byToken, reused: true };

  const contentKey = pickListContentKey(rows);
  const existing = await prisma.manifest.findUnique({ where: { contentKey }, select: PRINT_SELECT });
  if (existing) return { ...existing, reused: true };

  try {
    const created = await withBarcodeRetry(
      async () =>
        prisma.manifest.create({
          data: {
            manifestNo: await nextManifestNo(new Date()),
            sourceKind: ManifestSourceKind.SACK_SELECTION,
            contentKey,
            clientToken,
            printedById: userId ?? null,
            snapshot: rows as unknown as Prisma.InputJsonValue,
          },
          select: PRINT_SELECT,
        }),
      undefined,
      // Yalnız numara çakışması yeniden denenir; içerik/token tekilliği yarışın kazananını gösterir.
      (err) => p2002TargetsCode(err, "manifestNo"),
      "Çeki listesi numarası",
    );
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "MANIFEST",
      recordId: created.id,
      newData: { packingListNo: created.manifestNo, sourceKind: ManifestSourceKind.SACK_SELECTION, sackCount: rows.length },
    });
    return { ...created, reused: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner =
        (await prisma.manifest.findUnique({ where: { clientToken }, select: PRINT_SELECT })) ??
        (await prisma.manifest.findUnique({ where: { contentKey }, select: PRINT_SELECT }));
      if (winner) return { ...winner, reused: true };
    }
    throw e;
  }
}
