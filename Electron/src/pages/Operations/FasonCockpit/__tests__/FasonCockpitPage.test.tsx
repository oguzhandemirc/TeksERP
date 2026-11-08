// BEKÇİ — Fason Kokpiti (F10 panel yarısı): liste + özet + firma şeridi TEK uçtan; süzgeç sunucuya `filter[...]`
// ile gider; gecikme vurgusu sunucunun `overdueDays`ından; karo ↔ route ↔ backend izni birebir; menüde bulunur.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { renderWithProviders } from "@/test/render";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (<div><h1>{title}</h1>{actions}</div>),
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
}));

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const { FasonCockpitPage, FASON_COCKPIT_PATH, FASON_COCKPIT_PERMISSIONS } = await import("../FasonCockpitPage");
const { cockpitParams } = await import("../service");
const { dueTone, dueText } = await import("../cockpit-labels");
const { operationsTiles } = await import("../../tile-config");

const row = (o: Record<string, unknown>) => ({
  dispatchId: "d1", dispatchNo: "FS-001", subcontractor: { id: "f1", name: "Boyacı A" }, category: { id: "c1", name: "Boyahane" },
  workOrder: { id: "w1", orderNo: "IE-10" }, weavingOrder: null, dispatchedAt: "2026-11-01T08:00:00.000Z",
  expectedReturnAt: "2026-11-05T20:59:59.999Z", overdueDays: 3, dispatchedQty: "500", outstandingQty: "200",
  outstandingRollCount: 2, yarnOutstandingKg: "0", beamOutstandingCount: 0, ...o,
});
const RESULT = {
  data: [row({}), row({ dispatchId: "d2", dispatchNo: "FS-002", overdueDays: null, expectedReturnAt: null, workOrder: null, weavingOrder: { id: "wv", orderNo: "DK-3" }, yarnOutstandingKg: "12.5", beamOutstandingCount: 1 })],
  nextCursor: null,
  summary: {
    openDispatchCount: 2, overdueCount: 1, dueSoonCount: 0, outstandingQty: "400",
    firms: [{ subcontractor: { id: "f1", name: "Boyacı A" }, openDispatchCount: 2, overdueCount: 1, outstandingQty: "400", yarnOutstandingKg: "12.5", beamOutstandingCount: 1 }],
  },
};

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: RESULT });
});

describe("Fason Kokpiti", () => {
  it("⭐ tek uç: liste + özet aynı yanıttan; varsayılan süzgeç parametre göndermez", async () => {
    renderWithProviders(<FasonCockpitPage />);
    await screen.findByText("FS-001");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![0]).toBe("/api/subcontractor/cockpit");
    expect(get.mock.calls[0]![1]).toEqual({ params: { limit: "50" } });
    const strip = screen.getByLabelText("Fason özeti");
    expect(within(strip).getByText("Geciken").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("3 gün gecikti")).toBeInTheDocument();
    expect(screen.getByText("Termin yok")).toBeInTheDocument();
    expect(screen.getByText("12,5 kg iplik · 1 levent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "IE-10" })).toHaveAttribute("href", "/operations/work-orders/w1");
  });

  it("⭐ süzgeç sunucuda: durum düğmesi ve firma çipi `filter[...]` olarak gider", async () => {
    renderWithProviders(<FasonCockpitPage />);
    await screen.findByText("FS-001");
    fireEvent.click(screen.getByRole("button", { name: "Gecikenler" }));
    await waitFor(() => expect(get.mock.calls.at(-1)![1]).toEqual({ params: { limit: "50", "filter[state]": "OVERDUE" } }));
    fireEvent.click(within(screen.getByLabelText("Firma şeridi")).getByRole("button", { pressed: false }));
    await waitFor(() => expect(get.mock.calls.at(-1)![1].params["filter[subcontractorId]"]).toBe("f1"));
  });

  it("hata 'açık sevk yok' gibi gösterilmez", async () => {
    get.mockRejectedValue(new Error("403"));
    renderWithProviders(<FasonCockpitPage />);
    expect(await screen.findByText("Liste yüklenemedi.")).toBeInTheDocument();
  });

  it("gecikme sınıfı sunucu günlerinden", () => {
    expect(dueTone({ overdueDays: 1 })).toBe("overdue");
    expect(dueTone({ overdueDays: 0 })).toBe("soon");
    expect(dueTone({ overdueDays: -2 })).toBe("soon");
    expect(dueTone({ overdueDays: -3 })).toBe("ok");
    expect(dueTone({ overdueDays: null })).toBe("none");
    expect(dueText({ overdueDays: -4 })).toBe("4 gün var");
    expect(cockpitParams({ state: "NO_DUE_DATE", subcontractorId: null, categoryId: "c1" }, "cur")).toEqual({ limit: "50", "filter[state]": "NO_DUE_DATE", "filter[categoryId]": "c1", cursor: "cur" });
  });

  it("⭐ menüde bulunur; karo ↔ route ↔ backend ekran kataloğu izni birebir", () => {
    const tile = operationsTiles.find((t) => t.key === "fason-kokpiti");
    expect(tile).toMatchObject({ to: FASON_COCKPIT_PATH, title: "Fason Kokpiti", permissionAny: FASON_COCKPIT_PERMISSIONS });
    const routes = readFileSync(resolve(process.cwd(), "src/routes/content-routes.tsx"), "utf8");
    expect(routes).toMatch(/path: "operations\/fason-kokpiti",[\s\S]{0,120}requireAnyPermission=\{\["subcontractor:read", "workorder:read"\]\}/);
    const katalog = readFileSync(resolve(process.cwd(), "../Teks-Erp/src/constants/screen-catalog.ts"), "utf8");
    expect(katalog).toContain('key: "operations/fason-kokpiti", app: "desktop", modul: "planlanan:fason", title: "Fason Kokpiti", requires: ["subcontractor:read", "workorder:read"]');
  });
});
