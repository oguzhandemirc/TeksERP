// Toplu duruş penceresi (tasarım F2, D18a–f): "Şimdi" varsayılan, "Daha önce" saati önizlemeye ve isteğe gider, sebep
// pencere içinde listeden BİR KEZ seçilir ve her satıra gider, işareti kaldırılan satır istekte yok, geri almada gerekçe
// boşken gönderim pasif, belirsiz hatada AYNI token + AYNI saat, kesin 4xx'te yeni token, sonuç Oldu/Olmadı adıyla.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { formatFactory } from "@/lib/factory-time";
import type { LiveLoom } from "../types";
import type { BulkStopPreviewRow } from "./stopService";

const api = vi.hoisted(() => ({ preview: vi.fn(), open: vi.fn(), close: vi.fn(), revoke: vi.fn(), classifyPreview: vi.fn(), classify: vi.fn() }));
vi.mock("./stopService", () => ({ stopService: api }));
vi.mock("@/pages/Operations/MachineStops/useStopReasonPresets", () => ({
  useStopReasonPresets: () => ({
    active: [
      { code: "ELEKTRIK", label: "Elektrik kesintisi" },
      { code: "PLANLI_BAKIM", label: "Planlı bakım" },
    ],
    labelOf: (c: string | null) => c ?? "—",
    isLoading: false,
  }),
}));

import { StopBulkDialog, type StopDialogMode } from "./StopBulkDialog";

const loom = (id: string): LiveLoom => ({ id, code: `T-${id}`, openStop: null }) as unknown as LiveLoom;
const STOP = { id: "s-x", startedAt: "2026-10-12T06:00:00.000Z", reasonCode: null };
const row = (machineId: string, outcome: BulkStopPreviewRow["outcome"], p: Partial<BulkStopPreviewRow> = {}): BulkStopPreviewRow => ({
  machineId,
  machineCode: `T-${machineId}`,
  machineName: `Tezgah ${machineId.toUpperCase()}`,
  current: null,
  outcome,
  defaultSelected: outcome !== "BLOCKED",
  block: outcome === "BLOCKED" ? { code: "STOP_ALREADY_OPEN", message: "Tezgah zaten duruşta — önce açık duruşu kapatın." } : null,
  ...p,
});
const OK = (ids: string[]) => ({ requested: ids.length, ok: ids.map((id) => ({ machineId: id, machineCode: `T-${id}`, stopId: `s-${id}`, replayed: false, warnings: [] })), failed: [] });
const LOOMS = [loom("a"), loom("b"), loom("c")];

function show(mode: StopDialogMode, p: { online?: boolean } = {}) {
  return renderWithProviders(<StopBulkDialog open mode={mode} looms={LOOMS} online={p.online ?? true} onOpenChange={() => undefined} />);
}
const submit = (re: RegExp) => screen.getByRole("button", { name: re });
const toPreview = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
  return screen.findByRole("table", { name: "Etkilenecek tezgahlar" });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.preview.mockImplementation(({ action, machineIds }: { action: string; machineIds: string[] }) =>
    Promise.resolve({
      action,
      at: null,
      rows: machineIds.map((id) =>
        action === "OPEN" ? (id === "c" ? row("c", "BLOCKED", { current: STOP }) : row(id, "OPEN")) : row(id, action as "CLOSE", { current: { ...STOP, id: `s-${id}` } }),
      ),
    }),
  );
  api.open.mockImplementation(({ rows }: { rows: Array<{ machineId: string }> }) => Promise.resolve(OK(rows.map((r) => r.machineId))));
  api.close.mockImplementation(({ rows }: { rows: Array<{ stopId: string }> }) => Promise.resolve(OK(rows.map((r) => r.stopId.slice(2)))));
  api.revoke.mockImplementation(({ rows }: { rows: Array<{ stopId: string }> }) => Promise.resolve(OK(rows.map((r) => r.stopId.slice(2)))));
});

describe("StopBulkDialog — Duruş bildir", () => {
  it("⭐ başlangıç 'Şimdi' varsayılan; önizleme her tezgahı adıyla listeler, zaten duruşta olan işaretsiz ve sebebiyle", async () => {
    show("open");
    expect(screen.getByRole("radio", { name: "Şimdi" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByLabelText("Başlangıç — saat")).toBeNull();
    const table = await toPreview();
    expect(api.preview).toHaveBeenCalledWith({ action: "OPEN", machineIds: ["a", "b", "c"], at: null });
    for (const n of ["Tezgah A", "Tezgah B", "Tezgah C"]) expect(within(table).getByText(n)).toBeTruthy();
    expect(within(table).getByText(/zaten duruşta/)).toBeTruthy();
    expect((within(table).getByRole("checkbox", { name: "T-c" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("⭐ sebep pencere içinde listeden BİR KEZ seçilir ve istekte tek kod; işareti kaldırılan satır istekte YOK", async () => {
    show("open");
    const list = screen.getByRole("radiogroup", { name: "Duruş sebebi" });
    expect(within(list).getByRole("radio", { name: "Sebep sonra girilecek" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(list).getByRole("radio", { name: "Elektrik kesintisi" }));
    await toPreview();
    fireEvent.click(screen.getByRole("checkbox", { name: "T-b" }));
    fireEvent.click(submit(/Duruş aç \(1 tezgah\)/));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
    const body = api.open.mock.calls[0]![0] as { reasonCode: string; rows: Array<{ machineId: string }>; startedAt: string };
    expect(body.reasonCode).toBe("ELEKTRIK");
    expect(body.rows.map((r) => r.machineId)).toEqual(["a"]);
    expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false);
  });

  it("⭐ 'Daha önce' seçilince saat önizlemeye ve isteğe AYNEN gider", async () => {
    show("open");
    fireEvent.click(screen.getByRole("radio", { name: "Daha önce" }));
    fireEvent.change(screen.getByLabelText("Başlangıç — saat"), { target: { value: "05:30" } });
    await toPreview();
    const at = (api.preview.mock.calls[0]![0] as { at: string | null }).at;
    expect(at && formatFactory(at, "HH:mm")).toBe("05:30");
    fireEvent.click(submit(/Duruş aç/));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
    expect((api.open.mock.calls[0]![0] as { startedAt: string }).startedAt).toBe(at);
  });

  it("⭐ ağ hatası → ikinci gönderim AYNI token + AYNI saat; kesin 4xx → YENİ token", async () => {
    api.open.mockRejectedValueOnce(new Error("Network Error")).mockRejectedValueOnce({ response: { status: 409 } });
    show("open");
    await toPreview();
    const send = async (n: number) => {
      await waitFor(() => expect((submit(/Duruş aç/) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(submit(/Duruş aç/));
      await waitFor(() => expect(api.open).toHaveBeenCalledTimes(n));
      return api.open.mock.calls[n - 1]![0] as { startedAt: string; rows: Array<{ clientToken: string }> };
    };
    const first = await send(1);
    const second = await send(2);
    expect(second.rows.map((r) => r.clientToken)).toEqual(first.rows.map((r) => r.clientToken));
    expect(second.startedAt).toBe(first.startedAt);
    const third = await send(3);
    expect(third.rows[0]!.clientToken).not.toBe(first.rows[0]!.clientToken);
  });

  it("⭐ kısmi başarı: Oldu ve Olmadı listeleri tezgah adıyla; 'Olmayanları yeniden dene' yalnız başarısızları önizler", async () => {
    api.open.mockResolvedValueOnce({ requested: 2, ok: OK(["a"]).ok, failed: [{ machineId: "b", machineCode: "T-b", code: "SHIFT_SEALED", message: "Vardiya mühürlü." }] });
    show("open");
    await toPreview();
    fireEvent.click(submit(/Duruş aç/));
    expect(within(await screen.findByRole("region", { name: "Duruşa geçti" })).getByText("T-a")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Olmadı" })).getByText(/Vardiya mühürlü/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Olmayanları yeniden dene" }));
    await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith({ action: "OPEN", machineIds: ["b"], at: null }));
  });

  it("bağlantı yokken Önizle pasif", () => {
    show("open", { online: false });
    expect((screen.getByRole("button", { name: "Önizle" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("StopBulkDialog — Hepsi çalıştı / geri al", () => {
  it("⭐ 'Hepsi çalıştı' açılışta önizler; işareti kaldırılan duruş istekte YOK", async () => {
    show("close");
    await screen.findByRole("table", { name: "Etkilenecek tezgahlar" });
    expect(api.preview).toHaveBeenCalledWith({ action: "CLOSE", machineIds: ["a", "b", "c"], at: null });
    fireEvent.click(screen.getByRole("checkbox", { name: "T-c" }));
    fireEvent.click(submit(/Duruşları kapat \(2 tezgah\)/));
    await waitFor(() => expect(api.close).toHaveBeenCalledTimes(1));
    expect((api.close.mock.calls[0]![0] as { rows: unknown }).rows).toEqual([{ stopId: "s-a" }, { stopId: "s-b" }]);
  });

  it("⭐ geri al: gerekçe boş/kısa → gönderim pasif; gerekçe bir kez, her satıra", async () => {
    show("revoke");
    await screen.findByRole("table", { name: "Etkilenecek tezgahlar" });
    expect((submit(/Geri al \(3 tezgah\)/) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Geri alma gerekçesi"), { target: { value: " a " } });
    expect((submit(/Geri al/) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Geri alma gerekçesi"), { target: { value: "yanlış tezgahlar" } });
    fireEvent.click(submit(/Geri al/));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith({ reason: "yanlış tezgahlar", rows: [{ stopId: "s-a" }, { stopId: "s-b" }, { stopId: "s-c" }] }));
  });
});

describe("StopBulkDialog — Sebep ata", () => {
  beforeEach(() => {
    api.classifyPreview.mockImplementation(({ machineIds }: { machineIds: string[] }) =>
      Promise.resolve({
        action: "CLASSIFY",
        at: null,
        rows: machineIds.map((id) =>
          id === "c"
            ? row("c", "BLOCKED", { current: { ...STOP, id: "s-c", reasonCode: "ELEKTRIK" }, block: { code: "STOP_ALREADY_CLASSIFIED", message: "Açık duruşun sebebi zaten girilmiş." } })
            : row(id, "CLASSIFY", { current: { ...STOP, id: `s-${id}` } }),
        ),
      }),
    );
    api.classify.mockImplementation(({ rows }: { rows: Array<{ stopId: string }> }) => Promise.resolve(OK(rows.map((r) => r.stopId.slice(2)))));
  });

  it("⭐ açılışta KENDİ önizleme ucundan önizler; sebepli satır işaretsiz ve sebebiyle; 'Sebep sonra girilecek' seçeneği YOK", async () => {
    show("classify");
    const table = await screen.findByRole("table", { name: "Etkilenecek tezgahlar" });
    expect(api.classifyPreview).toHaveBeenCalledWith({ machineIds: ["a", "b", "c"] });
    expect(api.preview).not.toHaveBeenCalled();
    expect(within(table).getByText("Açık duruşun sebebi zaten girilmiş.")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "T-c" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("radio", { name: "Sebep sonra girilecek" })).toBeNull();
  });

  it("⭐ sebep seçilmeden gönderim pasif; sebep BİR KEZ, seçili duruşlara", async () => {
    show("classify");
    await screen.findByRole("table", { name: "Etkilenecek tezgahlar" });
    expect((submit(/Sebebi yaz \(2 tezgah\)/) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Planlı bakım" }));
    fireEvent.click(submit(/Sebebi yaz \(2 tezgah\)/));
    await waitFor(() => expect(api.classify).toHaveBeenCalledWith({ reasonCode: "PLANLI_BAKIM", reasonNote: null, rows: [{ stopId: "s-a" }, { stopId: "s-b" }] }));
    expect(await screen.findByText(/Sebep girildi/)).toBeTruthy();
  });
});
