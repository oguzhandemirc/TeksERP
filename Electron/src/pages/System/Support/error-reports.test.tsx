import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ErrorReportOverview } from "./error-report-types";

const setConsent = vi.fn();
const overview = vi.fn();
vi.mock("@/services/errorReportService", () => ({ errorReportService: { overview: () => overview(), setConsent: (a: boolean) => setConsent(a) } }));
const { ErrorReportsCard, consentMeta, rowMeta } = await import("./ErrorReportsCard");

const ozet = (p: Partial<ErrorReportOverview> = {}): ErrorReportOverview => ({
  onay: { acik: false, degistiren: null, degisimZamani: null },
  bekleyen: 0,
  gonderilen: 0,
  kayitlar: [],
  ...p,
});

describe("Hata raporları kartı", () => {
  beforeEach(() => {
    setConsent.mockReset();
    overview.mockReset();
  });

  it("karar yoksa varsayılan KAPALI yazar; anahtar onay ucunu çağırır", async () => {
    overview.mockResolvedValue(ozet());
    setConsent.mockResolvedValue({ data: { acik: true, degistiren: null, degisimZamani: null } });
    renderWithProviders(<ErrorReportsCard />);
    await screen.findByText("Henüz karar verilmedi — varsayılan KAPALI.");
    const sw = screen.getByLabelText("Hata raporlarını gönder");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await waitFor(() => expect(setConsent).toHaveBeenCalledWith(true));
  });

  it("satır meta: tür/kaynak/sayı, hata yalnız KOD olarak ve yalnız gönderilmemişte", () => {
    const r = { id: "1", source: "panel" as const, version: "1.4.0", code: "UNHANDLED", errorClass: "TypeError", component: "sevkiyat", routeTemplate: "/sevkiyat/:p", stackFrames: [], count: 3, firstAt: "2026-10-06T08:00:00.000Z", lastAt: "2026-10-06T09:00:00.000Z", sentAt: null, lastErrorCode: "EGRESS_NETWORK" };
    expect(rowMeta(r)).toContain("Panel · 1.4.0 · 3 kez");
    expect(rowMeta(r)).toContain("son deneme: EGRESS_NETWORK");
    expect(rowMeta({ ...r, sentAt: "2026-10-06T09:05:00.000Z" })).not.toContain("son deneme");
    expect(consentMeta({ acik: true, degistiren: { id: "u", fullName: "Fabrika Yöneticisi" }, degisimZamani: "2026-10-06T09:00:00.000Z" })).toContain("Açan: Fabrika Yöneticisi");
  });
});
