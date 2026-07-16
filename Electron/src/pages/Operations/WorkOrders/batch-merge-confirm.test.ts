import { describe, it, expect } from "vitest";
import {
  buildMergeConfirmDescription,
  type MergeConfirmBatch,
  type MergeConfirmDispatch,
} from "./batch-merge-confirm";

function dispatch(
  dispatchNo: string,
  status: MergeConfirmDispatch["status"],
  stepName: string | null = "Boyahane (fason)",
  subcontractorName = "Fasoncu A",
  // Kimlik anahtarları — ad'dan türetilir ki mevcut senaryolar aynı kalsın
  // (aynı ad = aynı kimlik varsayımı bu fixture'a özgü).
  stepSequence = stepName === "Zımpara (fason)" ? 1 : 2,
  subcontractorId = `sub-${subcontractorName}`,
): MergeConfirmDispatch {
  return { dispatchNo, status, stepName, stepSequence, subcontractorId, subcontractorName };
}

function batch(
  batchNumber: string,
  opts: { locked?: boolean; dispatches?: MergeConfirmDispatch[] } = {},
): MergeConfirmBatch {
  return {
    batchId: `id-${batchNumber}`,
    batchNumber,
    locked: opts.locked ?? false,
    dispatches: opts.dispatches ?? [],
  };
}

describe("buildMergeConfirmDescription", () => {
  it("boş seçim → boş string", () => {
    expect(buildMergeConfirmDescription([])).toBe("");
  });

  it("sevksiz partiler → yalnız temel cümle (ek satır yok)", () => {
    const text = buildMergeConfirmDescription([batch("P1"), batch("P2")]);
    expect(text).toBe(
      "P1, P2 → hepsi en eski parti P1 altında tek partide birleşecek. İşlem geri alınamaz.",
    );
  });

  it("kaynak partinin tek açık sevki → 'taşınacak' satırı (istasyon fason eki soyulur)", () => {
    const text = buildMergeConfirmDescription([
      batch("P1"),
      batch("P2", { locked: true, dispatches: [dispatch("FS100", "OPEN")] }),
    ]);
    expect(text).toContain("Açık fason sevkleri:");
    expect(text).toContain("• FS100 (Boyahane · Fasoncu A) → P1 altına taşınacak");
    // Kilitli parti seçili → fasondaki mal notu.
    expect(text).toContain("Fasondaki mal etkilenmez; sevk kayıtları P1 partisine taşınır.");
  });

  it("aynı (adım, firma) çiftinde survivor + kaynak açık sevkleri → ikisi de 'birleştirilecek'", () => {
    const text = buildMergeConfirmDescription([
      batch("P1", { locked: true, dispatches: [dispatch("FS100", "PARTIAL")] }),
      batch("P2", { locked: true, dispatches: [dispatch("FS101", "OPEN")] }),
    ]);
    expect(text).toContain("• FS100 (Boyahane · Fasoncu A) → P1 altında tek sevkte birleştirilecek");
    expect(text).toContain("• FS101 (Boyahane · Fasoncu A) → P1 altında tek sevkte birleştirilecek");
  });

  it("survivor'ın birleşmeyecek kendi sevki listelenmez; kapanmış sevkler hiç girmez", () => {
    const text = buildMergeConfirmDescription([
      batch("P1", { dispatches: [dispatch("FS100", "OPEN", "Zımpara (fason)", "Fasoncu B")] }),
      batch("P2", { dispatches: [dispatch("FS200", "RETURNED"), dispatch("FS201", "CANCELLED")] }),
    ]);
    // P1'in sevki yerinde kalıyor, P2'ninkiler kapalı → somut sevk bölümü yok.
    expect(text).not.toContain("FS100");
    expect(text).not.toContain("FS200");
    expect(text).not.toContain("Açık fason sevkleri:");
  });

  it("aynı istasyon ADI ama farklı adım (stepSequence) → 'birleştirilecek' DEĞİL, ayrı 'taşınacak'", () => {
    const text = buildMergeConfirmDescription([
      batch("P1"),
      batch("P2", {
        locked: true,
        dispatches: [
          dispatch("FS400", "OPEN", "Boyahane (fason)", "Fasoncu A", 2),
          dispatch("FS401", "OPEN", "Boyahane (fason)", "Fasoncu A", 5),
        ],
      }),
    ]);
    expect(text).toContain("• FS400 (Boyahane · Fasoncu A) → P1 altına taşınacak");
    expect(text).toContain("• FS401 (Boyahane · Fasoncu A) → P1 altına taşınacak");
    expect(text).not.toContain("tek sevkte birleştirilecek");
  });

  it("farklı adımlardaki açık sevkler ayrı ayrı 'taşınacak'", () => {
    const text = buildMergeConfirmDescription([
      batch("P1"),
      batch("P2", {
        locked: true,
        dispatches: [
          dispatch("FS300", "OPEN", "Zımpara (fason)", "Fasoncu B"),
          dispatch("FS301", "OPEN", "Boyahane (fason)", "Fasoncu A"),
        ],
      }),
    ]);
    expect(text).toContain("• FS300 (Zımpara · Fasoncu B) → P1 altına taşınacak");
    expect(text).toContain("• FS301 (Boyahane · Fasoncu A) → P1 altına taşınacak");
  });
});
