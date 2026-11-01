// D4-F2 cari kart "Barkod serisi" sekmesi: strict gövde + deneme token'ı, PUT expectedUpdatedAt,
// görünür biçim uyarısı (başlangıç/üst sınır değil), izinsiz kullanıcıda yazma düğmesi yok.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }),
}));
import { CustomerBarcodeSeriesPanel } from "./CustomerBarcodeSeriesPanel";

const SERIES = {
  id: "s1", customerId: "k1", prefix: "GK", dateSegment: "NONE", digits: 4, separator: "", startValue: null, maxValue: 500,
  formatChangedAt: "2026-10-30T08:00:00.000Z", updatedAt: "2026-10-31T09:15:00.123Z", isActive: true,
};
const netErr = () => new AxiosError("x", "ERR_NETWORK");
const conflict = () =>
  new AxiosError("x", "409", undefined, undefined, { status: 409, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: { message: "Bu müşterinin zaten bir barkod serisi var", details: { code: "CUSTOMER_SERIES_EXISTS" } } });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  perms = ["customer:read", "customer:write"];
});

describe("CustomerBarcodeSeriesPanel", () => {
  it("§1 ⭐ yaratma: strict gövde; token belirsiz hatada yapışır, kesin 409'da yenilenir", async () => {
    get.mockResolvedValue({ data: { data: { series: null, nextCode: null } } });
    post.mockRejectedValueOnce(netErr()).mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ data: { message: "Barkod serisi tanımlandı" } });
    renderWithProviders(<CustomerBarcodeSeriesPanel customerId="k1" />);
    fireEvent.change(await screen.findByLabelText("Ön ek"), { target: { value: "gk" } });
    const go = () => fireEvent.click(screen.getByRole("button", { name: "Seriyi tanımla" }));
    go();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Seriyi tanımla" })).toBeEnabled());
    go();
    await screen.findByText(/zaten bir barkod serisi var/);
    go();
    await screen.findByText("Barkod serisi tanımlandı");
    const bodies = post.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(post.mock.calls[0]?.[0]).toBe("/api/customers/k1/barcode-series");
    expect(Object.keys(bodies[0] ?? {}).sort()).toEqual(["clientToken", "dateSegment", "digits", "maxValue", "prefix", "separator", "startValue"]);
    expect(bodies[0]?.prefix).toBe("GK");
    expect(bodies[1]?.clientToken).toBe(bodies[0]?.clientToken);
    expect(bodies[2]?.clientToken).not.toBe(bodies[1]?.clientToken);
  });

  it("§2 ⭐ güncelleme: PUT expectedUpdatedAt; yalnız üst sınır değişimi biçim uyarısı GÖSTERMEZ", async () => {
    get.mockResolvedValue({ data: { data: { series: SERIES, nextCode: "GK0012" } } });
    put.mockResolvedValue({ data: { message: "Barkod serisi güncellendi" } });
    renderWithProviders(<CustomerBarcodeSeriesPanel customerId="k1" />);
    expect(await screen.findByText("GK0012")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Üst sınır (boş = sınırsız)"), { target: { value: "9999" } });
    expect(screen.queryByText(/Biçim değişiyor/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const body = put.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["dateSegment", "digits", "expectedUpdatedAt", "isActive", "maxValue", "prefix", "separator", "startValue"]);
    expect(body.expectedUpdatedAt).toBe(SERIES.updatedAt);
    expect(body.maxValue).toBe(9999);
    fireEvent.change(screen.getByLabelText("Ön ek"), { target: { value: "GX" } });
    expect(screen.getByText(/Biçim değişiyor/)).toBeInTheDocument();
  });

  it("§3 izinsiz (customer:write yok) → yazma düğmeleri çizilmez, alanlar pasif", async () => {
    perms = ["customer:read"];
    get.mockResolvedValue({ data: { data: { series: SERIES, nextCode: "GK0012" } } });
    renderWithProviders(<CustomerBarcodeSeriesPanel customerId="k1" />);
    expect(await screen.findByText("GK0012")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Önizle" })).toBeNull();
    expect(screen.getByLabelText("Ön ek")).toBeDisabled();
  });
});
