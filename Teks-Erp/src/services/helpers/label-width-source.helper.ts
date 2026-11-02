// =============================================================================
// ETİKETTEKİ EN KAYNAĞI — müşteri ayarı (Gülkesim S5, fabrika cevabı 7)
// =============================================================================
// NULL (bugünkü) ve MEASURED: topun güncel eni (`Roll.width`; ölçüldüyse ölçülen).
// INCOMING: gelen en — topun ya da atalarının İLK aktif en ölçüm izindeki
// `widthBefore`; hiç ölçülmemişse güncel en zaten gelen endir. Ayar müşteri
// kartındadır; müşteri = etiketin müşterisi (Kime?), yoksa malın sahibi.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { readWidthTrace, WIDTH_TRACE_OPERATION_TYPES } from "./measured-width.helper";
import { ACTIVE_OPERATION } from "./roll-operation.helper";

export type LabelWidthSource = "INCOMING" | "MEASURED";
export const LABEL_WIDTH_SOURCES: readonly LabelWidthSource[] = ["INCOMING", "MEASURED"];

/** Ham kolon → bilinen değer; tanınmayan/NULL → null (bugünkü davranış). */
export function readLabelWidthSource(raw: unknown): LabelWidthSource | null {
  return typeof raw === "string" && (LABEL_WIDTH_SOURCES as readonly string[]).includes(raw)
    ? (raw as LabelWidthSource)
    : null;
}

/** Ata zinciri tavanı — bölünmüş topun kökü birkaç kuşak yukarıdadır; döngü sigortası. */
const MAX_LINEAGE = 12;

type Client = Pick<typeof prisma, "roll" | "rollOperation">;

/** Topun gelen eni: kendisi + atalarının en eski aktif en izi `widthBefore`; yoksa null. */
export async function findIncomingWidthCm(rollId: string, client: Client = prisma): Promise<number | null> {
  const ids: string[] = [];
  let cur: string | null = rollId;
  while (cur && ids.length < MAX_LINEAGE && !ids.includes(cur)) {
    ids.push(cur);
    const r: { parentRollId: string | null } | null = await client.roll.findUnique({
      where: { id: cur },
      select: { parentRollId: true },
    });
    cur = r?.parentRollId ?? null;
  }
  const ops = await client.rollOperation.findMany({
    where: { rollId: { in: ids }, ...ACTIVE_OPERATION, operationType: { in: WIDTH_TRACE_OPERATION_TYPES } },
    select: { metadata: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const o of ops) {
    const t = readWidthTrace(o.metadata as Prisma.JsonValue);
    if (t?.widthBefore != null) return t.widthBefore;
  }
  return null;
}

/** Etiket eni: ayar INCOMING değilse güncel en (bugünkü); INCOMING'de gelen en ?? güncel en. */
export async function resolveLabelWidthCm(args: {
  rollId: string;
  currentWidthCm: number | null;
  source: LabelWidthSource | null;
  client?: Client;
}): Promise<number | null> {
  if (args.source !== "INCOMING") return args.currentWidthCm;
  return (await findIncomingWidthCm(args.rollId, args.client)) ?? args.currentWidthCm;
}
