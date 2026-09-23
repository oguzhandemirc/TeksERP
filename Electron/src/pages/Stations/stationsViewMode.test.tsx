// =============================================================================
// BEKÇİ — İstasyonlar görünüm tercihi: varsayılan LİSTE · ikonla geçiş · cihaza kalıcı (sahte depo) ·
// iki görünüm aynı süzülmüş kümeden (kullanıcı isteği #3, 2026-09-16)
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { StationKind, StationType } from "@/types/enums";
import { DEFAULT_STATIONS_VIEW_MODE, STATIONS_VIEW_MODE_KEY, readStationsViewMode, useStationsViewMode, writeStationsViewMode } from "./stationsViewMode";
import { StationsViewToggle } from "./StationsViewToggle";
import { buildStationMachineRows } from "./stationMachineRows";
import { StationListView } from "./StationListView";
import { visibleStationKinds } from "./visibleStationKinds";
import type { Station } from "./types";
import type { Machine } from "@/pages/Machines/types";

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

const station = (over: Partial<Station>): Station =>
  ({ id: "s1", code: "IST1", name: "İstasyon", type: StationType.INTERNAL, kind: StationKind.RAW_QC, department: null, isActive: true, appliesColor: false, appliesProperty: false, appliesQuality: false, producesWarpBeam: false, consumesWarpBeam: false, ...over }) as Station;
const machine = (id: string, stationId: string): Machine => ({ id, code: id, name: `Makine ${id}`, stationId, isActive: true }) as unknown as Machine;

describe("Görünüm tercihi", () => {
  it("⭐ varsayılan LİSTE — depo boş, bozuk ya da erişilemez", () => {
    expect(DEFAULT_STATIONS_VIEW_MODE).toBe("list");
    expect(readStationsViewMode(fakeStorage())).toBe("list");
    expect(readStationsViewMode(fakeStorage({ [STATIONS_VIEW_MODE_KEY]: "saçma" }))).toBe("list");
    expect(readStationsViewMode({ getItem: () => { throw new Error("gizli mod"); }, setItem: () => {} })).toBe("list");
    expect(readStationsViewMode(null)).toBe("list");
  });

  it("⭐ tercih cihaza yazılır ve geri okunur (sunucu değil, `stations.viewMode`)", () => {
    const st = fakeStorage();
    writeStationsViewMode("cards", st);
    expect(st.map.get("stations.viewMode")).toBe("cards");
    expect(readStationsViewMode(st)).toBe("cards");
  });

  it("hook: ilk değer depodan, set yazar", () => {
    localStorage.setItem(STATIONS_VIEW_MODE_KEY, "cards");
    const { result } = renderHook(() => useStationsViewMode());
    expect(result.current[0]).toBe("cards");
    act(() => result.current[1]("list"));
    expect(result.current[0]).toBe("list");
    expect(localStorage.getItem(STATIONS_VIEW_MODE_KEY)).toBe("list");
    localStorage.removeItem(STATIONS_VIEW_MODE_KEY);
  });

  it("⭐ ikon çifti: basılı olan aria-pressed, tıklama geçişi çağırır; etiketler Türkçe", async () => {
    const onChange = vi.fn();
    renderWithProviders(<StationsViewToggle mode="list" onChange={onChange} />);
    const liste = screen.getByRole("button", { name: "Liste görünümü" });
    const kart = screen.getByRole("button", { name: "Kart görünümü" });
    expect(liste).toHaveAttribute("aria-pressed", "true");
    expect(kart).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(kart);
    expect(onChange).toHaveBeenCalledWith("cards");
  });
});

describe("Liste görünümü — kart ve dosya ile aynı küme", () => {
  it("⭐ satır = makine, makinesiz istasyon tek satır; süzülmüş küme form enum'uyla aynı (#2 bekçisi)", () => {
    const s1 = station({ id: "s1", name: "KK1", kind: StationKind.RAW_QC });
    const s2 = station({ id: "s2", name: "Tezgah", kind: StationKind.WEAVING, consumesWarpBeam: true });
    const s3 = station({ id: "s3", name: "Sevk", kind: StationKind.SHIPPING });
    const stations = [s1, s2, s3].filter((s) => visibleStationKinds({ dokumaEnabled: true, devereEnabled: true }).includes(s.kind));
    expect(stations).toHaveLength(3);
    const rows = buildStationMachineRows(stations, new Map([["s2", [machine("m1", "s2"), machine("m2", "s2")]]]), new Map(), new Map());
    expect(rows.map((r) => `${r.station.id}:${r.machine?.id ?? "-"}`)).toEqual(["s1:-", "s2:m1", "s2:m2", "s3:-"]);
    renderWithProviders(<StationListView rows={rows} canWrite onEditStation={() => {}} onAddMachine={() => {}} machine={{ onEdit: () => {}, onQr: () => {}, onDeactivate: () => {}, onReactivate: () => {}, onDelete: () => {} }} />);
    expect(screen.getAllByRole("row")).toHaveLength(1 + rows.length);
    expect(screen.getByText("Makine m1")).toBeInTheDocument();
    expect(screen.getAllByText("Levent tüketir")).toHaveLength(2); // tezgahın iki makine satırı — istasyon sütunları tekrarlanır
    expect(screen.getAllByText("Makine yok")).toHaveLength(2);
    expect(screen.getAllByTitle("Düzenle")).toHaveLength(2);
  });

  it("⭐ K22: istasyon KODU listede görünür (formda doğan kimlik listede de görünür)", () => {
    const s1 = station({ id: "s1", name: "KK1", code: "IST2309260007" });
    const rows = buildStationMachineRows([s1], new Map(), new Map(), new Map());
    renderWithProviders(<StationListView rows={rows} canWrite onEditStation={() => {}} onAddMachine={() => {}} machine={{ onEdit: () => {}, onQr: () => {}, onDeactivate: () => {}, onReactivate: () => {}, onDelete: () => {} }} />);
    expect(screen.getByText("IST2309260007")).toBeInTheDocument();
  });
});
