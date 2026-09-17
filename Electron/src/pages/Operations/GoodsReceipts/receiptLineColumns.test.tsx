// =============================================================================
// BEKÇİ — Mal kabul satır editörü: TÜRE GÖRE İKİ ALT TABLO (EK 5) — başlık ↔ hücre eşleşmesi, boş grup çizilmez,
// grup düğmesi satırı TİPLİ doğurur ve ürün seçici o türe kilitlidir, top sınıfı satır bazlı (fiş kutusu varsayılan),
// çift anlamlı eski başlıklar ("Miktar (m / kg)", "En (cm) / Bobin") kaynakta 0.
// =============================================================================
// Negatif sonda: `YARN_COLUMNS`ta Lot ile Kg yer değiştirince "hücre ↔ başlık" ❌; `emptyLine(kind)` kind'ı düşürünce
// "tipli doğar" ❌; `RawStockToggle` value'su `rawStockDefault`ı okumayınca "varsayılan kutudan" ❌; eski karma başlık
// bir dosyaya geri yazılınca kaynak taraması ❌.
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { FABRIC_COLUMNS, YARN_COLUMNS, cellLabel, receiptLineGridCols, receiptLineHeaders } from "./receiptLineColumns";
import { ReceiptLineRows, emptyLine, type DraftLine } from "./ReceiptLineRows";

vi.mock("@/hooks/useFoldValues", () => ({ useFoldValues: () => ({ values: [{ code: "2-KAT", name: "2 Kat" }] }) }));
vi.mock("@/components/forms/ReferenceSelect", () => ({
  ReferenceSelect: (p: { "aria-label"?: string; placeholder?: string }) => <button type="button" aria-label={p["aria-label"]}>{p.placeholder}</button>,
}));
// Ürün hücresi modal seçici (`ItemSelect`) — stub `allowedTypes` kilidini data-attribute olarak dışarı verir.
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { "aria-label"?: string; placeholder?: string; allowedTypes?: string[] }) => (
    <button type="button" aria-label={p["aria-label"]} data-allowed={(p.allowedTypes ?? []).join(",")}>{p.placeholder}</button>
  ),
}));
vi.mock("./LinePropertiesButton", () => ({
  LinePropertiesButton: (p: { "aria-label"?: string }) => <button type="button" aria-label={p["aria-label"]}>Özellik</button>,
}));

const YARN = new Set(["yarn-1"]);
const fabricLine = (o: Partial<DraftLine> = {}) => ({ ...emptyLine(), itemId: "fab-1", ...o });
const yarnLine = () => ({ ...emptyLine(), itemId: "yarn-1" });
const headerTexts = (kind: "FABRIC" | "YARN") =>
  Array.from(screen.getByTestId(`receipt-line-headers-${kind}`).querySelectorAll("span")).map((s) => s.textContent).filter((t) => t);

/** Satırın i. grid hücresi — hücre bir sarmalayıcı div ise içindeki etiketli elemanı bul. */
function cellLabelAt(row: HTMLElement, i: number): string | null {
  const cell = row.children[i] as HTMLElement;
  const labelled = cell.getAttribute("aria-label") ? cell : cell.querySelector("[aria-label]");
  return labelled?.getAttribute("aria-label") ?? null;
}

describe("Mal kabul satır editörü — türe göre iki alt tablo (EK 5)", () => {
  it("sütun tablosu: kumaş 10 · iplik 6; her hücre etiketi kendi başlığının altında; iki tablonun grid şablonu farklı", () => {
    expect(receiptLineHeaders("FABRIC")).toEqual(["Kumaş", "Renk", "Metre (top başına)", "En (cm)", "Kg", "Kat", "Birim Fiyat", "Özellik", "Ham/Bitmiş", "Adet"]);
    expect(receiptLineHeaders("YARN")).toEqual(["İplik", "Lot", "Kg", "Bobin", "Birim Fiyat", "Adet"]);
    expect(cellLabel("YARN", 1)).toBe("Lot numarası");
    expect(cellLabel("FABRIC", 8)).toBe("Top sınıfı");
    expect(() => cellLabel("YARN", 6)).toThrow();
    expect(receiptLineGridCols("YARN")).not.toBe(receiptLineGridCols("FABRIC"));

    renderWithProviders(<ReceiptLineRows lines={[fabricLine(), yarnLine()]} onChange={() => {}} yarnItemIds={YARN} />);
    expect(headerTexts("FABRIC")).toEqual(receiptLineHeaders("FABRIC"));
    expect(headerTexts("YARN")).toEqual(receiptLineHeaders("YARN"));
    const fabricRow = screen.getByTestId("receipt-line-fabric");
    const yarnRow = screen.getByTestId("receipt-line-yarn");
    expect(fabricRow.children).toHaveLength(FABRIC_COLUMNS.length + 1); // + işlemler
    expect(yarnRow.children).toHaveLength(YARN_COLUMNS.length + 1);
    FABRIC_COLUMNS.forEach((c, i) => expect(cellLabelAt(fabricRow, i), `kumaş sütun ${i} (${c.header})`).toBe(c.label));
    YARN_COLUMNS.forEach((c, i) => expect(cellLabelAt(yarnRow, i), `iplik sütun ${i} (${c.header})`).toBe(c.label));
  });

  it("boş grup çizilmez: yalnız iplik → kumaş tablosu YOK, 'Kg' başlığı iplikte var ama kumaş anlamında 'Renk' yok", () => {
    renderWithProviders(<ReceiptLineRows lines={[yarnLine()]} onChange={() => {}} yarnItemIds={YARN} />);
    expect(screen.queryByTestId("receipt-group-FABRIC")).toBeNull();
    expect(screen.getByTestId("receipt-group-YARN")).toBeInTheDocument();
    expect(headerTexts("YARN")).not.toContain("Renk");
    expect(screen.queryByText("—")).toBeNull(); // tire/boş hücre hiç yok
    // Ürün seçici o türe kilitli.
    expect(screen.getByRole("button", { name: "İplik kalemi" })).toHaveAttribute("data-allowed", "YARN");
  });

  it("⭐ grup düğmesi satırı TİPLİ doğurur; ürün seçilmeden de kendi tablosuna düşer ve seçici o türe kilitli", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ReceiptLineRows lines={[fabricLine()]} onChange={onChange} yarnItemIds={YARN} />);
    await user.click(screen.getByRole("button", { name: "İplik satırı ekle" }));
    const next = onChange.mock.calls[0]![0] as DraftLine[];
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ kind: "YARN", itemId: "", rawStock: null });
    await user.click(screen.getByRole("button", { name: "Kumaş satırı ekle" }));
    expect((onChange.mock.calls[1]![0] as DraftLine[])[1]).toMatchObject({ kind: "FABRIC" });
  });

  it("boş iplik satırı (ürün seçilmemiş) iplik tablosunda çizilir, seçicisi YARN kilitli, kumaş tablosu yok", () => {
    renderWithProviders(<ReceiptLineRows lines={[emptyLine("YARN")]} onChange={() => {}} yarnItemIds={YARN} />);
    expect(screen.getByTestId("receipt-group-YARN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İplik kalemi" })).toHaveAttribute("data-allowed", "YARN");
    expect(screen.queryByTestId("receipt-group-FABRIC")).toBeNull();
  });

  it("⭐ top sınıfı satır bazlı: anahtar fiş kutusunu (rawStockDefault) okur; satırda basınca yalnız o satır açık boolean alır", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const a = fabricLine();
    const b = fabricLine({ rawStock: false });
    renderWithProviders(<ReceiptLineRows lines={[a, b]} onChange={onChange} yarnItemIds={YARN} rawStockDefault />);
    const groups = screen.getAllByRole("group", { name: "Top sınıfı" });
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getByRole("button", { name: "Ham" })).toHaveAttribute("aria-pressed", "true"); // null → varsayılan (ham)
    expect(within(groups[1]!).getByRole("button", { name: "Bitmiş" })).toHaveAttribute("aria-pressed", "true"); // satır kendi seçimi
    await user.click(within(groups[0]!).getByRole("button", { name: "Bitmiş" }));
    const next = onChange.mock.calls[0]![0] as DraftLine[];
    expect(next[0]).toMatchObject({ key: a.key, rawStock: false });
    expect(next[1]).toMatchObject({ key: b.key, rawStock: false });
  });

  it("iplik satırında top sınıfı anahtarı YOK (kg defteri raf taşımaz)", () => {
    renderWithProviders(<ReceiptLineRows lines={[yarnLine()]} onChange={() => {}} yarnItemIds={YARN} rawStockDefault />);
    expect(screen.queryByRole("group", { name: "Top sınıfı" })).toBeNull();
  });

  it("kaynak taraması: çift anlamlı karma başlıklar GoodsReceipts dizininde 0", () => {
    const dir = __dirname;
    const hits: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!/\.tsx?$/.test(name) || name === path.basename(__filename)) continue;
      const src = readFileSync(path.join(dir, name), "utf8");
      for (const needle of ["Miktar (m / kg)", "En (cm) / Bobin", "Renk / Lot", "receiptLineMode", "visibleColumnIndexes"]) {
        if (src.includes(needle)) hits.push(`${name}: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
