// Hesaplayıcı: kayıt yazmaz ("Kaydet" yok; "Teklife ekle" yalnız quote:write ile), elle yapıda gövde sunucuya gider ve toplam sunucudan gelir.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

const previewCost = vi.fn();
vi.mock("../Items/service", async (orig) => ({ ...(await orig<object>()), previewCost: (b: unknown) => previewCost(b) }));
vi.mock("../FinishingRates/service", async (orig) => ({ ...(await orig<object>()), finishingRateService: { listActive: async () => [] } }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));
import { CalculatorPage } from "./CalculatorPage";

const sonuc = {
  satirlar: [], cozguKgM: "0.1", atkiKgM: "0.1", tezgahMSaat: "5", hamTlM: "50", mamulTlM: null, saglamTlM: "52", genelGiderTlM: "1", standartTlM: "53.4567",
};

describe("CalculatorPage", () => {
  it("elle yapı → önizleme isteği; toplam sunucunun; kayıt düğmesi yok", async () => {
    previewCost.mockResolvedValue({ sonuc, eksikler: [], uyarilar: [], girdi: { warp: null, weft: null, finishing: null }, kurlar: { tarih: "2026-10-25", kaynak: "YOK", kurlar: {} }, oneriler: { fx: {}, yarnPrices: [], warpWaste: null } });
    renderWithProviders(<CalculatorPage />);
    expect(screen.getByText("Hesap için bir kumaş seçin.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Elle yapı" }));
    fireEvent.change(screen.getByLabelText("Tel sayısı"), { target: { value: "5200" } });
    await waitFor(() => expect(screen.getByTestId("cost-total")).toHaveTextContent("53,46 TL/m"));
    expect(previewCost.mock.calls.at(-1)?.[0]).toMatchObject({ adHoc: { warp: { endsCount: "5200" } } });
    expect(screen.queryByRole("button", { name: /Teklife ekle|Kaydet/ })).toBeNull();
  });
});
