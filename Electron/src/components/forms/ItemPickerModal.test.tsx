// =============================================================================
// BEKÇİ — Ürün seçici modalı (kabul B): kutu → modal · tam liste · Tür FARE ve KLAVYE · Renk → allowedColorId ·
// Özellik → allowedPropertyId · arama · satır → onChange(id,row) + kapanır · katalog sığmazsa süzgeç gizli ·
// kaynak taraması (yerleşik <select> / DataTable / iki sorgu YOK, h-[85vh] SABİT)
// =============================================================================
// Negatif sonda (kırmızı görüldü): `itemPickerFilters` `allowedColorId`yi düşürünce (3) ❌; modal `h-[85vh]` →
// `max-h-[85vh]` olunca (8) ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ItemSelect } from "./ItemSelect";
import { ITEM_PICKER_EMPTY } from "./itemPicker";

const listCursor = vi.fn();
const getById = vi.fn();
const colorsAll = vi.fn();
const propsAll = vi.fn();
vi.mock("@/pages/Items/service", () => ({ itemService: { listCursor: (...a: unknown[]) => listCursor(...a), getById: (...a: unknown[]) => getById(...a), getAll: vi.fn() } }));
vi.mock("@/pages/Colors/service", () => ({ colorService: { getAll: (...a: unknown[]) => colorsAll(...a) } }));
vi.mock("@/pages/FabricProperties/service", () => ({ fabricPropertyService: { getAll: (...a: unknown[]) => propsAll(...a) } }));

const RED = { id: "c-red", code: "KIRMIZI", name: "Kırmızı", hex: "#f00", isActive: true };
const BLUE = { id: "c-blue", code: "MAVI", name: "Mavi", hex: "#00f", isActive: true };
const FIRE = { id: "p-fire", code: "YANMAZ", name: "Yanmazlık", isActive: true };
const ITEMS = [
  { id: "i1", code: "KUM1", name: "Poplin", itemType: "FABRIC", unit: "MT", isActive: true, allowedColors: [{ colorId: "c-red", color: RED }], allowedProperties: [{ propertyId: "p-fire", property: FIRE }] },
  { id: "i2", code: "KUM2", name: "Saten", itemType: "FABRIC", unit: "MT", isActive: true, allowedColors: [], allowedProperties: [] },
  { id: "i3", code: "IPL1", name: "Pamuk İplik", itemType: "YARN", unit: "KG", isActive: true, allowedColors: [{ colorId: "c-blue", color: BLUE }], allowedProperties: [] },
  { id: "i4", code: "SRF1", name: "Etiket Rulosu", itemType: "CONSUMABLE", unit: "ADET", isActive: true, allowedColors: [], allowedProperties: [] },
];
const cursorPage = (data: unknown[], nextCursor: string | null = null) => Promise.resolve({ success: true, data, pagination: { nextCursor, hasMore: nextCursor !== null, limit: 50 } });
const page = (data: unknown[]) => Promise.resolve({ success: true, data, pagination: { page: 1, pageSize: 500, total: data.length, totalPages: 1 } });

beforeEach(() => {
  listCursor.mockReset();
  getById.mockReset();
  colorsAll.mockReset();
  propsAll.mockReset();
  // Sunucu süzgecini taklit eder: itemType eşitlik; allowedColorId → liste boş VEYA içeriyor; allowedPropertyId aynı.
  listCursor.mockImplementation((p: { filters?: Record<string, string>; search?: string }) => {
    let rows = ITEMS;
    const f = p.filters ?? {};
    if (f.itemType) rows = rows.filter((i) => f.itemType!.split(",").includes(i.itemType));
    if (f.allowedColorId) rows = rows.filter((i) => i.allowedColors.length === 0 || i.allowedColors.some((c) => c.colorId === f.allowedColorId));
    if (f.allowedPropertyId) rows = rows.filter((i) => i.allowedProperties.length === 0 || i.allowedProperties.some((c) => c.propertyId === f.allowedPropertyId));
    if (p.search) rows = rows.filter((i) => i.name.includes(p.search!) || i.code.includes(p.search!));
    return cursorPage(rows);
  });
  colorsAll.mockImplementation(() => page([RED, BLUE]));
  propsAll.mockImplementation(() => page([FIRE]));
});

async function openModal(onChange: (id: string | null, row: unknown) => void = () => {}) {
  renderWithProviders(<ItemSelect value={null} onChange={onChange} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull(); // formda küçük açılır liste HİÇ çizilmez
  await userEvent.click(screen.getByRole("button", { name: "Ürün seç (liste)" }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Poplin");
  return dialog;
}
const trigger = (dialog: HTMLElement, name: string) => within(dialog).getByRole("combobox", { name });
const names = (dialog: HTMLElement) => within(dialog).getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[1]?.textContent);

describe("ItemPickerModal — liste ve süzgeçler", () => {
  it("(1) ⭐ kutuya tıkla → dialog; TAM liste (dört tür), kolonlar, sayfa 50, ilk açılışta yalnız isActive; renk rozeti / Tümü", async () => {
    const dialog = await openModal();
    for (const h of ["Kod", "Ad", "Tür", "Birim", "Renkler", "Özellikler"]) expect(within(dialog).getByText(h)).toBeInTheDocument();
    expect(names(dialog)).toEqual(["Poplin", "Saten", "Pamuk İplik", "Etiket Rulosu"]);
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, sortBy: "name", filters: { isActive: "true" } }));
    const poplin = within(dialog).getByText("Poplin").closest("tr") as HTMLElement;
    expect(within(poplin).getByText("Kırmızı")).toBeInTheDocument();
    expect(within(poplin).getByText("Yanmazlık")).toBeInTheDocument();
    expect(within(within(dialog).getByText("Saten").closest("tr") as HTMLElement).getByText("Tümü")).toBeInTheDocument();
    expect(within(dialog).getByText("Yüklü 4 ürün")).toBeInTheDocument();
    expect(within(dialog).getByText("Tüm ürünler yüklendi")).toBeInTheDocument();
    // ⭐ üç tetik kapalıyken ADINI taşır ("Tümü" tek başına değil)
    expect(trigger(dialog, "Tür")).toHaveTextContent("Tür: Tümü");
    await waitFor(() => expect(trigger(dialog, "Renk")).toHaveTextContent("Renk: Tümü"));
    expect(trigger(dialog, "Özellik")).toHaveTextContent("Özellik: Tümü");
  });

  it("(2a) ⭐ Tür FARE ile: tetik → 'İplik' → filter[itemType]=YARN; yalnız iplik listede", async () => {
    const dialog = await openModal();
    listCursor.mockClear();
    await userEvent.click(trigger(dialog, "Tür"));
    await userEvent.click(await screen.findByRole("option", { name: "İplik" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", itemType: "YARN" } })));
    await waitFor(() => expect(names(dialog)).toEqual(["Pamuk İplik"]));
    expect(trigger(dialog, "Tür")).toHaveTextContent("Tür: İplik"); // tetik metni süzgecin ADINI taşır
  });

  it("(2b) ⭐ Tür KLAVYE ile: odak → ↓ (açılır) → ↓ ↓ → Enter = 'Kumaş' → filter[itemType]=FABRIC", async () => {
    const dialog = await openModal();
    listCursor.mockClear();
    trigger(dialog, "Tür").focus();
    await userEvent.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", itemType: "FABRIC" } })));
    await waitFor(() => expect(names(dialog)).toEqual(["Poplin", "Saten"]));
    expect(trigger(dialog, "Tür")).toHaveTextContent("Tür: Kumaş");
  });

  it("(3) ⭐ Renk 'Kırmızı' → filter[allowedColorId]; listesi boş ürünler de gelir (Saten, Etiket), Mavi'li iplik gitmez", async () => {
    const dialog = await openModal();
    await waitFor(() => expect(trigger(dialog, "Renk")).toBeInTheDocument());
    listCursor.mockClear();
    await userEvent.click(trigger(dialog, "Renk"));
    await userEvent.click(await screen.findByRole("option", { name: "Kırmızı" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", allowedColorId: "c-red" } })));
    await waitFor(() => expect(names(dialog)).toEqual(["Poplin", "Saten", "Etiket Rulosu"]));
    expect(trigger(dialog, "Renk")).toHaveAttribute("title", expect.stringContaining("Listesi boş"));
    expect(trigger(dialog, "Renk")).toHaveTextContent("Renk: Kırmızı");
  });

  it("(4) Özellik 'Yanmazlık' → filter[allowedPropertyId]; Tür ile BİRLİKTE gider", async () => {
    const dialog = await openModal();
    await waitFor(() => expect(trigger(dialog, "Özellik")).toBeInTheDocument());
    await userEvent.click(trigger(dialog, "Tür"));
    await userEvent.click(await screen.findByRole("option", { name: "Kumaş" }));
    listCursor.mockClear();
    await userEvent.click(trigger(dialog, "Özellik"));
    await userEvent.click(await screen.findByRole("option", { name: "Yanmazlık" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", itemType: "FABRIC", allowedPropertyId: "p-fire" } })));
    await waitFor(() => expect(names(dialog)).toEqual(["Poplin", "Saten"]));
  });

  it("(5) arama sunucuya (search), debounce sonrası; süzgeç boşken 'Süzgece uyan ürün yok'", async () => {
    const dialog = await openModal();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Ürün ara" }), "Sat");
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ search: "Sat" })));
    await waitFor(() => expect(names(dialog)).toEqual(["Saten"]));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Ürün ara" }), "xyz");
    await within(dialog).findByText("Süzgece uyan ürün yok.");
  });

});

describe("ItemPickerModal — seçim, katalog, kaynak", () => {
  it("(6) ⭐ satıra tıkla → onChange(id, satır) ve kapanır; tetik 'Ad — KOD' + tür rozeti, getById SORULMAZ", async () => {
    const onChange = vi.fn();
    const dialog = await openModal(onChange);
    await userEvent.click(within(dialog).getByText("Pamuk İplik"));
    expect(onChange).toHaveBeenCalledWith("i3", expect.objectContaining({ id: "i3", code: "IPL1", name: "Pamuk İplik", itemType: "YARN" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("(6b) değer dışarıdan gelir (düzenleme) → etiket getById ile çözülür: 'Ad — KOD'", async () => {
    getById.mockResolvedValue({ success: true, data: ITEMS[0] });
    renderWithProviders(<ItemSelect value="i1" onChange={() => {}} />);
    await screen.findByText("Poplin — KUM1");
    expect(getById).toHaveBeenCalledWith("i1");
    expect(screen.getByRole("button", { name: "Ürün seç (liste)" })).toHaveTextContent("Kumaş");
  });

  it("(7) katalog sığmazsa (loadAllForPicker fırlatır) Renk seçicisi GİZLENİR, liste ve Tür çalışır", async () => {
    colorsAll.mockImplementation(() => page(Array.from({ length: 501 }, (_, i) => ({ ...RED, id: `c${i}` }))).then((r) => ({ ...r, pagination: { ...r.pagination, total: 501 } })));
    const dialog = await openModal();
    await waitFor(() => expect(trigger(dialog, "Özellik")).toBeInTheDocument());
    expect(within(dialog).queryByRole("combobox", { name: "Renk" })).toBeNull();
    expect(names(dialog)).toHaveLength(4);
  });

  it("(8) ⭐ kaynak taraması: yerleşik <select>/<option> yok; DataTable/useReactTable/cast yok; TEK useInfiniteQuery; h-[85vh] SABİT; loadAllForPicker listeye değil kataloğa", () => {
    const dir = path.resolve(__dirname);
    const soy = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const modal = soy(readFileSync(path.join(dir, "ItemPickerModal.tsx"), "utf8"));
    const hook = soy(readFileSync(path.join(dir, "useItemPickerData.ts"), "utf8"));
    const select = soy(readFileSync(path.join(dir, "ItemSelect.tsx"), "utf8"));
    expect(modal + select).not.toMatch(/<select\b|<option\b/);
    expect(modal + hook + select).not.toMatch(/DataTable|useReactTable|DataTablePagination|as unknown as/);
    expect((hook.match(/useInfiniteQuery\(/g) ?? []).length).toBe(1);
    expect(hook).toMatch(/itemService\.listCursor\(/);
    expect(hook).not.toMatch(/loadAllForPicker\(itemService/);
    expect(modal).toMatch(/from "@\/components\/ui\/select"/);
    expect(modal).toMatch(/useInfiniteScroll\(/);
    expect(modal).toMatch(/className="[^"]*\bh-\[85vh\]/);
    expect(modal).not.toMatch(/max-h-\[85vh\]/);
  });

  it("(9) ⭐ allowedTypes=[YARN,FABRIC] (mal kabul): Tür seçicisinde Sarf YOK; 'Tümü' sunucuya itemType=YARN,FABRIC (CSV → in); sarf hiç listelenmez", async () => {
    renderWithProviders(<ItemSelect value={null} onChange={() => {}} allowedTypes={["YARN", "FABRIC"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Ürün seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Poplin");
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", itemType: "YARN,FABRIC" } }));
    await userEvent.click(trigger(dialog, "Tür"));
    const opts = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opts).toEqual(["Tümü", "İplik", "Kumaş"]);
    await userEvent.click(screen.getByRole("option", { name: "Kumaş" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", itemType: "FABRIC" } })));
  });

  it("(10) allowedTypes=[FABRIC] (satış siparişi): Tür seçicisi ÇİZİLMEZ, başlık 'Kumaş seç', sunucuya itemType=FABRIC; Renk süzgeci kalır", async () => {
    renderWithProviders(<ItemSelect value={null} onChange={() => {}} allowedTypes={["FABRIC"]} aria-label="Kumaş seç" />);
    await userEvent.click(screen.getByRole("button", { name: "Kumaş seç" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Poplin");
    expect(within(dialog).getByText("Kumaş seç")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Tür" })).toBeNull();
    await waitFor(() => expect(trigger(dialog, "Renk")).toBeInTheDocument());
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", itemType: "FABRIC" } }));
    expect(names(dialog)).toEqual(["Poplin", "Saten"]);
  });

  it("(11) ⭐ Tür=İplik → Renk/Özellik seçicileri ÇİZİLMEZ ve seçili renk SIFIRLANIR (istekte allowedColorId yok); Kumaş'a dönünce geri gelir; iplik satırında Renkler/Özellikler hücresi boş", async () => {
    const dialog = await openModal();
    await waitFor(() => expect(trigger(dialog, "Renk")).toBeInTheDocument());
    await userEvent.click(trigger(dialog, "Renk"));
    await userEvent.click(await screen.findByRole("option", { name: "Kırmızı" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", allowedColorId: "c-red" } })));
    listCursor.mockClear();
    await userEvent.click(trigger(dialog, "Tür"));
    await userEvent.click(await screen.findByRole("option", { name: "İplik" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", itemType: "YARN" } })));
    expect(within(dialog).queryByRole("combobox", { name: "Renk" })).toBeNull();
    expect(within(dialog).queryByRole("combobox", { name: "Özellik" })).toBeNull();
    const yarnRow = (await within(dialog).findByText("Pamuk İplik")).closest("tr") as HTMLElement;
    expect(within(yarnRow).queryByText("Mavi")).toBeNull();
    expect(within(yarnRow).queryByText("—")).toBeNull();
    await userEvent.click(trigger(dialog, "Tür"));
    await userEvent.click(await screen.findByRole("option", { name: "Kumaş" }));
    await waitFor(() => expect(trigger(dialog, "Renk")).toHaveTextContent("Renk: Tümü"));
  });

  it("(12) allowedTypes=[YARN] kilidi → Renk/Özellik hiç çizilmez", async () => {
    renderWithProviders(<ItemSelect value={null} onChange={() => {}} allowedTypes={["YARN"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Ürün seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Pamuk İplik");
    expect(within(dialog).queryByRole("combobox")).toBeNull();
  });

  it("boş liste yönlendirme", async () => {
    listCursor.mockImplementation(() => cursorPage([]));
    renderWithProviders(<ItemSelect value={null} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Ürün seç (liste)" }));
    await within(await screen.findByRole("dialog")).findByText(ITEM_PICKER_EMPTY);
  });
});
