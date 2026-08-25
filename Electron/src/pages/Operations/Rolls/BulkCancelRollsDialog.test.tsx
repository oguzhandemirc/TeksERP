import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * STOKTAN KALDIRMA — İKİ AYRI KARAR (2026-08-25 kullanıcı kararı).
 *
 * Bu bekçi tek bir şeyi kilitler: "iptal" ile "fire" AYNI uca gitmemeli.
 *   • İptal = "bu kayıt hiç olmamalıydı" → stok düşmez, fire raporuna GİRMEZ
 *   • Fire  = "mal vardı, artık yok"    → stok düşer, fire oranına GİRER
 * Birleşirlerse fabrikanın fire oranı veri düzeltmeleriyle kirlenir ve o oran
 * müşteriye/maliyete konuşulan bir sayıdır.
 *
 * Ayrıca 2026-08-25'te düzeltilen iki saha arızasını kilitler:
 *   ① ENGELLİ top DENENMEZ (eski pencere körlemesine deniyordu),
 *   ② ölü etiket ONAYI YOK — etiket yalnız bilgi (eski backend guard'ı masaüstünde
 *      hiç bağlanmamıştı, bu yüzden etiketli top oradan HİÇ iptal edilemiyordu).
 */

const cancel = vi.fn().mockResolvedValue({ success: true });
const scrap = vi.fn().mockResolvedValue({ success: true });
const cancelPreview = vi.fn();

vi.mock("./service", () => ({
  rollService: {
    cancel: (...a: unknown[]) => cancel(...a),
    scrap: (...a: unknown[]) => scrap(...a),
    cancelPreview: (...a: unknown[]) => cancelPreview(...a),
  },
}));

vi.mock("@/pages/ReasonPresets/service", () => ({
  reasonPresetService: { list: () => Promise.resolve([]) },
}));

let permissions: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => permissions.includes(p) }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BulkCancelRollsDialog } from "./BulkCancelRollsDialog";

const preview = (rollId: string, over: Record<string, unknown> = {}) => ({
  data: {
    rollId,
    barcode: rollId,
    status: "STOCK",
    itemName: "PATOS",
    colorName: null,
    initialQty: 100,
    width: 250,
    canCancel: true,
    blockReason: null,
    requiresConfirm: false,
    activeAt: null,
    openMovementCount: 0,
    labelPrinted: false,
    labelPrintedAt: null,
    ...over,
  },
});

const roll = (id: string) =>
  ({ id, barcode: id, currentQty: 100, item: { name: "PATOS" } }) as never;

function renderDialog(rolls: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BulkCancelRollsDialog open onOpenChange={() => {}} rolls={rolls as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cancel.mockClear();
  scrap.mockClear();
  cancelPreview.mockReset();
  permissions = ["roll:write", "roll:manual-adjust"];
});

describe("BulkCancelRollsDialog", () => {
  it("varsayılan İPTAL: cancel ucuna gider, scrap'e DOKUNMAZ", async () => {
    cancelPreview.mockImplementation((id: string) => Promise.resolve(preview(id)));
    renderDialog([roll("T-1"), roll("T-2")]);

    // Önizlemeler yüklenene kadar buton "Kontrol ediliyor…" der — bu ad ancak
    // kontrol bitince doğar, yani findByRole aynı zamanda hazırlığı da bekler.
    const btn = await screen.findByRole("button", { name: /2 topu stoktan kaldır/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(scrap).not.toHaveBeenCalled();
  });

  it("FİRE seçilince scrap ucuna gider, cancel'a DOKUNMAZ", async () => {
    cancelPreview.mockImplementation((id: string) => Promise.resolve(preview(id)));
    renderDialog([roll("T-1")]);

    fireEvent.click(await screen.findByText(/Mal vardı, fire/));
    fireEvent.click(await screen.findByRole("button", { name: /1 topu fire et/ }));

    await waitFor(() => expect(scrap).toHaveBeenCalledTimes(1));
    expect(cancel).not.toHaveBeenCalled();
  });

  it("izinsiz kullanıcıya FİRE şıkkı ÇİZİLMEZ (tıklayıp 403 almasın)", async () => {
    permissions = ["roll:write"];
    cancelPreview.mockImplementation((id: string) => Promise.resolve(preview(id)));
    renderDialog([roll("T-1")]);

    await screen.findByText(/Kayıt hatası/);
    expect(screen.queryByText(/Mal vardı, fire/)).toBeNull();
  });

  it("ENGELLİ top denenmez ve sebebi satırında YAZAR", async () => {
    cancelPreview.mockImplementation((id: string) =>
      Promise.resolve(
        id === "T-2"
          ? preview(id, {
              canCancel: false,
              blockReason: "Fasondaki top iptal edilemez — önce fason mal kabul yapın",
            })
          : preview(id),
      ),
    );
    renderDialog([roll("T-1"), roll("T-2")]);

    // Buton yalnız GEÇEBİLECEK topları sayar.
    const btn = await screen.findByRole("button", { name: /1 topu stoktan kaldır/ });
    await screen.findByText(/Fasondaki top iptal edilemez/);

    fireEvent.click(btn);
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledWith("T-1", undefined);
  });

  it("etiketli top ENGEL DEĞİL — onay kutusu yok, yine de gönderilir", async () => {
    cancelPreview.mockImplementation((id: string) =>
      Promise.resolve(preview(id, { labelPrinted: true, labelPrintedAt: "2026-08-24T16:32:00Z" })),
    );
    renderDialog([roll("T-1")]);

    const btn = await screen.findByRole("button", { name: /1 topu stoktan kaldır/ });
    expect(btn).not.toBeDisabled();
    // Bilgi görünür ama bir onay DEĞİL.
    await screen.findByText(/etiketli/);
    expect(screen.queryByRole("checkbox")).toBeNull();

    fireEvent.click(btn);
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });
});
