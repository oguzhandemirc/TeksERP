import ScannerRollStrip from "./ScannerRollStrip";
import { renderWithPaper } from "../test/render";

// =============================================================================
// "Son okutulanlar" şeridi — Hızlı İş Emri + Fason Sevk ORTAK.
// =============================================================================
// Şeridin tek işi "en son ne oldu" sorusunu cevaplamaktır. Sıra sözleşmesi
// sessizce bozulabilen türden: giriş EKLENME sırasındadır (en eski önce), şerit
// onu ters çevirir. Ters sırada state tutan bir ekran (Fason Sevk yeni topu başa
// ekler) çeviriyi yapmazsa en son okutulan top en ALTA düşer ve yeşil "az önce
// eklendi" vurgusu yanlış satıra gider — hata vermez, sadece yanlış olur.
// =============================================================================

jest.mock("react-native-paper", () => {
  const actual = jest.requireActual("react-native-paper");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    ...actual,
    // Paper'ın Icon'u expo-font zincirini çeker; şerit testinde ikon çizimi
    // ölçülmüyor.
    Icon: (props: Record<string, unknown>) => React.createElement(View, props),
  };
});

const ROLLS = [
  { barcode: "T-ESKI", qty: 100, width: 150 },
  { barcode: "T-ORTA", qty: 200, width: 150 },
  { barcode: "T-YENI", qty: 300, width: 150 },
];

describe("ScannerRollStrip", () => {
  it("§1 EN SON okutulan en üstte — giriş eklenme sırasındadır", () => {
    const { getAllByText } = renderWithPaper(
      <ScannerRollStrip rolls={ROLLS} totalQty={600} onRemove={jest.fn()} />,
    );
    const shown = getAllByText(/^T-/).map((n) => n.props.children);
    expect(shown).toEqual(["T-YENI", "T-ORTA", "T-ESKI"]);
  });

  it("§2 mükerrer satır işaretlenir — 'okundu ama yeni bir şey eklenmedi'", () => {
    const { getByText } = renderWithPaper(
      <ScannerRollStrip
        rolls={ROLLS}
        totalQty={600}
        onRemove={jest.fn()}
        duplicateBarcode="T-ORTA"
      />,
    );
    expect(getByText("zaten listede")).toBeTruthy();
  });

  it("§3 ret satırı SEBEBİYLE en üstte durur", () => {
    // Toast 3 sn'de kaybolur; sebep, operatör topu bırakıp döndüğünde hâlâ
    // ekranda olmalı.
    const { getByText, getAllByText } = renderWithPaper(
      <ScannerRollStrip
        rolls={ROLLS}
        totalQty={600}
        onRemove={jest.fn()}
        rejects={[{ id: 1, barcode: "T-RET", reason: "Stokta değil" }]}
      />,
    );
    expect(getByText("Stokta değil")).toBeTruthy();
    expect(getAllByText(/^T-/).map((n) => n.props.children)[0]).toBe("T-RET");
  });

  it("§4 hiç okutma yokken boş hâl — 'sanki kayboldu' izlenimi vermez", () => {
    const { getByText } = renderWithPaper(
      <ScannerRollStrip rolls={[]} totalQty={0} onRemove={jest.fn()} />,
    );
    expect(getByText("Henüz top okutulmadı")).toBeTruthy();
  });
});
