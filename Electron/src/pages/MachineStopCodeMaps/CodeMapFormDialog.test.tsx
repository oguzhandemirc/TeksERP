// Eşleme formu: sebep seçici DOĞRUDAN modal açar ve yalnız seçilebilir sebepleri listeler; düzenlemede anahtar kilitli.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: () => Promise.resolve({ data: [{ id: "m1", code: "T-01", name: "Tezgah 1" }] }),
}));
vi.mock("@/pages/Operations/MachineStops/useStopReasonPresets", () => ({
  useStopReasonPresets: () => ({
    active: [
      { id: "r1", kind: "MACHINE_STOP", code: "IPLIK", label: "İplik kopması", isActive: true, stopLossClass: "MACHINE" },
      { id: "r2", kind: "MACHINE_STOP", code: "ESKI", label: "Sınıfsız sebep", isActive: true, stopLossClass: null },
    ],
    labelOf: (c: string) => c,
    isLoading: false,
  }),
}));

import { CodeMapFormDialog } from "./CodeMapFormDialog";

function renderDialog(initial: Parameters<typeof CodeMapFormDialog>[0]["initial"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CodeMapFormDialog open onOpenChange={() => undefined} initial={initial} onSubmit={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("CodeMapFormDialog", () => {
  it("sebep seçici modal açar; kayıp sınıfsız sebep listelenmez", () => {
    renderDialog(null);
    fireEvent.click(screen.getByText("Sebep seç"));
    const dlg = screen.getByRole("dialog", { name: "Duruş sebebi seç" });
    expect(within(dlg).getByText("İplik kopması")).toBeTruthy();
    expect(within(dlg).queryByText("Sınıfsız sebep")).toBeNull();
  });

  it("düzenleme: kart tipi ve ham kod kilitli, kapsam metin olarak", () => {
    renderDialog({
      id: "x1", collectorType: "TEKS-ESP32-V1", rawStopCode: "E12", machineId: null, stopReasonId: "r1", isActive: true,
      machine: null, stopReason: { id: "r1", code: "IPLIK", label: "İplik kopması", isActive: true }, createdAt: "", updatedAt: "",
    });
    expect((screen.getByLabelText(/Kart tipi/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Ham duruş kodu/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Kart tipi geneli (tüm tezgahlar)")).toBeTruthy();
  });
});
