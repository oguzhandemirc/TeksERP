// Sertifika listesi: süzgeç sunucuya parametre olarak gider; rozet sunucunun `daysLeft`inden; boş ve hata ayrı.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const list = vi.fn();
vi.mock("./service", () => ({ certificateService: { list: (...a: unknown[]) => list(...a) } }));

import { CertificateList } from "./CertificateList";

const base = { holder: "OWN", partnerId: null, issuer: "Hohenstein", scope: null, issuedOn: null, note: null, renewsId: null, revokedAt: null, revokeReason: null, createdAt: "", updatedAt: "", partner: null, renews: null, renewedBy: null, fileCount: 1, active: true };
const page = (items: unknown[]) => ({ items, nextCursor: null, summary: { active: 2, expiring: 1, expired: 1, revoked: 0, days: 30 } });

describe("CertificateList", () => {
  beforeEach(() => list.mockReset());
  it("dolu liste: süresi dolan kırmızı, yaklaşan sarı rozet; özet şeridi aynı yanıttan", async () => {
    list.mockResolvedValue(page([
      { ...base, id: "a", standard: "GOTS", certificateNo: "G-1", expiresOn: "2026-10-20", daysLeft: -5 },
      { ...base, id: "b", standard: "OEKO-TEX Standard 100", certificateNo: "O-1", expiresOn: "2026-11-05", daysLeft: 11 },
    ]));
    renderWithProviders(<CertificateList onOpen={() => {}} />);
    expect((await screen.findByText("Süresi doldu · 5 gün önce")).getAttribute("data-tone")).toBe("expired");
    expect(screen.getByText("11 gün kaldı").getAttribute("data-tone")).toBe("soon");
    expect(screen.getByTestId("certificate-summary").textContent).toContain("Süresi dolmuş1");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: "active", days: 30 }));
  });
  it("özet kutusuna tık → süzgeç sunucuya gider (süzme istemcide yapılmaz)", async () => {
    list.mockResolvedValue(page([]));
    renderWithProviders(<CertificateList onOpen={() => {}} />);
    fireEvent.click(within(await screen.findByTestId("certificate-summary")).getByText("Süresi dolmuş"));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "expired" })));
  });
  it("boş liste rehber metni, hata ayrı mesaj", async () => {
    list.mockResolvedValueOnce(page([]));
    const r = renderWithProviders(<CertificateList onOpen={() => {}} />);
    expect(await screen.findByText(/Henüz etkin sertifika yok/)).toBeTruthy();
    r.unmount();
    list.mockRejectedValueOnce(new Error("x"));
    renderWithProviders(<CertificateList onOpen={() => {}} />);
    expect(await screen.findByText("Sertifikalar yüklenemedi.")).toBeTruthy();
  });
});
