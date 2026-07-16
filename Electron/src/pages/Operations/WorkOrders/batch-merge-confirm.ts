import { stripFason } from "./BatchTimeline";
import type { BatchDispatchStatus } from "./service";

/** buildMergeConfirmDescription'ın ihtiyaç duyduğu asgari sevk alanları (BatchLaneDispatch alt kümesi). */
export interface MergeConfirmDispatch {
  dispatchNo: string;
  stepName: string | null;
  /** Gruplama anahtarları KİMLİK bazlı — aynı istasyon ADINA iki fason adımı /
   *  ad çakışması yanlış "tek sevkte birleştirilecek" beyanı üretmesin (backend
   *  K15 konsolidasyonu stepId+subcontractorId ile çalışır; stepSequence adımın
   *  rota-içi tekil kimliğidir). */
  stepSequence: number;
  subcontractorId: string;
  subcontractorName: string;
  status: BatchDispatchStatus;
}

/** buildMergeConfirmDescription'ın ihtiyaç duyduğu asgari parti alanları (BatchLane alt kümesi). */
export interface MergeConfirmBatch {
  batchId: string;
  batchNumber: string;
  locked: boolean;
  dispatches: MergeConfirmDispatch[];
}

/**
 * K15 birleştirme onayı — "yıkıcı işlemde somut liste" kuralı: seçili partilerin
 * AÇIK (OPEN/PARTIAL) fason sevkleri satır satır listelenir (belge cerrahisinin
 * somut dökümü); kilitli parti seçiliyse fasondaki malın etkilenmeyeceği notu
 * düşülür. Saf fonksiyon — ConfirmDialog `description` string aldığından çok
 * satırlı string döner (DialogDescription `whitespace-pre-line` ile basar).
 *
 * `batches` en-eski-önce sıralı gelir (getBranches createdAt asc) — ilk eleman
 * survivor'dır (numarası yaşar). Aynı (adım, firma) çiftindeki birden çok açık
 * sevk backend'de TEK kayıtta birleşir (K15 madde 3) → "birleştirilecek";
 * tek sevk yalnız survivor'a yeniden hedeflenir → "taşınacak". Survivor'ın
 * kendi sevki zaten yerinde olduğundan, birleşmeyecekse listelenmez.
 */
export function buildMergeConfirmDescription(batches: MergeConfirmBatch[]): string {
  const survivor = batches[0];
  if (!survivor) return "";
  const lines: string[] = [
    `${batches.map((b) => b.batchNumber).join(", ")} → hepsi en eski parti ${survivor.batchNumber} altında tek partide birleşecek. İşlem geri alınamaz.`,
  ];

  const open = batches.flatMap((b) =>
    b.dispatches
      .filter((d) => d.status === "OPEN" || d.status === "PARTIAL")
      .map((d) => ({ batchId: b.batchId, d })),
  );
  if (open.length > 0) {
    // Aynı (adım, firma) grubunda kaç açık sevk var → taşınacak mı, birleşecek mi.
    // Anahtar kimlik bazlı (stepSequence + subcontractorId) — backend K15 ile birebir.
    const key = (d: MergeConfirmDispatch) => `${d.stepSequence}|${d.subcontractorId}`;
    const groupSize = new Map<string, number>();
    for (const { d } of open) groupSize.set(key(d), (groupSize.get(key(d)) ?? 0) + 1);

    const rows = open
      .filter(({ batchId, d }) => batchId !== survivor.batchId || (groupSize.get(key(d)) ?? 0) > 1)
      .map(({ d }) => {
        const station = d.stepName ? stripFason(d.stepName) : "Fason";
        const verb =
          (groupSize.get(key(d)) ?? 0) > 1
            ? `${survivor.batchNumber} altında tek sevkte birleştirilecek`
            : `${survivor.batchNumber} altına taşınacak`;
        return `• ${d.dispatchNo} (${station} · ${d.subcontractorName}) → ${verb}`;
      });
    if (rows.length > 0) lines.push("", "Açık fason sevkleri:", ...rows);
  }

  if (batches.some((b) => b.locked)) {
    lines.push(
      "",
      `Fasondaki mal etkilenmez; sevk kayıtları ${survivor.batchNumber} partisine taşınır.`,
    );
  }
  return lines.join("\n");
}
