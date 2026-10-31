// D4-KUC3a — İçerideki İşler / WIP karnesinde emanet sahibi süzgeci: seçilen müşteri istek parametresi
// `ownerCustomerId` olarak SUNUCUYA gider (istemci satır süzmez); izin/modül yoksa seçici ve parametre yok.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { buildWipExport, wipQueryParams, type WipScorecard } from "./wipScorecard";

const getReport = vi.fn();
vi.mock("../_services/reportsClient", () => ({ reportsClient: { get: (...a: unknown[]) => getReport(...a) } }));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
let emanet = true;
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { emanetEnabled: emanet } } }) }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange("cust-1")}>Sahip seç</button>
  ),
}));
vi.mock("../_hooks/useReportDateRange", () => ({
  useReportDateRange: () => ({ params: { dateFrom: "2026-10-01", dateTo: "2026-10-31" }, dateFrom: "2026-10-01", dateTo: "2026-10-31" }),
}));
vi.mock("../_components", () => ({
  ReportPageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReportExportBar: () => null,
  MetricCard: () => null,
  DetailTable: () => null,
}));

const { WipScorecardPage } = await import("./WipScorecardPage");

const EMPTY: WipScorecard = {
  summary: { waitingCount: 0, waitingQty: 0, oldestDays: null, avgWaitDays: null, neverStartedWorkOrders: 0, neverStartedOldestDays: null, passedCount: 0 },
  byStation: [], oldestWaiting: [], neverStarted: [],
};

beforeEach(() => {
  getReport.mockReset();
  getReport.mockResolvedValue({ success: true, data: EMPTY });
  perms = ["customer:read"];
  emanet = true;
});

describe("WIP emanet sahibi süzgeci", () => {
  it("parametre: sahip seçilince ownerCustomerId, seçilmezse hiç yok", () => {
    expect(wipQueryParams({ dateFrom: "a", dateTo: "b" }, "c1")).toEqual({ dateFrom: "a", dateTo: "b", ownerCustomerId: "c1" });
    expect(wipQueryParams({ dateFrom: "a", dateTo: "b" }, null).ownerCustomerId).toBeUndefined();
  });

  it("sahip seçilince istek ownerCustomerId ile yeniden atılır (süzme sunucuda)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WipScorecardPage />);
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(1));
    expect(getReport.mock.calls[0]![1]).not.toHaveProperty("ownerCustomerId", expect.anything());
    await user.click(screen.getByRole("button", { name: "Sahip seç" }));
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(2));
    expect(getReport.mock.calls[1]![0]).toBe("production/wip");
    expect(getReport.mock.calls[1]![1]).toMatchObject({ ownerCustomerId: "cust-1" });
    expect(screen.getByText(/Hiç başlamamış iş emirleri bu süzgeçten etkilenmez/)).toBeInTheDocument();
  });

  it("customer:read yoksa ya da emanet kapalıysa seçici görünmez", async () => {
    perms = [];
    const { unmount } = renderWithProviders(<WipScorecardPage />);
    await waitFor(() => expect(getReport).toHaveBeenCalled());
    expect(screen.queryByTestId("wip-owner-filter")).toBeNull();
    unmount();
    perms = ["customer:read"];
    emanet = false;
    renderWithProviders(<WipScorecardPage />);
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("wip-owner-filter")).toBeNull();
  });

  it("dışa aktarımda süzgeç meta satırı olarak söylenir", () => {
    expect(buildWipExport({ sc: EMPTY, periodLabel: "x", ownerFiltered: true }).meta?.join(" ")).toMatch(/sahip süzgeci/);
    expect(buildWipExport({ sc: EMPTY, periodLabel: "x" }).meta?.join(" ")).not.toMatch(/sahip süzgeci/);
  });
});
