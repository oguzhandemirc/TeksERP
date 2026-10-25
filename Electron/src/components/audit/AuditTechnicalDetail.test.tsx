import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab: () => {} }) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasAnyPermission: () => true }) }));
const getIslem = vi.fn();
let impl: ((id: string) => Promise<unknown>) | null = null;
vi.mock("@/services/systemLogService", () => ({
  systemLogService: { getIslem: (id: string) => (impl ? impl(id) : getIslem(id)) },
}));

import { AuditTechnicalDetail } from "./AuditTechnicalDetail";

// Sonda (2026-10-25): TraceHeader'a `iz.body` eklemek → 1 kırmızı (gövde sızıntısı).
// Not: ret senaryosu vi.fn değil düz fonksiyonla — vitest, vi.fn'in reddettiği sözü teste yükler.

const RID = "7f3a0000-0000-4000-8000-000000000001";
const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  getIslem.mockReset();
  impl = null;
});

describe("Teknik ayrıntı", () => {
  it("uç, durum, süre, işlem no, cihaz ADI + tür, sürüm ve etkilenen kayıtlar", async () => {
    getIslem.mockResolvedValue({
      success: true,
      data: {
        requestId: RID,
        user: null,
        anlati: { metin: "x", parcalar: [] },
        iz: {
          id: RID, deviceLocalId: "abc", clientType: "desktop", appVersion: "1.6.7", method: "POST",
          routeKey: "/api/shipping/shipments/:id/dispatch", status: 200, durationMs: 184, errorCode: null,
          auditCount: 2, createdAt: "2026-10-25T10:00:00Z", ip: "192.168.1.42", cihazAdi: "Sevkiyat PC",
          // Sonda yükü: sunucu bir gün bunları gönderse bile ÇİZİLMEZ (alanlar tek tek seçilir).
          body: "GOVDE_SIZINTISI", password: "PAROLA_SIZINTISI", headers: { authorization: "Bearer SIZINTI" },
        },
        kayitlar: [
          {
            id: "l1", tableName: "SHIPMENT", modul: "Sevkiyat", recordId: "r1", action: "UPDATE", olay: null,
            anlati: { metin: "a", parcalar: [{ t: "kayit", text: "SV-2026-0311", ref: { table: "SHIPMENT", id: "r1" } }] },
            changes: [{ field: "status", old: "PREPARING", new: "SHIPPED" }],
          },
        ],
        ham: [{ id: "l1", tableName: "SHIPMENT" }],
      },
    });
    const { container } = wrap(<AuditTechnicalDetail requestId={RID} defaultOpen />);
    await waitFor(() => expect(screen.getByText("/api/shipping/shipments/:id/dispatch")).toBeTruthy());
    expect(screen.getByText("POST")).toBeTruthy();
    expect(screen.getByText("184 ms")).toBeTruthy();
    expect(screen.getByText(/İşlem no 7f3a0000/)).toBeTruthy();
    expect(screen.getByText(/Sevkiyat PC \(Masaüstü\) · Sürüm 1\.6\.7 · 192\.168\.1\.42/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "SV-2026-0311" })).toBeTruthy();
    expect(screen.getByText("Sevkiyat")).toBeTruthy();
    // GÖVDE / PAROLA / BAŞLIK hiçbir yerde (ham veri dahil) yok.
    expect(container.textContent).not.toMatch(/SIZINTISI|SIZINTI/);
  });

  it("işlem ucu yoksa (eski backend 404) yalnız audit alanları + ham veri", async () => {
    impl = () => Promise.reject(Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } }));
    wrap(
      <AuditTechnicalDetail requestId={RID} defaultOpen fallback={<div>AUDIT ALANLARI</div>} rawFallback={<div>HAM BLOK</div>} />,
    );
    await waitFor(() => expect(screen.getByText("AUDIT ALANLARI")).toBeTruthy());
    expect(screen.getByText(/istek izi yok/)).toBeTruthy();
    expect(screen.getByText("Ham veri (adli inceleme)")).toBeTruthy();
  });

  it("kapalıyken sunucuya gitmez (katlı = tembel)", () => {
    wrap(<AuditTechnicalDetail requestId={RID} />);
    expect(getIslem).not.toHaveBeenCalled();
  });
});
