// Ürün penceresi > Atkı (B19): hiç atkı kartı yokken "var olan kartı seç" çizilmez; yeni atkıda sütun başlığı
// sütun başlığı "Atış adedi" (uzun anlam ⓘ'de), yer tutucular "ör. …" (dolu değer gibi durmaz).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { EMPTY_WEFT } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { ItemWeftSection } from "./ItemWeftSection";
import type { ItemWeftDraft } from "./useItemWeftDraft";

const list = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/pages/WeaveDesigns/service", () => ({ weftSpecApi: { list: () => Promise.resolve(list.rows) } }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 500, total: 0, totalPages: 1 } }) }));

const noop = () => {};
const draft = (p: Partial<ItemWeftDraft>): ItemWeftDraft => ({
  mode: "none", cardId: null, savedCardId: null, content: EMPTY_WEFT, touched: false, card: null, cardLoading: false, others: 0, forking: false,
  setContent: noop, startNew: noop, startFork: noop, pickCard: noop, clear: noop, ...p,
});
const openTab = vi.hoisted(() => vi.fn());
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));
const CARD = { id: "w1", code: "1205", name: "Ortak atkı", picksPerCm: "18", sequenceCode: "A1", weftProgramNo: null, yarns: [{ yarnItemId: "y1", picksInRepeat: 1, sortOrder: 0 }] } as never;
const saved = (p: Partial<ItemWeftDraft>) => draft({ mode: "card", cardId: "w1", savedCardId: "w1", card: CARD, ...p });

describe("ItemWeftSection — paylaşılan kart kullanım yerinde kilitli (kullanıcı 2026-11-25)", () => {
  it("(a) ⭐ başka kumaşta da kullanılan kart: alanlar kilitli, kopya + Atkı Kartları ekranı yolu", async () => {
    list.rows = [];
    const startFork = vi.fn();
    renderWithProviders(<ItemWeftSection draft={saved({ others: 2, startFork })} canWrite />);
    expect(screen.getByText("Bu atkı kartı 2 kumaşta daha kullanılıyor")).toBeInTheDocument();
    expect(screen.getByLabelText("Atkı raporu")).toBeDisabled();
    expect(screen.queryByText(/Hepsinde/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Yalnız bu kumaş için kopya/ }));
    expect(startFork).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Atkı Kartları ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/weft-specs?search=1205", { forceNew: true }));
  });
  it("kullanım sayısı bilinmiyorsa da kilitli", () => {
    renderWithProviders(<ItemWeftSection draft={saved({ others: null })} canWrite />);
    expect(screen.getByLabelText("Atkı raporu")).toBeDisabled();
    expect(screen.getByTestId("weft-shared-lock")).toBeInTheDocument();
  });
  it("(b) yalnız bu kumaşa ait kart yerinde düzenlenir; kopya seçilince paylaşılan kart da (kopyaya) düzenlenir", () => {
    const { unmount } = renderWithProviders(<ItemWeftSection draft={saved({ others: 0 })} canWrite />);
    expect(screen.getByLabelText("Atkı raporu")).not.toBeDisabled();
    expect(screen.queryByTestId("weft-shared-lock")).toBeNull();
    unmount();
    renderWithProviders(<ItemWeftSection draft={saved({ others: 2, forking: true })} canWrite />);
    expect(screen.getByLabelText("Atkı raporu")).not.toBeDisabled();
    expect(screen.getByText(/kartın kopyası açılır/)).toBeInTheDocument();
  });
});

describe("ItemWeftSection", () => {
  it("hiç atkı kartı yokken 'Var olan atkı kartını seç' gösterilmez", async () => {
    list.rows = [];
    renderWithProviders(<ItemWeftSection draft={draft({})} canWrite />);
    await waitFor(() => expect(screen.getByTestId("weft-empty")).not.toHaveTextContent("var olan"));
    expect(screen.queryByText("Var olan atkı kartını seç")).toBeNull();
    expect(screen.getByRole("button", { name: /Atkıyı burada gir/ })).toBeInTheDocument();
  });

  it("kart varsa seçici görünür", async () => {
    list.rows = [{ id: "w1", code: "1205", name: "Ortak atkı", isActive: true, yarns: [], fabricCount: 1 }];
    renderWithProviders(<ItemWeftSection draft={draft({})} canWrite />);
    expect(await screen.findByText("Var olan atkı kartını seç")).toBeInTheDocument();
  });

  it("yeni atkı: sütun başlığı açık, yer tutucular örnek biçiminde", async () => {
    list.rows = [];
    renderWithProviders(<ItemWeftSection draft={draft({ mode: "new", content: { ...EMPTY_WEFT, rows: [{ yarnItemId: "", picks: "" }] } })} canWrite />);
    expect(screen.getByText("Atış adedi")).toBeInTheDocument();
    expect(screen.getByLabelText("Atkı sıklığı (atkı/cm)")).toHaveAttribute("placeholder", "ör. 22");
    expect(screen.getByLabelText("Atkı raporu")).toHaveAttribute("placeholder", "ör. 10x(A2 B2 C1) D4");
    expect(screen.getByLabelText("Atkı program no")).toHaveAttribute("placeholder", "ör. 6037");
    expect(screen.getByLabelText("Atkı A rapordaki atkı adedi")).toHaveAttribute("placeholder", "ör. 4");
  });
});
