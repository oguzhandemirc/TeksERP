// H4 Metre Sapmaları: liste + özet (süzgeç sunucuya), OFFICE onayı yalnız bekleyen OFFICE satırında,
// bulunabilirlik (karo · palet · modül tablosu), ayarda OFFICE seçeneği.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { MeterDeviationsPage } from "../MeterDeviationsPage";
import { canOfficeAck, fmtDiff, sourceBadge, thresholdText } from "../deviation-labels";
import { deviationParams } from "../service";
import type { MeterDeviationRow } from "../types";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
}));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
}));

const list = vi.fn();
const ack = vi.fn();
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  listMeterDeviations: (...a: unknown[]) => list(...a),
  officeAckMeterReading: (...a: unknown[]) => ack(...a),
}));

const row = (o: Partial<MeterDeviationRow>): MeterDeviationRow => ({
  readingId: "r1", rollId: "t1", barcode: "TOP-001", stepId: "s1", workOrderNumber: "IE-1", machineId: "m1", machineName: "Kurşun 1",
  customerId: "c1", customerName: "Gül Örme", declaredIn: 100, measuredIn: null, baseMeters: 100, outMeters: 103, diffMeters: 3,
  thresholdM: 2, thresholdPct: null, basis: "DECLARED_IN", approvalMode: "OFFICE", source: "MACHINE", status: "PENDING", ack: null,
  createdAt: "2026-10-29T08:00:00Z", ...o,
});
const summary = { total: 3, unsigned: 2, pending: 1, avgDiffMeters: 2.5, avgAbsDiffMeters: 3 };

beforeEach(() => {
  list.mockReset();
  ack.mockReset();
  list.mockResolvedValue({
    success: true,
    data: [
      row({}),
      row({ readingId: "r2", barcode: "TOP-002", approvalMode: "NONE", status: "UNSIGNED", source: "SIMULATED" }),
      row({ readingId: "r3", barcode: "TOP-003", approvalMode: "OPERATOR_REASON", status: "UNSIGNED", basis: "MEASURED_IN", measuredIn: 95, diffMeters: 6 }),
    ],
    pagination: { nextCursor: null, hasMore: false, limit: 50 },
    summary,
  });
  ack.mockResolvedValue({});
});

describe("Metre Sapmaları sayfası", () => {
  it("satırları ve özet şeridini çizer; durum süzgeci SUNUCUYA gider", async () => {
    renderWithProviders(<MeterDeviationsPage />);
    expect(await screen.findByText("TOP-001")).toBeInTheDocument();
    const strip = screen.getByLabelText("Sapma özeti");
    expect(within(strip).getByText("3")).toBeInTheDocument();
    expect(within(strip).getByText("+2,5 m")).toBeInTheDocument();
    expect(screen.getAllByText("İmzasız sapma").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Simüle")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("group", { name: "Durum süzgeci" })).getByText("İmza bekliyor"));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "PENDING" }), null));
  });

  it("Onayla yalnız OFFICE + bekleyen satırda; diyalog sebep metniyle ofis onayını yollar", async () => {
    renderWithProviders(<MeterDeviationsPage />);
    await screen.findByText("TOP-001");
    const buttons = screen.getAllByRole("button", { name: "Onayla" });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0] as HTMLElement);
    await userEvent.type(screen.getByLabelText("Açıklama (isteğe bağlı)"), "kumaş çekti");
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Onayla" }));
    await waitFor(() => expect(ack).toHaveBeenCalledWith("r1", "kumaş çekti"));
  });

  it("hata ile boş liste ayrı ekranlardır", async () => {
    list.mockRejectedValue(new Error("403"));
    renderWithProviders(<MeterDeviationsPage />);
    expect(await screen.findByText("Liste yüklenemedi.")).toBeInTheDocument();
  });
});

describe("saf yardımcılar", () => {
  it("süzgeç → filter[...] parametreleri; boş alan gönderilmez", () => {
    expect(deviationParams({ status: "UNSIGNED", machineId: "m1", customerId: null, from: "2026-10-01", to: "" }, "cur")).toEqual({
      limit: "50", "filter[status]": "UNSIGNED", "filter[machineId]": "m1", "filter[fromDay]": "2026-10-01", cursor: "cur",
    });
  });
  it("Onayla kapısı: OFFICE + PENDING", () => {
    expect(canOfficeAck({ status: "PENDING", approvalMode: "OFFICE" })).toBe(true);
    expect(canOfficeAck({ status: "PENDING", approvalMode: "SUPERVISOR_PIN" })).toBe(false);
    expect(canOfficeAck({ status: "UNSIGNED", approvalMode: "OFFICE" })).toBe(false);
  });
  it("eşik ve fark metni; SIMULATED rozeti ayrışır", () => {
    expect(thresholdText({ thresholdM: 2, thresholdPct: 1 })).toBe("2 m / %1");
    expect(thresholdText({ thresholdM: 0, thresholdPct: null })).toBe("—");
    expect(fmtDiff(-1.5)).toBe("-1,5 m");
    expect(sourceBadge("SIMULATED").label).toBe("Simüle");
    expect(sourceBadge("MACHINE").label).toBe("Makine");
  });
});

describe("bulunabilirlik ve ayar", () => {
  it("karo, palet girişi ve modül tablosu", () => {
    const tile = operationsTiles.find((t) => t.to === "/operations/kursun-sapmalar");
    expect(tile?.permission).toBe("kursun:meter-approve");
    expect(tile?.visibleWhen?.({ productionEnabled: false } as never)).toBe(false);
    expect(allCommandEntries.some((e) => e.to === "/operations/kursun-sapmalar")).toBe(true);
    expect(ROUTE_MODULE["operations/kursun-sapmalar"]).toBe("productionEnabled");
  });
  it("onay kipi ayarında OFFICE seçeneği var", () => {
    const flag = SETTINGS_CATEGORIES.flatMap((c) => c.enumFlags ?? []).find((f) => f.enumKey === "kursunMeterVarianceApproval");
    expect(flag?.options.map((o) => o.value)).toEqual(["NONE", "OPERATOR_REASON", "SUPERVISOR_PIN", "OFFICE"]);
  });
});
