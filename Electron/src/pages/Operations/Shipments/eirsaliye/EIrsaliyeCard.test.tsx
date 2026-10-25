// e-İrsaliye bölümü: izinsiz/eski backend (404) → hiç çizilmez · YAPILANDIRILMAMIS → görünür +
// ayar yolu kayıttan · HAZIR → kart; simülasyon bandı, kaynak değişti uyarısı, ihracat bilgisi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { EIrsaliyeRecordView, ShipmentEIrsaliye } from "./types";

const perms = vi.fn<(p: string) => boolean>();
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms(p)) }),
}));
const readiness = vi.fn();
const byShipment = vi.fn();
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  eIrsaliyeService: { readiness: () => readiness(), byShipment: (id: string) => byShipment(id) },
}));

import { EIrsaliyeSection } from "./EIrsaliyeSection";
import { eIrsaliyeSettingsLink } from "./useEIrsaliye";

const notFound = () => Object.assign(new Error("404"), { isAxiosError: true, response: { status: 404, data: {} } });
const rec = (over: Partial<EIrsaliyeRecordView> = {}): EIrsaliyeRecordView => ({
  id: "r1", shipmentId: "s1", status: "OLUSTURULDU", documentNo: "EIR2026000000007", ettn: "3f0c1a52-7d7e-4b2a-9d0e-1b2c3d4e5f60",
  confirmedNo: null, confirmedEttn: null, adapter: "disaAktar", simulasyon: false, sentAt: null, responseAt: null, responseNote: null,
  lastDownloadedAt: null, downloadCount: 0, replacesId: null, createdAt: "2026-10-25T08:00:00Z", updatedAt: "2026-10-25T08:00:00Z",
  licensePlate: "16ABC123", trailerPlate: null, driverFirstName: "Ali", driverFamilyName: "Veli", driverNationalId: "10000000146",
  carrierName: null, carrierTaxId: null, recipientFirstName: null, recipientFamilyName: null,
  kaynakDegisti: false, olaylar: [], xmlSurumleri: [{ id: "x1", version: 1, ettn: "e", sha256: "abcdef0123456789", createdAt: "2026-10-25T08:00:00Z" }],
  ...over,
});
const view = (over: Partial<ShipmentEIrsaliye> = {}): ShipmentEIrsaliye => ({
  shipmentId: "s1", ihracat: false, hazirlik: { durum: "HAZIR", eksikler: [] }, aktifIrsaliye: null, canli: rec(), gecmis: [], ...over,
});

describe("EIrsaliyeSection", () => {
  beforeEach(() => {
    perms.mockReset().mockImplementation(() => true);
    readiness.mockReset();
    byShipment.mockReset();
  });

  it("⭐ okuma izni yoksa hiçbir şey çizilmez ve sunucu sorulmaz", () => {
    perms.mockImplementation(() => false);
    const { container } = renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    expect(container.innerHTML).toBe("");
    expect(readiness).not.toHaveBeenCalled();
  });

  it("⭐ eski backend (readiness 404) → bölüm sessizce yok, kart sorgusu atılmaz", async () => {
    readiness.mockRejectedValue(notFound());
    const { container } = renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    await waitFor(() => expect(readiness).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(byShipment).not.toHaveBeenCalled();
  });

  it("⭐ YAPILANDIRILMAMIS → bölüm görünür, ayar yolu kayıttan türer, eksikler listelenir", async () => {
    readiness.mockResolvedValue({ durum: "YAPILANDIRILMAMIS", eksikler: ["e-İrsaliye yürürlük tarihi girilmemiş"] });
    renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    const box = await screen.findByTestId("eirsaliye-unconfigured");
    const link = eIrsaliyeSettingsLink();
    expect(link.trail).toBe("Sistem → Şirket & Güvenlik → e-İrsaliye");
    expect((box.textContent ?? "").replace(/\s+/g, " ")).toContain(`Yapılandırılmamış — ${link.trail}`);
    expect(screen.getByRole("link").getAttribute("href")).toBe(link.path);
    expect(box.textContent).toContain("yürürlük tarihi girilmemiş");
    expect(byShipment).not.toHaveBeenCalled();
  });

  it("HAZIR + kayıt yok → Hazırlanmadı rozeti ve hazırla düğmesi", async () => {
    readiness.mockResolvedValue({ durum: "HAZIR", eksikler: [] });
    byShipment.mockResolvedValue(view({ canli: null }));
    renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    expect(await screen.findByText("Hazırlanmadı")).toBeTruthy();
    expect(screen.getByRole("button", { name: /e-İrsaliye hazırla/ })).toBeTruthy();
  });

  it("⭐ iptal sonrası (canlı yok) önceki kayıt geçmişte görünür kalır", async () => {
    readiness.mockResolvedValue({ durum: "HAZIR", eksikler: [] });
    byShipment.mockResolvedValue(view({ canli: null, gecmis: [rec({ status: "IPTAL", documentNo: "EIR2026000000003" })] }));
    renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    expect(await screen.findByText("Hazırlanmadı")).toBeTruthy();
    expect(screen.getByText("Geçmiş (1 önceki kayıt)")).toBeTruthy();
    expect(screen.getByText("EIR2026000000003")).toBeTruthy();
  });

  it("⭐ simülasyon kaydı kalıcı kırmızı bant taşır; TCKN kartta maskeli", async () => {
    readiness.mockResolvedValue({ durum: "HAZIR", eksikler: [] });
    byShipment.mockResolvedValue(view({ canli: rec({ adapter: "simulasyon", simulasyon: true }) }));
    renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    expect((await screen.findByTestId("eirsaliye-sim-band")).textContent).toContain("SİMÜLASYON");
    const info = screen.getByTestId("eirsaliye-info").textContent ?? "";
    expect(info).not.toContain("10000000146");
    expect(info).toContain("•••••••••46");
  });

  it("⭐ kâğıt irsaliye değişti → yeniden üret uyarısı", async () => {
    readiness.mockResolvedValue({ durum: "HAZIR", eksikler: [] });
    byShipment.mockResolvedValue(view({ canli: rec({ kaynakDegisti: true }) }));
    renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    expect((await screen.findByTestId("eirsaliye-source-changed")).textContent).toContain("Kâğıt irsaliye değişti — yeniden üretin");
  });

  it("⭐ ihracat sevkiyatı: v1'de desteklenmiyor, eylem yok", async () => {
    readiness.mockResolvedValue({ durum: "HAZIR", eksikler: [] });
    byShipment.mockResolvedValue(view({ ihracat: true, canli: null }));
    renderWithProviders(<EIrsaliyeSection shipmentId="s1" shipmentStatus="DISPATCHED" />);
    expect((await screen.findByTestId("eirsaliye-export")).textContent).toContain("v1'de desteklenmiyor");
    expect(screen.queryByTestId("eirsaliye-actions")).toBeNull();
  });
});
