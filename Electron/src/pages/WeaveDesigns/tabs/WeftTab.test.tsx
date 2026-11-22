// =============================================================================
// BEKÇİ — Atkı sırası sekmesi "Bu desene özel kopya" (SY-P3): §1 kart >1 kumaşta + yazma izni → düğme ·
//   §2 tek kumaşta düğme yok · §3 izin yoksa düğme yok · §4 onay diyaloğu taşınan ve kalan kumaşları
//   listeler, uç kumaş + önerilen kodla çağrılır · §5 öneri sunucu sınırlarına kırpılır
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/production/SpecOpenOrdersNotice", () => ({ SpecOpenOrdersNotice: () => null }));
const { api, countUsers, listUsers, construction } = vi.hoisted(() => ({
  construction: { current: { weft: null } as unknown },
  api: { get: vi.fn(), update: vi.fn(), fork: vi.fn() },
  countUsers: vi.fn(),
  listUsers: vi.fn(),
}));
vi.mock("../service", () => ({
  weftSpecApi: api,
  constructionApi: { get: () => Promise.resolve(construction.current) },
  countWeftSpecUsers: (...a: unknown[]) => countUsers(...a),
  listWeftSpecUsers: (...a: unknown[]) => listUsers(...a),
}));
import { WeftTab } from "./WeftTab";
import { suggestForkCode, suggestForkName } from "./weft-fork-defaults";

const FABRIC = { id: "it-a", code: "D2057", name: "TÜL D2057", weftSpecId: "w-1", weaveDesignId: "wd-1" };
const SPEC = { id: "w-1", code: "ATK-ORTAK", name: "Ortak atkı", picksPerCm: "20", sequenceCode: null, weftProgramNo: null, yarns: [] };
const BUTTON = /Bu desene özel kopya/;

beforeEach(() => {
  vi.clearAllMocks();
  construction.current = { weft: null };
  api.get.mockResolvedValue(SPEC);
  listUsers.mockResolvedValue({ rows: [FABRIC, { ...FABRIC, id: "it-b", code: "D2058", name: "TÜL D2058" }, { ...FABRIC, id: "it-c", code: "D2059", name: "TÜL D2059" }], total: 3 });
});

describe("WeftTab — bu desene özel kopya", () => {
  it("§1 kart 3 kumaşta + yazma izni → bant + düğme", async () => {
    countUsers.mockResolvedValue(3);
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite />);
    expect(await screen.findByText("Bu atkı kartı 3 kumaşta kullanılıyor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BUTTON })).toBeInTheDocument();
  });
  it("§2 kart yalnız bu kumaşta → düğme yok", async () => {
    countUsers.mockResolvedValue(1);
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite />);
    await waitFor(() => expect(countUsers).toHaveBeenCalled());
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });
  it("§3 yazma izni yok → bant var, düğme yok", async () => {
    countUsers.mockResolvedValue(2);
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite={false} />);
    expect(await screen.findByText("Bu atkı kartı 2 kumaşta kullanılıyor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });
  it("§4 ⭐ onay taşınanı ve kalanları listeler; uç bu kumaş + önerilen kodla çağrılır", async () => {
    countUsers.mockResolvedValue(3);
    api.fork.mockResolvedValue({ weftSpec: { ...SPEC, id: "w-2", code: "ATK-ORTAK-D2057" }, itemId: "it-a", previousWeftSpecId: "w-1", replayed: false });
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
    expect(screen.getByTestId("fork-moving")).toHaveTextContent("D2057");
    await waitFor(() => expect(screen.getByTestId("fork-staying")).toHaveTextContent("D2058"));
    expect(screen.getByTestId("fork-staying")).toHaveTextContent("D2059");
    expect(screen.getByTestId("fork-staying")).not.toHaveTextContent("D2057 — ");
    expect(screen.queryByTestId("fork-staying-more")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kopyala ve bu kumaşa bağla" }));
    await waitFor(() => expect(api.fork).toHaveBeenCalledWith("w-1", { itemId: "it-a", code: "ATK-ORTAK-D2057", name: "Ortak atkı (D2057)" }));
  });
  it("§4b liste sayfa sınırında kesilirse \"+N kumaş daha\" söylenir", async () => {
    countUsers.mockResolvedValue(250);
    listUsers.mockResolvedValue({ rows: [FABRIC, { ...FABRIC, id: "it-b", code: "D2058", name: "TÜL D2058" }], total: 250 });
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
    await waitFor(() => expect(screen.getByTestId("fork-staying-more")).toHaveTextContent("+248 kumaş daha"));
  });

  it("§5 öneri kod 32 / ad 100 karaktere kırpılır, ad son eki korur", () => {
    expect(suggestForkCode("A".repeat(30), "D2057")).toHaveLength(32);
    const n = suggestForkName("B".repeat(120), "D2057");
    expect(n).toHaveLength(100);
    expect(n.endsWith(" (D2057)")).toBe(true);
  });
});

describe("WeftSpecEditor — iplik payı % (SY-3 L3)", () => {
  const yarns = [
    { yarnItemId: "y-a", picksInRepeat: 4, sortOrder: 0, sharePct: 66.67 },
    { yarnItemId: "y-b", picksInRepeat: 2, sortOrder: 1, sharePct: 33.33 },
  ];
  it("PICKS: pay sütunu + 'atım sayısına göre' notu", async () => {
    countUsers.mockResolvedValue(1);
    api.get.mockResolvedValue({ ...SPEC, shareBasis: "PICKS", yarns });
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite={false} />);
    expect(await screen.findByLabelText("Atkı A pay")).toHaveTextContent("%66,67");
    expect(screen.getByLabelText("Atkı B pay")).toHaveTextContent("%33,33");
    expect(screen.getByText("Pay %")).toBeInTheDocument();
    expect(screen.getByTestId("weft-share-note")).toHaveTextContent("atım sayısına göre");
  });
  it("esas null (ya da eski backend): sütun ve not yok", async () => {
    countUsers.mockResolvedValue(1);
    api.get.mockResolvedValue({ ...SPEC, shareBasis: null, yarns: yarns.map((y) => ({ ...y, sharePct: null })) });
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite={false} />);
    await screen.findByText(/Atkı kartı:/);
    expect(screen.queryByLabelText("Atkı A pay")).toBeNull();
    expect(screen.queryByTestId("weft-share-note")).toBeNull();
  });
  it("satır düzenlenince pay '—' olur (kaydedince sunucu yeniden verir)", async () => {
    countUsers.mockResolvedValue(1);
    api.get.mockResolvedValue({ ...SPEC, shareBasis: "MASS", yarns });
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite />);
    const cell = await screen.findByLabelText("Atkı A pay");
    expect(cell).toHaveTextContent("%66,67");
    fireEvent.change(screen.getByLabelText("Atkı A rapordaki adet"), { target: { value: "5" } });
    await waitFor(() => expect(screen.getByLabelText("Atkı A pay")).toHaveTextContent("—"));
    expect(screen.getByTestId("weft-share-note")).toHaveTextContent("kütlece");
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
    countUsers.mockResolvedValue(1);
    api.get.mockResolvedValue({ ...SPEC, sequenceCode: "A2 B1 A2 C1" });
    construction.current = { weft: WEFT };
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite />);
    expect(await screen.findByTestId("weft-pick-summary")).toHaveTextContent("A 4 · B 1 · C 1 = 6 atkı/rapor");
    expect(screen.getByRole("img", { name: "Atkı seçici sütunu" })).toBeInTheDocument();
    expect(screen.queryByText(/kaydedince görünüm güncellenir/)).toBeNull();
  });
  it("sıra kodu yazılıp kaydedilmeyince 'kaydedince güncellenir' notu; geri alınınca kalkar", async () => {
    countUsers.mockResolvedValue(1);
    api.get.mockResolvedValue({ ...SPEC, sequenceCode: "A2 B1 A2 C1" });
    construction.current = { weft: WEFT };
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite />);
    const input = await screen.findByLabelText("Atkı sırası kodu");
    fireEvent.change(input, { target: { value: "A4 B1" } });
    expect(await screen.findByText(/kaydedince görünüm güncellenir/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "A2 B1 A2 C1 " } });
    await waitFor(() => expect(screen.queryByText(/kaydedince görünüm güncellenir/)).toBeNull());
  });
  it("sıra kodu yoksa çizim yerine yönlendirme", async () => {
    countUsers.mockResolvedValue(1);
    construction.current = { weft: { ...WEFT, sequenceCode: null, pickSequence: null } };
    renderWithProviders(<WeftTab fabric={FABRIC} canWrite={false} />);
    expect(await screen.findByText(/atkı seçici burada çizilir/)).toBeInTheDocument();
  });
});
