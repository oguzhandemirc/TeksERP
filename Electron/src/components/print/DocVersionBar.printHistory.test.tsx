import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrintedDocument } from "@/services/printedDocumentService";

// İzin kümesi testte açık/kapalı çevrilir; geçmiş listesi ağ istemez.
const izin = vi.hoisted(() => ({ var: true }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: () => izin.var,
    hasAnyPermission: () => izin.var,
    hasAllPermissions: () => izin.var,
  }),
}));
vi.mock("@/services/printedDocumentService", () => ({
  printedDocumentService: { listVersions: vi.fn(async () => []), reissue: vi.fn() },
}));

import { DocVersionBar } from "./DocVersionBar";

const DOC_ID = "3f0c2a1e-8b7d-4c6a-9e5f-1a2b3c4d5e6f";
const belge = {
  id: DOC_ID,
  docType: "SEVK_IRSALIYESI",
  sourceId: "0b8e7d6c-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  version: 2,
  status: "ACTIVE",
  documentNo: "SI-2026-0001",
  snapshot: { frozenAt: "2026-10-25T08:00:00.000Z" },
  reissueReason: null,
  supersededAt: null,
  voidedAt: null,
  voidReason: null,
  reconstructed: false,
  printedById: null,
  createdAt: "2026-10-25T08:00:00.000Z",
  updatedAt: "2026-10-25T08:00:00.000Z",
} as unknown as PrintedDocument<unknown>;

function ciz() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DocVersionBar
          docType={belge.docType}
          sourceId={belge.sourceId}
          current={belge}
          activeVersion={2}
          onSelectVersion={() => {}}
          canReissue={false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DocVersionBar — Baskı geçmişi bağlantısı (A3)", () => {
  it("belge sürümünün kimliğiyle önceden süzülmüş baskı geçmişine gider", () => {
    izin.var = true;
    ciz();
    const link = screen.getByTestId("print-history-link");
    expect(link.textContent).toContain("Baskı geçmişi");
    expect(link.getAttribute("href")).toBe(`/system/print-history?subjectId=${DOC_ID}`);
  });

  it("baskı geçmişi izni yoksa bağlantı görünmez (sayfayla aynı izin kümesi)", () => {
    izin.var = false;
    ciz();
    expect(screen.queryByTestId("print-history-link")).toBeNull();
  });
});
