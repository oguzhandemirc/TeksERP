// Hazır Sebepler › Yeniden işlem ücret sınıfı (fason F9): alan yalnız yeniden işlem sebebinde çizilir;
// kayıtlı sınıf diyaloğa dolar ve PATCH'e gider; başka türde alan YOK ve gövdeye `billable` girmez.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ReasonPreset } from "./service";

const update = vi.fn();
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  reasonPresetService: { update: (...a: unknown[]) => update(...a) },
}));

import { ReasonPresetDialog } from "./ReasonPresetDialog";
import { ReworkBillableBadge, fromReworkBillableChoice, toReworkBillableChoice } from "./ReworkBillableField";

const row = (over: Partial<ReasonPreset> = {}): ReasonPreset => ({
  id: "r1", kind: "WORK_ORDER_REWORK", code: "TON_TUTMADI", label: "Ton tutmadı", fullText: null, requiresText: false,
  sortOrder: 1, isActive: true, isSystem: true, billable: false, ...over,
});

afterEach(() => update.mockReset());

describe("yeniden işlem ücret sınıfı", () => {
  it("seçici ↔ değer dönüşümü üç durumlu (null = belirtilmemiş)", () => {
    for (const v of [true, false, null] as const) expect(fromReworkBillableChoice(toReworkBillableChoice(v))).toBe(v);
    expect(toReworkBillableChoice(undefined)).toBe("");
  });

  it("⭐ yeniden işlem sebebi: kayıtlı 'bizim hatamız' dolar, PATCH'e billable:false gider", async () => {
    update.mockResolvedValue(row());
    renderWithProviders(<ReasonPresetDialog open onOpenChange={() => {}} mode="edit" kind="WORK_ORDER_REWORK" preset={row()} />);
    expect(screen.getByLabelText("Ücret sınıfı")).toHaveTextContent("Bizim hatamız");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![1]).toMatchObject({ billable: false });
  });

  it("başka tür (fire): alan yok, gövdede billable yok", async () => {
    update.mockResolvedValue(row({ kind: "ROLL_SCRAP", billable: null }));
    renderWithProviders(<ReasonPresetDialog open onOpenChange={() => {}} mode="edit" kind="ROLL_SCRAP" preset={row({ kind: "ROLL_SCRAP", billable: null })} />);
    expect(screen.queryByLabelText("Ücret sınıfı")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![1].billable).toBeUndefined();
  });

  it("rozet yalnız sınıflandırılmış satırda", () => {
    const { container, rerender } = renderWithProviders(<ReworkBillableBadge value={null} />);
    expect(container.textContent).toBe("");
    rerender(<ReworkBillableBadge value={false} />);
    expect(screen.getByText(/Bizim hatamız/)).toBeTruthy();
  });
});
