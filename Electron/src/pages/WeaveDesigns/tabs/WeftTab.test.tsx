// =============================================================================
// BEKÇİ — Atkı sırası sekmesi "Bu desene özel kopya" (SY-P3): §1 kart >1 kumaşta + yazma izni → düğme ·
//   §2 tek kumaşta düğme yok · §3 izin yoksa düğme yok · §4 onay diyaloğu taşınan ve kalan kumaşları
//   listeler, uç kumaş + önerilen kodla çağrılır · §5 öneri sunucu sınırlarına kırpılır
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
const { api, countUsers, listUsers } = vi.hoisted(() => ({
  api: { get: vi.fn(), update: vi.fn(), fork: vi.fn() },
  countUsers: vi.fn(),
  listUsers: vi.fn(),
}));
vi.mock("../service", () => ({
  weftSpecApi: api,
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
  api.get.mockResolvedValue(SPEC);
  listUsers.mockResolvedValue([FABRIC, { ...FABRIC, id: "it-b", code: "D2058", name: "TÜL D2058" }, { ...FABRIC, id: "it-c", code: "D2059", name: "TÜL D2059" }]);
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
    fireEvent.click(screen.getByRole("button", { name: "Kopyala ve bu kumaşa bağla" }));
    await waitFor(() => expect(api.fork).toHaveBeenCalledWith("w-1", { itemId: "it-a", code: "ATK-ORTAK-D2057", name: "Ortak atkı (D2057)" }));
  });
  it("§5 öneri kod 32 / ad 100 karaktere kırpılır, ad son eki korur", () => {
    expect(suggestForkCode("A".repeat(30), "D2057")).toHaveLength(32);
    const n = suggestForkName("B".repeat(120), "D2057");
    expect(n).toHaveLength(100);
    expect(n.endsWith(" (D2057)")).toBe(true);
  });
});
