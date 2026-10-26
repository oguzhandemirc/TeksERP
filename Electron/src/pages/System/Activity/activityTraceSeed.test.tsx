import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// "İz sür" sözleşmesi: kartın gönderdiği sekme state'i Etkinlik akışını
// SUNUCU aramasıyla (q) açar ve arama kutusu numarayı gösterir.
const feed = vi.fn(async (_p: unknown) => ({ success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } }));
vi.mock("@/services/systemLogService", () => ({
  systemLogService: {
    feed: (p: unknown) => feed(p),
    tables: async () => ({ success: true, data: [] }),
    users: async () => ({ success: true, data: [] }),
  },
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasAnyPermission: () => true }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("@/pages/Reports/_v2/RelocatedTools", () => ({ RelocatedToolStrip: () => null }));

import { ActivityPage } from "./ActivityPage";
import { activityTraceTarget } from "@/components/audit/TraceLink";

describe("Etkinlik — İz sür tohumu", () => {
  it("kartın state'i q aramasıyla açar, kutu numarayı gösterir", async () => {
    const target = activityTraceTarget("T-0148");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[{ pathname: target.to, state: target.state }]}>
          <ActivityPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(feed).toHaveBeenCalledWith(expect.objectContaining({ q: "T-0148" })),
    );
    expect((screen.getByLabelText("Kayıt numarasıyla ara") as HTMLInputElement).value).toBe("T-0148");
  });
});
