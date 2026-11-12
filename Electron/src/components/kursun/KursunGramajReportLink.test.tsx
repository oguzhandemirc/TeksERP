// KQ-D6: "Gramaj raporu" kısa yolu Rapor Merkezi'nin yüklemiyle çizilir (bayrak 2026-11-12 emekli).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let allowed = true;
let open = true;
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: false, hasPermission: () => allowed }) }));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ flagsReady: true, flagsFailed: false, productionEnabled: true, isReportOpen: () => open }),
}));

import { KursunGramajReportLink } from "./KursunGramajReportLink";

const draw = () => render(<MemoryRouter><KursunGramajReportLink /></MemoryRouter>);

describe("KursunGramajReportLink", () => {
  beforeEach(() => { allowed = true; open = true; });
  it("izinli ve rapor açık: rapor adresine bağlantı", () => {
    draw();
    expect(screen.getByRole("link", { name: /Gramaj raporu/ }).getAttribute("href")).toBe("/reports/production/kursun-gramaj");
  });
  it("izin yok: hiç çizilmez", () => {
    allowed = false;
    draw();
    expect(screen.queryByRole("link", { name: /Gramaj raporu/ })).toBeNull();
  });
  it("rapor kapalı: hiç çizilmez", () => {
    open = false;
    draw();
    expect(screen.queryByRole("link", { name: /Gramaj raporu/ })).toBeNull();
  });
});
