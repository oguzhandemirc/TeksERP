// K10 — fabrikanın yoklamada bildirdiği AÇIK modül adları (yapılandırma; iş verisi değil). Alan yoksa (eski fabrika) satır
// DEĞİŞMEZ: önceki bildirim kalır, hiç bildirilmediyse null ("bilinmiyor"). Bildirilen boş liste "hiçbiri açık değil"dir.
import type { Prisma, PrismaClient } from "@prisma/client";

export async function recordOpenModules(
  db: PrismaClient,
  g: { installationDbId: string; modules: readonly string[] | undefined; nowMs: number },
): Promise<void> {
  if (g.modules === undefined) return;
  const data: Prisma.KurulumUncheckedUpdateInput = { acikModuller: [...g.modules].sort(), acikModullerZamani: new Date(g.nowMs) };
  await db.kurulum.update({ where: { id: g.installationDbId }, data });
}
