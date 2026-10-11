// "İş ver" / "İşi değiştir" penceresi (tasarım TEZGAH-SALONU-SECIM-IS-VERME §C): iş seçici modal içinde liste,
// "iş zorunlu" ayarında numune seçeneği yok, hat sorusu yalnız çok hatlı tezgahta, önizleme her tezgah adıyla,
// işareti kaldırılan satır gövdede yok, sonuç Başladı/Olmadı + yalnız başarısızları yeniden önizler,
// belirsiz hatada satır token'ı yapışır (kesin 4xx'te yenilenir).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LiveLoom } from "../types";
import type { BulkPreviewRow } from "./runService";

const api = vi.hoisted(() => ({ context: vi.fn(), preview: vi.fn(), assign: vi.fn(), finish: vi.fn(), revoke: vi.fn() }));
vi.mock("./runService", () => ({ runService: api }));

import { AssignJobDialog } from "./AssignJobDialog";

const loom = (id: string, lines = 1): LiveLoom => ({ id, code: `T-${id}`, lines, openRuns: [] }) as unknown as LiveLoom;
const JOB = { id: "w1", weavingOrderNumber: "DI-001", status: "PLANNED", plannedM: 500, item: { id: "i", code: "K1", name: "Pamuk Saten" }, warpSpec: null };
const row = (machineId: string, outcome: BulkPreviewRow["outcome"], p: Partial<BulkPreviewRow> = {}): BulkPreviewRow => ({
  machineId,
  productionLineNo: 1,
  machineCode: `T-${machineId}`,
  machineName: `Tezgah ${machineId.toUpperCase()}`,
  productionLineCount: 1,
  current: null,
  outcome,
  defaultSelected: outcome === "START",
  warnings: [],
  block: null,
  ...p,
});
const OLD = { id: "r-old", weavingOrderId: "w0", weavingOrderNumber: "DI-000", startedAt: "2026-10-10T08:00:00.000Z" };

function open(looms: LiveLoom[], p: { mode?: "assign" | "replace"; online?: boolean } = {}) {
  return renderWithProviders(<AssignJobDialog open onOpenChange={() => undefined} looms={looms} mode={p.mode ?? "assign"} online={p.online ?? true} />);
}

async function toPreview() {
  fireEvent.click(await screen.findByRole("radio", { name: /DI-001/ }));
  fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
  return screen.findByRole("table", { name: "Etkilenecek tezgahlar" });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.context.mockResolvedValue({ weavingOrders: [JOB], weavingOrderRequired: false });
  api.preview.mockImplementation(({ targets }: { targets: Array<{ machineId: string; productionLineNo: number }> }) =>
    Promise.resolve({
      action: "ASSIGN",
      weavingOrder: { id: "w1", weavingOrderNumber: "DI-001" },
      rows: targets.map((t) => (t.machineId === "b" ? row("b", "REPLACE", { current: OLD }) : row(t.machineId, "START", { productionLineNo: t.productionLineNo }))),
    }),
  );
});

describe("AssignJobDialog", () => {
  it("⭐ iş seçici pencere içinde liste; 'iş zorunlu' kapalıyken numune seçeneği VAR", async () => {
    open([loom("a")]);
    const list = await screen.findByRole("radiogroup", { name: "Dokuma İş Emri" });
    expect(within(list).getByRole("radio", { name: /DI-001/ })).toBeTruthy();
    expect(within(list).getByRole("radio", { name: /İşsiz \(numune\)/ })).toBeTruthy();
  });

  it("⭐ C.17 'iş zorunlu' ayarı açıkken numune seçeneği ÇİZİLMEZ", async () => {
    api.context.mockResolvedValue({ weavingOrders: [JOB], weavingOrderRequired: true });
    open([loom("a")]);
    const list = await screen.findByRole("radiogroup", { name: "Dokuma İş Emri" });
    expect(within(list).queryByRole("radio", { name: /numune/ })).toBeNull();
  });

  it("⭐ hat sorusu yalnız çok hatlı tezgahta; seçilen hat önizleme isteğine gider", async () => {
    const { unmount } = open([loom("a")]);
    await screen.findByRole("radiogroup", { name: "Dokuma İş Emri" });
    expect(screen.queryByRole("radiogroup", { name: "Hat" })).toBeNull();
    unmount();
    open([loom("a"), loom("c", 2)]);
    await screen.findByRole("radiogroup", { name: "Dokuma İş Emri" });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Hat" })).getByRole("radio", { name: "2. hat" }));
    await toPreview();
    expect(api.preview).toHaveBeenCalledWith({
      action: "ASSIGN",
      weavingOrderId: "w1",
      targets: [
        { machineId: "a", productionLineNo: 1 },
        { machineId: "c", productionLineNo: 2 },
      ],
    });
  });

});

describe("AssignJobDialog — önizleme ve gönderim", () => {
  it("⭐ C.11 önizleme her tezgahı ADIYLA listeler; İş ver'de dolu hat işaretsiz, İşi değiştir'de işaretli", async () => {
    const { unmount } = open([loom("a"), loom("b")]);
    const table = await toPreview();
    expect(within(table).getByText("Tezgah A")).toBeTruthy();
    expect(within(table).getByText("Tezgah B")).toBeTruthy();
    expect(within(table).getByText("DI-000")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "T-b 1. hat" }).getAttribute("aria-checked")).toBe("false");
    unmount();
    open([loom("a"), loom("b")], { mode: "replace" });
    await toPreview();
    expect(screen.getByRole("checkbox", { name: "T-b 1. hat" }).getAttribute("aria-checked")).toBe("true");
  });

  it("⭐ C.3 işareti kaldırılan satır gövdede YOK; işaretlenen dolu hat replaceRunId ile gider", async () => {
    api.assign.mockResolvedValue({ requested: 1, ok: [], failed: [] });
    open([loom("a"), loom("b")]);
    await toPreview();
    fireEvent.click(screen.getByRole("checkbox", { name: "T-a 1. hat" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "T-b 1. hat" }));
    fireEvent.click(screen.getByRole("button", { name: /Başlat \(1 tezgah\)/ }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledTimes(1));
    const body = api.assign.mock.calls[0]![0];
    expect(body.weavingOrderId).toBe("w1");
    expect(body.rows).toEqual([{ machineId: "b", productionLineNo: 1, clientToken: expect.any(String), replaceRunId: "r-old" }]);
  });

  it("⭐ C.7 sonuç Başladı/Olmadı adıyla; 'Olmayanları yeniden dene' YALNIZ başarısızları yeniden önizler", async () => {
    api.assign.mockResolvedValue({
      requested: 2,
      ok: [{ machineId: "a", productionLineNo: 1, machineCode: "T-a", runId: "r1" }],
      failed: [{ machineId: "c", productionLineNo: 1, machineCode: "T-c", code: "MACHINE_INACTIVE", message: "Tezgah pasif" }],
    });
    open([loom("a"), loom("c")]);
    await toPreview();
    fireEvent.click(screen.getByRole("button", { name: /Başlat/ }));
    const ok = await screen.findByRole("region", { name: "Başladı" });
    expect(within(ok).getByText("T-a")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Olmadı" })).getByText(/Tezgah pasif/)).toBeTruthy();
    api.preview.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Olmayanları yeniden dene" }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
    expect(api.preview.mock.calls[0]![0].targets).toEqual([{ machineId: "c", productionLineNo: 1 }]);
  });

  it("⭐ C.12 ağ hatasında aynı token yeniden gider; kesin 4xx'ten sonra yeni token", async () => {
    api.assign.mockRejectedValueOnce(new Error("Network Error")).mockRejectedValueOnce({ response: { status: 409, data: {} } }).mockResolvedValue({ requested: 1, ok: [], failed: [] });
    open([loom("a")]);
    await toPreview();
    const send = () => fireEvent.click(screen.getByRole("button", { name: /Başlat/ }));
    send();
    await screen.findByRole("alert");
    send();
    await waitFor(() => expect(api.assign).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /Başlat/ }).hasAttribute("disabled")).toBe(false));
    send();
    await waitFor(() => expect(api.assign).toHaveBeenCalledTimes(3));
    const tok = (i: number) => api.assign.mock.calls[i]![0].rows[0].clientToken;
    expect(tok(1)).toBe(tok(0));
    expect(tok(2)).not.toBe(tok(1));
  });

  it("⭐ C.15 bağlantı yokken önizleme/gönderim pasif ve söylenir", async () => {
    open([loom("a")], { online: false });
    fireEvent.click(await screen.findByRole("radio", { name: /DI-001/ }));
    expect(screen.getByRole("button", { name: "Önizle" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Sunucuya ulaşılamıyor/)).toBeTruthy();
  });
});
