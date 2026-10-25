// =============================================================================
// RAPOR ANLIK GÖRÜNTÜSÜ — "bu hâlini sakla" (R1-KAYIT; plan §4.3)
// =============================================================================
// Görüntü sunucuda koşulan sonucun kopyasıdır (istemcinin gönderdiği sonuç SAKLANMAZ — sayı her zaman
// semantik katmandan). TELEMETRİ sınıfı: silinince raporlanan hiçbir sayı değişmez (audit muaf,
// `scripts/lib/audit-muafiyeti.ts`); budama R1-ZAMAN'da. "İtibarıyla" zamanı fabrika diliminde basılır.
// `clientToken` R kipinde: ağ kopup yeniden gönderilen istek ikinci görüntü üretmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { factoryDateTimeTr } from "../constants/time";
import { tokenReplay } from "./helpers/token-replay.helper";
import { stableStringify } from "./reports/semantik/onbellek";
import type { AccessContext } from "./reports/semantik/izin";
import { loadVisible, type Actor } from "./rapor-tanimi.service";
import { runDefinition } from "./rapor-kosu.service";

const SNAPSHOT_SELECT = {
  id: true, definitionId: true, versionId: true, params: true, kind: true, createdAt: true, createdById: true,
  version: { select: { versionNo: true } },
} satisfies Prisma.ReportSnapshotSelect;
type SnapshotRow = Prisma.ReportSnapshotGetPayload<{ select: typeof SNAPSHOT_SELECT }>;

const toSummary = (s: SnapshotRow) => ({
  id: s.id, tanimId: s.definitionId, surumNo: s.version?.versionNo ?? null, parametreler: s.params, tur: s.kind,
  itibariyla: s.createdAt.toISOString(), itibariylaMetni: factoryDateTimeTr(s.createdAt),
});

export interface SnapshotInput {
  parametreler: Record<string, unknown>;
  clientToken?: string | null;
}

function snapshotReplay(definitionId: string, input: SnapshotInput, a: Actor) {
  return tokenReplay<SnapshotRow, ReturnType<typeof toSummary>>({
    find: (db, clientToken) => db.reportSnapshot.findUnique({ where: { clientToken }, select: SNAPSHOT_SELECT }),
    alive: { neverDies: "anlık görüntü iptal edilmez; budanınca token da satırla birlikte gider (ilk deneme sayılır)" },
    identity: (p) => [
      { ad: "tanimId", mevcut: p.definitionId, gelen: definitionId },
      { ad: "kullanici", mevcut: p.createdById, gelen: a.userId },
      { ad: "parametreler", mevcut: stableStringify(p.params), gelen: stableStringify(input.parametreler) },
    ],
    collision: "Bu işlem kimliği başka bir anlık görüntüye ait; yeniden kaydedin.",
    respond: toSummary,
  });
}

/** Koşar (önbellek serbest) ve sonucu saklar; koşu satırına bağlanır (`runId` SET NULL — koşu budanınca görüntü kalır). */
export async function takeSnapshot(definitionId: string, input: SnapshotInput, ctx: AccessContext, a: Actor) {
  return snapshotReplay(definitionId, input, a).run(input.clientToken, async () => {
    const result = await runDefinition(definitionId, { parametreler: input.parametreler, yenile: false }, ctx, a);
    const runId = result.bloklar.flatMap((b) => (b.durum === "tamam" ? b.sonuclar.map((r) => r.kosuId) : [])).find((k): k is string => k !== null) ?? null;
    const row = await prisma.reportSnapshot.create({
      data: {
        definitionId, versionId: result.tanim.surumId, runId, params: input.parametreler as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue, kind: "KULLANICI", clientToken: input.clientToken ?? null, createdById: a.userId,
      },
      select: SNAPSHOT_SELECT,
    });
    return toSummary(row);
  });
}

/** Kullanıcının bu rapordaki görüntüleri (yeniden eskiye, cursor'lu). */
export async function listSnapshots(definitionId: string, a: Actor, cursor: string | undefined, limit: number) {
  await loadVisible(definitionId, a);
  const rows = await prisma.reportSnapshot.findMany({
    where: { definitionId, createdById: a.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: SNAPSHOT_SELECT,
  });
  const page = rows.slice(0, limit);
  return { items: page.map(toSummary), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
}

/** Görüntüyü yalnız alan kişi açar; tanım hâlâ görünür olmalı (paylaşım geri alındıysa 404). */
export async function getSnapshot(snapshotId: string, a: Actor) {
  const row = await prisma.reportSnapshot.findFirst({ where: { id: snapshotId, createdById: a.userId }, select: { ...SNAPSHOT_SELECT, result: true } });
  if (!row) throw AppError.notFound("Anlık görüntü bulunamadı.", { code: "RAPOR_GORUNTU_YOK" });
  await loadVisible(row.definitionId, a);
  return { ...toSummary(row), sonuc: row.result };
}
