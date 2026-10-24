// KQ-D6: `reports.v2Enabled` kapalıyken "Gramaj raporu" düğmesi sessizce kaybolmaz, nedenini söyler.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let v2: boolean | undefined = false;
let allowed = true;
const info = vi.fn();
vi.mock("sonner", () => ({ toast: { info: (...a: unknown[]) => info(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: false, hasPermission: () => allowed }) }));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ flagsReady: true, reportsV2Enabled: v2, productionEnabled: true, modules: {}, flags: {} }),
}));

import { KursunGramajReportLink, REPORTS_V2_OFF_MESSAGE } from "./KursunGramajReportLink";

const draw = () => render(<MemoryRouter><KursunGramajReportLink /></MemoryRouter>);

describe("KursunGramajReportLink", () => {
  beforeEach(() => { info.mockReset(); allowed = true; });
  it("bayrak kapalı: düğme görünür, tıklanınca 'kapalı' mesajı, bağlantı yok", () => {
    v2 = false;
    draw();
    const btn = screen.getByRole("button", { name: /Gramaj raporu/ });
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(btn);
    expect(info).toHaveBeenCalledWith(REPORTS_V2_OFF_MESSAGE);
    expect(REPORTS_V2_OFF_MESSAGE).toBe("Raporlar v2 kapalı — Genel Ayarlar'dan açılır");
  });
  it("bayrak kapalı + izin yok: hiç çizilmez", () => {
    v2 = false; allowed = false;
    draw();
    expect(screen.queryByRole("button", { name: /Gramaj raporu/ })).toBeNull();
  });
});
