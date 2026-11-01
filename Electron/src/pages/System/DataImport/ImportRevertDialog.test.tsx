import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ImportRevertPlan } from "@/services/importService";
import { ImportRevertDialog } from "./ImportRevertDialog";

// Toplu açılış aktarımı: devir/çek satırı geri sarmada TERS KAYITLA kapanır — panel bunu satırda söyler,
// engelli satır gerekçesiyle görünür (silinmez/pasife alınmaz anlatımı).
const plan: ImportRevertPlan = {
  runId: "run-1",
  entity: "cariOpeningBalance",
  entityLabel: "Cari Açılış Bakiyeleri",
  runRevertedAt: null,
  sideEffects: [],
  rows: [
    { lineId: "l1", rowNo: 2, entity: "cariOpeningBalance", recordId: "r1", keyValue: "CUSTOMER|M001|TRY", label: "Örnek Tekstil", lineAction: "CREATE", action: "REVERSE_ENTRY", fields: [], children: [], alreadyReverted: false },
    { lineId: "l2", rowNo: 3, entity: "cariOpeningBalance", recordId: "r2", keyValue: "CUSTOMER|M002|USD", label: "Diğer", lineAction: "CREATE", action: "REVERSE_ENTRY", fields: [], children: [], skipReason: "Devir zaten iptal edilmiş (ters kaydı var)", alreadyReverted: false },
  ],
};

vi.mock("@/services/importService", () => ({
  importService: {
    revertPreview: vi.fn(() => Promise.resolve({ data: plan })),
    revertRun: vi.fn(),
  },
}));

describe("ImportRevertDialog — ters kayıt dalı", () => {
  it("REVERSE_ENTRY satırı Türkçe eylemle, engelli satır gerekçesiyle görünür", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ImportRevertDialog runId="run-1" onOpenChange={() => {}} onReverted={() => {}} />
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText(/Ters kayıtla iptal edilecek/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Devir zaten iptal edilmiş/)).toBeTruthy();
    expect(screen.queryByText("REVERSE_ENTRY")).toBeNull();
  });
});
