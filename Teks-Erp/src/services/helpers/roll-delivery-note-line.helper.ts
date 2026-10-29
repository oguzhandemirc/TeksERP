// =============================================================================
// TOP → KÖK TOP → GELEN BELGE SATIRI — tek çözücü (hizmet ekseni E3; H9 müşteri top no da buradan okur)
// =============================================================================
// Gelen belge onayında doğan top `CustomerDeliveryNoteLine.rollId @unique` ile satıra bağlıdır. Tambur'da bölünen
// çocuk topun kendi satırı yoktur; ata zinciri `Roll.parentRollId` üzerinden yukarı yürünür ve satırı olan EN YAKIN
// ata (kendisi dahil) kazanır. Toplu çağrı: seviye başına TEK sorgu (N top × derinlik değil), derinlik tavanlı.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { effectiveProcessText } from "../../lib/gelen-belge/gramaj-oneri";

type Db = Pick<Prisma.TransactionClient, "roll" | "customerDeliveryNoteLine">;

/** Ata zinciri tavanı — gerçek bölünme derinliği birkaç kattır; döngüsel veri sonsuz yürümesin. */
const MAX_ANCESTOR_DEPTH = 32;

export interface RollDeliveryNoteLine {
  /** Satırın bağlı olduğu top (kendisi ya da atası). */
  sourceRollId: string;
  lineId: string;
  noteId: string;
  noteNo: string;
  /** Müşterinin belgesindeki kumaş adı / rengi / top numarası (OCR ya da elle; ham metin). */
  itemText: string | null;
  colorText: string | null;
  senderRollNo: string | null;
  /** Satırın ham işlem metni; satırda yoksa belge başlığınınki (H9 kuralı, `effectiveProcessText`) — H9b İE gramaj önerisi. */
  processText: string | null;
  /** Belgenin onaylı gönderen carisi (PROCESS sözlüğünün gönderene özel satırı için). */
  senderCustomerId: string | null;
}

/** rollId → en yakın atanın gelen belge satırı. Satırı olmayan top haritada YOK. */
export async function resolveDeliveryNoteLinesForRolls(rollIds: readonly string[], db: Db = prisma): Promise<Map<string, RollDeliveryNoteLine>> {
  const out = new Map<string, RollDeliveryNoteLine>();
  // pending: hâlâ çözülmeyen asıl top → şu an bakılan ata
  let pending = new Map<string, string>([...new Set(rollIds)].map((id) => [id, id]));
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && pending.size > 0; depth++) {
    const probeIds = [...new Set(pending.values())];
    const lines = await db.customerDeliveryNoteLine.findMany({
      where: { rollId: { in: probeIds } },
      select: { id: true, rollId: true, noteId: true, itemText: true, colorText: true, senderRollNo: true, processText: true, note: { select: { noteNo: true, processText: true, senderCustomerId: true } } },
    });
    const byRoll = new Map(lines.map((l) => [l.rollId!, l]));
    const unresolved: Array<[string, string]> = [];
    for (const [origin, probe] of pending) {
      const l = byRoll.get(probe);
      if (l) out.set(origin, { sourceRollId: probe, lineId: l.id, noteId: l.noteId, noteNo: l.note.noteNo, itemText: l.itemText, colorText: l.colorText, senderRollNo: l.senderRollNo, processText: effectiveProcessText(l.processText, l.note.processText), senderCustomerId: l.note.senderCustomerId });
      else unresolved.push([origin, probe]);
    }
    if (unresolved.length === 0) break;
    const parents = await db.roll.findMany({ where: { id: { in: [...new Set(unresolved.map(([, p]) => p))] } }, select: { id: true, parentRollId: true } });
    const parentOf = new Map(parents.map((r) => [r.id, r.parentRollId]));
    const next = new Map<string, string>();
    for (const [origin, probe] of unresolved) {
      const parent = parentOf.get(probe);
      if (parent) next.set(origin, parent);
    }
    pending = next;
  }
  return out;
}
