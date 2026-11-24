// Ürün penceresi > Atkı (B19): hiç atkı kartı yokken "var olan kartı seç" çizilmez; yeni atkıda sütun başlığı
// "Rapordaki atkı adedi" ⓘ ile, yer tutucular "ör. …" (dolu değer gibi durmaz).
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { EMPTY_WEFT } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { ItemWeftSection } from "./ItemWeftSection";
import type { ItemWeftDraft } from "./useItemWeftDraft";

const list = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/pages/WeaveDesigns/service", () => ({ weftSpecApi: { list: () => Promise.resolve(list.rows) } }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 500, total: 0, totalPages: 1 } }) }));

const noop = () => {};
const draft = (p: Partial<ItemWeftDraft>): ItemWeftDraft => ({
  mode: "none", cardId: null, savedCardId: null, content: EMPTY_WEFT, touched: false, card: null, cardLoading: false, others: 0,
  setContent: noop, startNew: noop, pickCard: noop, clear: noop, ...p,
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
    expect(screen.getByText("Rapordaki atkı adedi")).toBeInTheDocument();
    expect(screen.getByLabelText("Atkı sırası kodu")).toHaveAttribute("placeholder", "ör. A4 B1 A4 C1");
    expect(screen.getByLabelText("Atkı program no")).toHaveAttribute("placeholder", "ör. 6037");
    expect(screen.getByLabelText("Atkı A rapordaki atkı adedi")).toHaveAttribute("placeholder", "ör. 4");
  });
});
