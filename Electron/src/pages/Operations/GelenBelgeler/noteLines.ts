// Gelen belge satır sınıfları (saf): belgenin kendi satırları (top) ↔ onayda doğan parti kayıtları (özet satırı).
// Özet satırı hükmü sunucudan (`summary`); eski sunucuda yalnız `ARABA` türü özet sayılır (ayrı top kipi o zaman top görünür).
import { TERIM_AD } from "@/lib/terim";
import type { DeliveryNoteLine } from "./types";

export function isSummaryRow(l: Pick<DeliveryNoteLine, "summary" | "lineKind">): boolean {
  return l.summary ?? l.lineKind === "ARABA";
}

export function splitNoteLines<T extends Pick<DeliveryNoteLine, "summary" | "lineKind">>(lines: ReadonlyArray<T>): { docLines: T[]; summaryLines: T[] } {
  const docLines: T[] = [];
  const summaryLines: T[] = [];
  for (const l of lines) (isSummaryRow(l) ? summaryLines : docLines).push(l);
  return { docLines, summaryLines };
}

/** Başlık sayımı: "12 top · 3 parti kaydı" — özet satırı top sayısına karışmaz. */
export function noteCountText(lines: ReadonlyArray<Pick<DeliveryNoteLine, "summary" | "lineKind">>): string {
  const { docLines, summaryLines } = splitNoteLines(lines);
  const tops = docLines.length === 0 ? "satır yok" : `${docLines.length} top`;
  return summaryLines.length > 0 ? `${tops} · ${summaryLines.length} ${TERIM_AD.partiKaydi.toLowerCase()}` : tops;
}

/**
 * Toplam şeridi kartı adı. Bölümlü (çok partili) belgede kartlar Partiler kartına taşınır, şeritte çizilmez; burada kalan
 * çok blok bölüm beyansızdır (parti sayılmaz) → "Blok N"; tek blokta blok numarası anlamsız → "Belge satırları".
 */
export function blockChipLabel(blockNo: number, blockCount: number): string {
  return blockCount > 1 ? `Blok ${blockNo}` : "Belge satırları";
}
