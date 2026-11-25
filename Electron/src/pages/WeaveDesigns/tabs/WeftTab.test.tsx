// =============================================================================
// BEKÇİ — Desen kartı > Atkı raporu (D3/K7): atkı kumaşa aittir, burada SALT OKUNUR.
//   §1 alanlar kilitli, Kaydet yok, PATCH yok · §2 "Üründe aç" kumaşın ürün penceresini ister · §3 ortak kart asıl
//   yeri (Atkı Kartları ekranı) yeni sekmede · §4 kart bağlı değilse yönlendirme + Üründe aç · §5 örnek kod önerisi
//   sunucu sınırlarına kırpılır (ürün penceresi "yalnız bu kumaş için kopya" kullanır)
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
const openTab = vi.hoisted(() => vi.fn());
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));
const { api, construction } = vi.hoisted(() => ({
  construction: { current: { weft: null } as unknown },
  api: { get: vi.fn(), update: vi.fn(), fork: vi.fn() },
}));
vi.mock("../service", () => ({
  weftSpecApi: api,
  constructionApi: { get: () => Promise.resolve(construction.current) },
}));
import { WeftTab } from "./WeftTab";
import { suggestForkCode, suggestForkName } from "./weft-fork-defaults";

const FABRIC = { id: "it-a", code: "D2057", name: "TÜL D2057", weftSpecId: "w-1", weaveDesignId: "wd-1" };
const SPEC = { id: "w-1", code: "ATK-ORTAK", name: "Ortak atkı", picksPerCm: "20", sequenceCode: "A1", weftProgramNo: null, yarns: [{ yarnItemId: "y-a", picksInRepeat: 1, sortOrder: 0 }] };

beforeEach(() => {
  vi.clearAllMocks();
  construction.current = { weft: null };
  api.get.mockResolvedValue(SPEC);
});

describe("WeftTab — desen kartında atkı salt okunur", () => {
  it("§1 ⭐ alanlar kilitli, Kaydet yok, PATCH/kopya yok", async () => {
    renderWithProviders(<WeftTab fabric={FABRIC} onOpenItem={vi.fn()} />);
    expect(await screen.findByLabelText("Atkı raporu")).toBeDisabled();
    expect(screen.getByText("Atkı bu ekranda değiştirilmez")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Örnek al/ })).toBeNull();
    expect(api.update).not.toHaveBeenCalled();
    expect(api.fork).not.toHaveBeenCalled();
  });
  it("§2 ⭐ Üründe aç → kumaşın ürün penceresi istenir", async () => {
    const onOpenItem = vi.fn();
    renderWithProviders(<WeftTab fabric={FABRIC} onOpenItem={onOpenItem} />);
    fireEvent.click(await screen.findByRole("button", { name: /Üründe aç/ }));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
  });
  it("§3 ortak kartın asıl yeri yeni sekmede açılır", async () => {
    renderWithProviders(<WeftTab fabric={FABRIC} />);
    fireEvent.click(await screen.findByRole("button", { name: /Atkı Kartları ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/weft-specs?search=ATK-ORTAK", { forceNew: true }));
  });
  it("§4 atkı kartı bağlı değilse yönlendirme + Üründe aç", async () => {
    renderWithProviders(<WeftTab fabric={{ ...FABRIC, weftSpecId: null }} onOpenItem={vi.fn()} />);
    expect(screen.getByText(/ürün penceresinin Atkı sekmesinden bağlanır/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Üründe aç/ })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it("§5 öneri kod 32 / ad 100 karaktere kırpılır, ad son eki korur", () => {
    expect(suggestForkCode("A".repeat(30), "D2057")).toHaveLength(32);
    const n = suggestForkName("B".repeat(120), "D2057");
    expect(n).toHaveLength(100);
    expect(n.endsWith(" (D2057)")).toBe(true);
  });
});

describe("WeftSpecView — iplik payı % (SY-3 L3)", () => {
  const yarns = [
    { yarnItemId: "y-a", picksInRepeat: 4, sortOrder: 0, sharePct: 66.67 },
    { yarnItemId: "y-b", picksInRepeat: 2, sortOrder: 1, sharePct: 33.33 },
  ];
  it("PICKS: pay sütunu + 'atım sayısına göre' notu", async () => {
    api.get.mockResolvedValue({ ...SPEC, sequenceCode: null, shareBasis: "PICKS", yarns });
    renderWithProviders(<WeftTab fabric={FABRIC} />);
    expect(await screen.findByLabelText("Atkı A pay")).toHaveTextContent("%66,67");
    expect(screen.getByLabelText("Atkı B pay")).toHaveTextContent("%33,33");
    expect(screen.getByText("Pay %")).toBeInTheDocument();
    expect(screen.getByTestId("weft-share-note")).toHaveTextContent("atım sayısına göre");
  });
  it("esas null (ya da eski backend): sütun ve not yok", async () => {
    api.get.mockResolvedValue({ ...SPEC, shareBasis: null, yarns: yarns.map((y) => ({ ...y, sharePct: null })) });
    renderWithProviders(<WeftTab fabric={FABRIC} />);
    await screen.findByText(/Atkı kartı:/);
    expect(screen.queryByLabelText("Atkı A pay")).toBeNull();
    expect(screen.queryByTestId("weft-share-note")).toBeNull();
  });
});

describe("WeftSequenceStrip — atkı seçici görseli (kart görsel B)", () => {
  const yarn = (letter: string, name: string, sortOrder: number) => ({ sortOrder, letter, picksInRepeat: 0, yarnItem: { id: name, code: name, name, linearDensityDen: null }, cardYarnItem: null });
  const WEFT = {
    weftSpecId: "w-1", code: "ATK-ORTAK", name: "Ortak atkı", picksPerCm: "20", sequenceCode: "A2 B1 A2 C1", weftProgramNo: null, picksInRepeatTotal: 6,
    yarns: [yarn("A", "PES 50", 0), yarn("B", "Sim", 1), yarn("C", "Pamuk", 2)],
    pickSequence: [1, 1, 2, 1, 1, 3],
  };
  it("kayıtlı pickSequence'ten seçici + pay özeti çizer", async () => {
    api.get.mockResolvedValue({ ...SPEC, sequenceCode: "A2 B1 A2 C1" });
    construction.current = { weft: WEFT };
    renderWithProviders(<WeftTab fabric={FABRIC} />);
    expect(await screen.findByTestId("weft-pick-summary")).toHaveTextContent("A 4 · B 1 · C 1 = 6 atkı/rapor");
    expect(screen.getByRole("img", { name: "Atkı seçici sütunu" })).toBeInTheDocument();
  });
  it("sıra kodu yoksa çizim yerine yönlendirme", async () => {
    construction.current = { weft: { ...WEFT, sequenceCode: null, pickSequence: null } };
    renderWithProviders(<WeftTab fabric={FABRIC} />);
    expect(await screen.findByText(/atkı seçici burada çizilir/)).toBeInTheDocument();
  });
});
