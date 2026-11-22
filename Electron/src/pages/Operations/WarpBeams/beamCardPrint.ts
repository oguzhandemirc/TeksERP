// Toplu A6 levent kartı basımı — her levent bir sayfa, TEK baskı işi (emsal `WorkOrders/bulkDocs.ts printDocs`).
// HTML backend'den (tek kaynak); alınamayan kart sessiz düşmez, sonuçta adıyla sayılır.
import { toast } from "sonner";
import { mergeDocsForPrint } from "@/lib/print-merge";
import { printTracked } from "@/lib/print";
import { printedDocumentService } from "@/services/printedDocumentService";
import { apiErrorMessage } from "@/services/apiClient";

export interface BeamCardTarget {
  id: string;
  beamNo: string;
}

export interface BeamCardPrintOutcome {
  printed: number;
  failed: Array<{ beamNo: string; reason: string }>;
}

export async function printBeamCards(beams: BeamCardTarget[]): Promise<BeamCardPrintOutcome> {
  const htmls: string[] = [];
  const okBeams: BeamCardTarget[] = [];
  const failed: BeamCardPrintOutcome["failed"] = [];
  // Sıralı istek: kart başına ilk basımda v1 donar; paralel yük sunucuda gereksiz yarış doğurmasın.
  for (const b of beams) {
    try {
      htmls.push(await printedDocumentService.getHtml("WARP_BEAM_CARD", b.id));
      okBeams.push(b);
    } catch (e) {
      failed.push({ beamNo: b.beamNo, reason: apiErrorMessage(e) });
    }
  }
  if (htmls.length === 0) return { printed: 0, failed };
  const merged = mergeDocsForPrint(htmls);
  for (const i of merged.unmergeable) failed.push({ beamNo: okBeams[i]!.beamNo, reason: "birleştirilemedi — tek tek basın" });
  const count = htmls.length - merged.unmergeable.length;
  if (count === 0) return { printed: 0, failed };
  const ids = okBeams.map((b) => b.id).slice(0, 200);
  const out = await printTracked({ subject: { kind: "BELGE", table: "warp_beams", ids, itemCount: count }, html: merged.html });
  return { printed: out.proceed ? count : 0, failed };
}

/** Kabul sonrası (`devere.beamCardAutoPrint`): OFF hiçbir şey (bugün) · ASK eylemli öneri · ALWAYS doğrudan basım. */
export function offerBeamCards(mode: "OFF" | "ASK" | "ALWAYS", beams: BeamCardTarget[]): void {
  if (mode === "OFF" || beams.length === 0) return;
  if (mode === "ALWAYS") {
    void printBeamCardsWithToast(beams);
    return;
  }
  toast(`${beams.length} levent kabul edildi`, {
    description: "Kılıfa takılacak A6 levent kartları basılsın mı?",
    duration: 15_000,
    action: { label: "Levent kartlarını bas", onClick: () => void printBeamCardsWithToast(beams) },
  });
}

/** Sonucu tek toast'la söyler; düşen kart adıyla yazılır. */
export async function printBeamCardsWithToast(beams: BeamCardTarget[]): Promise<void> {
  if (beams.length === 0) {
    toast.info("Basılacak canlı levent yok.");
    return;
  }
  const r = await printBeamCards(beams);
  if (r.failed.length === 0) return;
  const list = r.failed.map((f) => `${f.beamNo}: ${f.reason}`).join(" · ");
  toast.warning(`${r.failed.length} levent kartı basılamadı`, { description: list });
}
