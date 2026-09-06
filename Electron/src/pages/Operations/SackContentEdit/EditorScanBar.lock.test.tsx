// =============================================================================
// BEKÇİ — okutma 409 alınca EKRAN KİLİT GÖRÜNÜMÜNE GEÇER
// =============================================================================
// ⭐ NEDEN YAZILDI: sahada ölçüldü (fabrika logu 2026-09-05 08:33–08:36):
//      POST /sacks/7992b81a.../scan → 409   ×5, tek çuvala, üç dakikada
//    Operatör editör açıkken çuval ARKA PLANDA sevkiyata bağlanmış. Ekrandaki
//    döküm bayat olduğu için `locked` hâlâ false, okutma çubuğu duruyor ve
//    aynı hata tekrar tekrar alınıyor. Panel kilitli çuvalda çubuğu zaten
//    çizmiyor — eksik olan tek şey, 409'un dökümü TAZELEMESİYDİ.
//
// NE ÖLÇER: 409'da o çuvalın dökümünün tazelendiğini (ekran kilide geçsin),
//    ve başka hatalarda TAZELENMEDİĞİNİ (her hataya sunucu isteği atmayalım).
//    İkinci toast BASILMAZ — genel interceptor'ın işi (Electron/CLAUDE.md).
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `EditorScanBar`taki `onError` bloğu
//    kaldırılınca §1 KIRMIZI. Geri alındığında yeşil.
// =============================================================================
import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorScanBar } from "./EditorScanBar";

const SACK = "cuval-1";

const scanIntoSack = vi.fn();
vi.mock("./service", () => ({
  sackHubService: { scanIntoSack: (...a: unknown[]) => scanIntoSack(...a) },
}));
vi.mock("./useSackData", () => ({ invalidateSackHub: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ScanField gerçek bir okutma alanıdır (odak/kuyruk davranışı) — bu bekçinin
// konusu değil; tek bir düğmeye indiriyoruz.
vi.mock("@/components/scanner/ScanField", () => ({
  ScanField: ({ onScan }: { onScan: (code: string) => void }) => (
    <button onClick={() => onScan("TEST-BARKOD")}>okut</button>
  ),
}));

/** `isAxiosError` yalnız bu bayrağa bakar — gerçek AxiosError kurmaya gerek yok. */
const axiosHatasi = (status: number) => ({
  isAxiosError: true,
  response: { status, data: { message: "hata" } },
});

function kur(): { qc: QueryClient; ui: ReactElement } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ui: <Wrapper><EditorScanBar sackId={SACK} /></Wrapper> };
}

async function okut(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "okut" }));
}

describe("EditorScanBar — 409 sonrası tazeleme", () => {
  beforeEach(() => { scanIntoSack.mockReset(); });

  it("§1 ⭐ 409'da çuvalın dökümü tazelenir (ekran kilit görünümüne geçsin)", async () => {
    scanIntoSack.mockRejectedValue(axiosHatasi(409));
    const { qc, ui } = kur();
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(ui);

    await okut();

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["sack-contents", SACK] }),
    );
  });

  it("§2 409 DIŞI hatada tazeleme yapılmaz (gereksiz istek üretme)", async () => {
    scanIntoSack.mockRejectedValue(axiosHatasi(400));
    const { qc, ui } = kur();
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(ui);

    await okut();

    await waitFor(() => expect(scanIntoSack).toHaveBeenCalled());
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["sack-contents", SACK] });
  });

  it("§3 körlük zemini: okutma gerçekten çağrıldı", async () => {
    scanIntoSack.mockResolvedValue({ message: "Okutuldu" });
    const { ui } = kur();
    render(ui);

    await okut();

    await waitFor(() => expect(scanIntoSack).toHaveBeenCalledWith(SACK, "TEST-BARKOD"));
  });
});
