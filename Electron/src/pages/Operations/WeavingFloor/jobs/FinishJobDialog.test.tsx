// "İşi bitir" penceresi: açık koşumlar her tezgah + hat adıyla önizlenir, atkı sayacı satır başına isteğe bağlı
// (boş = ölçülmedi → null, 0 yazılmaz), geçersiz sayaç gönderimi kilitler, işareti kaldırılan koşum gövdede yok.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LiveLoom } from "../types";
import type { BulkPreviewRow } from "./runService";

const api = vi.hoisted(() => ({ context: vi.fn(), preview: vi.fn(), assign: vi.fn(), finish: vi.fn(), revoke: vi.fn() }));
vi.mock("./runService", () => ({ runService: api }));

import { FinishJobDialog, parsePicks } from "./FinishJobDialog";

const run = (id: string, line: number) => ({ id, line, jobId: "w1", jobNo: "DI-1", startedAt: 0 });
const looms = [
  { id: "a", code: "T-a", lines: 2, openRuns: [run("ra1", 1), run("ra2", 2)] },
  { id: "b", code: "T-b", lines: 1, openRuns: [] },
] as unknown as LiveLoom[];
const row = (machineId: string, line: number, runId: string): BulkPreviewRow => ({
  machineId,
  productionLineNo: line,
  machineCode: `T-${machineId}`,
  machineName: `Tezgah ${machineId}`,
  productionLineCount: 2,
  current: { id: runId, weavingOrderId: "w1", weavingOrderNumber: "DI-1", startedAt: "2026-10-10T08:00:00.000Z" },
  outcome: "FINISH",
  defaultSelected: true,
  warnings: [],
  block: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.preview.mockResolvedValue({ action: "FINISH", weavingOrder: null, rows: [row("a", 1, "ra1"), row("a", 2, "ra2")] });
  api.finish.mockResolvedValue({ requested: 1, ok: [], failed: [] });
});

describe("FinishJobDialog", () => {
  it("⭐ açılışta yalnız açık koşumlu hatlar önizlenir (açık koşumsuz tezgah hedef değil)", async () => {
    renderWithProviders(<FinishJobDialog open onOpenChange={() => undefined} looms={looms} online />);
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
    expect(api.preview).toHaveBeenCalledWith({
      action: "FINISH",
      targets: [
        { machineId: "a", productionLineNo: 1 },
        { machineId: "a", productionLineNo: 2 },
      ],
    });
  });

  it("⭐ boş sayaç null gider (0 yazılmaz), işaretsiz koşum gövdede yok", async () => {
    renderWithProviders(<FinishJobDialog open onOpenChange={() => undefined} looms={looms} online />);
    fireEvent.change(await screen.findByLabelText("T-a 1. hat atkı sayacı"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "T-a 2. hat" }));
    fireEvent.click(screen.getByRole("button", { name: /Bitir \(1 koşum\)/ }));
    await waitFor(() => expect(api.finish).toHaveBeenCalledTimes(1));
    expect(api.finish.mock.calls[0]![0]).toEqual({ rows: [{ runId: "ra1", picksAtClose: 1200 }] });
  });

  it("geçersiz sayaç gönderimi kilitler", async () => {
    renderWithProviders(<FinishJobDialog open onOpenChange={() => undefined} looms={looms} online />);
    fireEvent.change(await screen.findByLabelText("T-a 1. hat atkı sayacı"), { target: { value: "12a" } });
    expect(screen.getByRole("button", { name: /Bitir/ }).hasAttribute("disabled")).toBe(true);
  });

  it("parsePicks: boş = ölçülmedi (null), rakam = sayı, geçersiz = undefined", () => {
    expect(parsePicks("")).toBeNull();
    expect(parsePicks(" 42 ")).toBe(42);
    expect(parsePicks("-1")).toBeUndefined();
  });

  it("⭐ C.15 bağlantı yokken önizleme istenmez, gönderim pasif", async () => {
    renderWithProviders(<FinishJobDialog open onOpenChange={() => undefined} looms={looms} online={false} />);
    expect(await screen.findByText(/Sunucuya ulaşılamıyor/)).toBeTruthy();
    expect(api.preview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Bitir/ }).hasAttribute("disabled")).toBe(true);
  });
});
