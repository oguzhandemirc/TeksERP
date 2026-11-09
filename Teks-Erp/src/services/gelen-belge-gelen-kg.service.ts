// =============================================================================
// GELEN BELGE — belgenin GELEN KG'si (belge tanıt 3 aşama, 2026-11-09; salt okunur, yazmaz)
// =============================================================================
// Okuma özeti ve iş emri formu kaydı AYNI türetmeden okur: korunmuş şablon alanı (`toplamKg`, metre hücresi koruması) →
// belge beyanı kg'si → Σ belge satırı kg (hepsi doluysa). Seçim tek saf fonksiyonda (`pickIncomingKg`).
// =============================================================================
import { DeliveryNoteLineStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { declaredKgOf, pickIncomingKg, type IncomingKgResult } from "../lib/gelen-belge/gelen-kg";
import { guardKgFields } from "../lib/gelen-belge/kg-koruma";
import { isSummaryLine } from "./gelen-belge-kontrol.service";
import { readFirstRegion, type TrustMode } from "./gelen-belge-parti-metre.service";

export interface NoteIncomingKg extends IncomingKgResult {
  /** Şablon kg'yi metre hücresinden okuyor → kg alanı yok sayıldı (okuma uyarısı `KG_FROM_METER_CELL`). */
  kgFromMeterCell: boolean;
}

/** Belgenin önerilen gelen kg'si. BLIND (tanıtılmamış + SORMA): şablon alanı tahmini kullanılmaz; beyan/satır kalır. */
export async function noteIncomingKg(noteId: string, trust: TrustMode = "NORMAL", manualKg?: number | null): Promise<NoteIncomingKg> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { id: true, totalsDeclared: true, lines: { where: { status: { not: DeliveryNoteLineStatus.SKIPPED } }, select: { id: true, blockNo: true, weightKg: true } } },
  });
  if (!note) return { kg: null, source: null, kgFromMeterCell: false };
  const guarded = guardKgFields(await readFirstRegion(prisma, noteId));
  const docLines = note.lines.filter((l) => !isSummaryLine(note.id, l));
  const r = pickIncomingKg({
    manualKg,
    fieldKg: trust === "BLIND" ? null : guarded.fields.toplamKg,
    declaredKg: declaredKgOf(note.totalsDeclared),
    lineKgs: docLines.map((l) => l.weightKg),
  });
  return { ...r, kgFromMeterCell: guarded.dropped.length > 0 };
}
