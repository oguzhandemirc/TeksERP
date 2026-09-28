// Birleştirme onayı: kumaşa özel renk adı gölgelemesi KAYIT BAŞINA çizilir (müşteri · kumaş · renk · bugün → sonra);
// alanı göndermeyen eski backend'de liste yok, onay kapısı bugünkü gibi.
// Negatif sonda (kırmızı görüldü): MergeConfirmGate'ten <MergeShadowingList> kaldırılınca ilk vaka ❌.
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { MergePreview } from "@/services/mergeService";
import { MergeConfirmGate } from "./MergeConfirmGate";

const base: MergePreview = {
  entity: "customer",
  survivor: { id: "a", code: "C001", name: "A Tekstil" },
  sources: [{ id: "a2", code: "C002", name: "A Tekstil (2)", isActive: true }],
  canMerge: true,
  blockers: [],
  warnings: [],
  moves: [],
  conflicts: [],
  fieldChoices: [],
  sideEffects: [],
  totalRowsToMove: 0,
  measuredAll: true,
  computedAt: "",
};

const gate = (preview: MergePreview) => (
  <MergeConfirmGate
    preview={preview}
    typed=""
    onTypedChange={() => {}}
    reason=""
    onReasonChange={() => {}}
    seenConflicts={false}
    onSeenConflictsChange={() => {}}
    fieldPicks={{}}
    onFieldPickChange={() => {}}
  />
);

describe("MergeConfirmGate — kumaşa özel ad gölgelemesi", () => {
  it("her gölgelenen satır müşteri · kumaş · renk · bugün basılan → sonra olarak listelenir", () => {
    renderWithProviders(
      gate({
        ...base,
        shadowing: [
          { customer: "A Tekstil", item: "X Kumaş", color: "Ekru", alias: "P", before: "ABC" },
          { customer: "A Tekstil", item: "Y Kumaş", color: "Lacivert", alias: "GECE", before: null },
        ],
      }),
    );
    const table = screen.getByRole("table", { name: "Değişecek müşteri renk adları" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/A Tekstil\s*X Kumaş\s*Ekru\s*ABC\s*P/);
    expect(rows[1]).toHaveTextContent(/Y Kumaş\s*Lacivert\s*bizdeki ad \(Lacivert\)\s*GECE/);
  });

  it("alan yoksa (eski backend) ya da boşsa liste çizilmez", () => {
    const { unmount } = renderWithProviders(gate(base));
    expect(screen.queryByRole("table", { name: "Değişecek müşteri renk adları" })).toBeNull();
    unmount();
    renderWithProviders(gate({ ...base, shadowing: [] }));
    expect(screen.queryByRole("table", { name: "Değişecek müşteri renk adları" })).toBeNull();
  });
});
