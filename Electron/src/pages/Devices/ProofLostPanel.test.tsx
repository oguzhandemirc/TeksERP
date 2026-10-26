import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ProofLostOverview } from "./types";

// =============================================================================
// Anahtar kaybı bandı + toplu yeniden bağlama (D5). İddia: kayıp yokken bant GİZLİ; bant ilk öneri
// olarak emanet geri yüklemeyi gösterir; önizleme kayıt kayıt seçimlidir ve "yeniden bağla" YALNIZ
// işaretlenenleri gönderir; donanım kimliği olmayan cihazın "onaya düşer" notu görünür; sonuç kayıt kayıt.
// Sonda (2026-10-26, ölçüldü): varsayılan seçimi boşalt → 2 kırmızı · gönderimi seçim yerine tüm listeye
// çevir → 1 kırmızı; ikisi md5 ile geri alındı, 4/4. Açılış-kenarı sıfırlamasını [open, devices]'a geri
// çevir → tazeleme vakası 1 kırmızı.
// =============================================================================

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), navigate: vi.fn() }));
vi.mock("@/services/apiClient", () => ({
  default: { get: h.get, post: h.post, patch: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (_e: unknown, yedek = "x") => yedek,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => h.navigate }));

const { ProofLostPanel, KEY_RESTORE_PATH } = await import("./ProofLostPanel");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const cihaz = (id: string, name: string, hasHw: boolean) => ({
  id, deviceId: `${id.slice(0, 8)}-local`, name, kind: "TABLET" as const, status: "APPROVED", isActive: true,
  machine: { code: "TMB-1", name: "Tambur 1" }, lastSeenAt: "2026-10-25T08:00:00.000Z", hasHw, kid: "deadbeefdeadbeef",
});
const KAYIP: ProofLostOverview = {
  halkaKaybi: { tespit: "2026-10-26T06:00:00.000Z", kayipKidler: ["deadbeefdeadbeef"], etkilenen: { cihazKaniti: 2, pin: 3, kart: 0, totp: 1 } },
  cihazlar: [cihaz(A, "Tambur-1 Tablet", true), cihaz(B, "Kalite Tableti", false)],
  bekleyenler: [],
};
let overview: ProofLostOverview = KAYIP;

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.navigate.mockReset();
  overview = KAYIP;
  h.get.mockImplementation(() => Promise.resolve({ data: { success: true, data: overview } }));
  h.post.mockImplementation((_url: string, body: { deviceIds: string[] }) =>
    Promise.resolve({
      data: { success: true, data: { sonuclar: body.deviceIds.map((id) => ({ id, name: id === A ? "Tambur-1 Tablet" : "Kalite Tableti", sonuc: "SIFIRLANDI", hasHw: id === A })) } },
    }));
});

describe("ProofLostPanel", () => {
  it("kayıp yokken bant gizli", async () => {
    overview = { halkaKaybi: null, cihazlar: [], bekleyenler: [] };
    renderWithProviders(<ProofLostPanel />);
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(screen.queryByLabelText("Anahtar kaybı")).toBeNull();
  });

  it("bant sayıyı ve etkileneni söyler; ilk öneri emanet geri yükleme", async () => {
    renderWithProviders(<ProofLostPanel initiallyOpen />);
    expect(await screen.findByText(/Anahtar kaybı: 2 cihazın kimliği doğrulanamıyor/)).toBeInTheDocument();
    expect(screen.getByText(/3 hızlı PIN/)).toBeInTheDocument();
    expect(screen.getByText(/1\. Önerilen: yedekten anahtarı geri yükleyin/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Anahtarı geri yükle/ }));
    expect(h.navigate).toHaveBeenCalledWith(KEY_RESTORE_PATH);
  });

  it("önizleme kayıt kayıt seçimli; yalnız işaretlenenler gönderilir; sonuç kayıt kayıt", async () => {
    renderWithProviders(<ProofLostPanel initiallyOpen />);
    fireEvent.click(await screen.findByRole("button", { name: /Toplu yeniden bağla/ }));
    expect(await screen.findByText(/onay bekleyene düşer, buradan yeniden onaylayın/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Tambur-1 Tablet/ })).toHaveAttribute("data-state", "checked");
    fireEvent.click(screen.getByRole("checkbox", { name: /Kalite Tableti/ }));
    fireEvent.click(screen.getByRole("button", { name: "Seçilen 1 cihazı yeniden bağla" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![0]).toBe("/api/admin/devices/proof-reset");
    expect(h.post.mock.calls[0]![1]).toEqual({ deviceIds: [A] });
    expect(await screen.findByText("Yeniden bağlama sonucu")).toBeInTheDocument();
    expect(screen.getByText("Yeniden bağlanmaya hazır")).toBeInTheDocument();
  });

  it("başarıdan sonra liste tazelenince sonuç ekranı kalır; kalanlar yeniden önizlemeye düşmez", async () => {
    renderWithProviders(<ProofLostPanel initiallyOpen />);
    fireEvent.click(await screen.findByRole("button", { name: /Toplu yeniden bağla/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Kalite Tableti/ }));
    overview = { ...KAYIP, cihazlar: [KAYIP.cihazlar[1]!] };
    const once = h.get.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Seçilen 1 cihazı yeniden bağla" }));
    expect(await screen.findByText("Yeniden bağlama sonucu")).toBeInTheDocument();
    await waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThan(once));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Yeniden bağlama sonucu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cihazı yeniden bağla$/ })).toBeNull();
  });

  it("hiç seçim yoksa düğme kapalı", async () => {
    renderWithProviders(<ProofLostPanel initiallyOpen />);
    fireEvent.click(await screen.findByRole("button", { name: /Toplu yeniden bağla/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Tambur-1 Tablet/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Kalite Tableti/ }));
    expect(screen.getByRole("button", { name: "Seçilen 0 cihazı yeniden bağla" })).toBeDisabled();
  });
});
