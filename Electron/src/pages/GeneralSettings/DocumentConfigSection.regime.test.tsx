// =============================================================================
// BEKÇİ — BELGE ŞABLONLARI SEÇİCİSİNİN REJİM SÜZGECİ
// =============================================================================
// NEDEN VAR: "fabrikada sıfır görünür fark" garantisi ticaret paketinin en
// önemli sözleşmesi ve karo / route / komut paleti için bekçili. ÜÇÜNCÜ giriş
// kapısı olan Belge Şablonları açılır listesi ise 2026-08-15'e kadar KOŞULSUZ
// `DOC_DEFS.map(...)` idi: `finance.enabled` KAPALI bir üretici fabrikada
// `document-template:read` taşıyan kullanıcı, hiç basamayacağı "Stok Sayım
// Tutanağı" / "Fatura" / "Mutabakat Mektubu" satırlarını görüyor ve canlı
// önizlemesini açabiliyordu (örnek veriyle gerçekten render oluyor).
//
// ÖLÇÜLENLER:
//   §1 `requiresFinance` işaretli belgeler AÇIKÇA SAYILI — kümeye sessizce
//      belge eklenmesin (tile-visibility.test'teki "koşullu karo listesi"
//      deseninin birebir aynısı). ⚠️ `depoTransfer`/`malKabul` bilerek DIŞARIDA:
//      kaynaklarını yazan uçlar (`warehouse-transfer.routes`,
//      `goods-receipt.routes`) rejim kapısı TAŞIMAZ.
//   §2 DAVRANIŞ: bayrak kapalıyken liste o belgeleri ÇİZMEZ, açıkken çizer.
//      Saf liste kontrolü tek başına yetmez — `.filter(...)` çağrısı geri
//      alınsaydı §1 yeşil kalırdı.
//   §3 Körlük zemini: liste gerçekten dolu ve fabrika kümesi boş değil.
//
// NEGATİF SONDA (2026-08-15, dosya `shasum` ile geri yüklendi):
//   ① `visibleDefs` süzgeci `DOC_DEFS`e çevrildi → §2'de 1 kontrol düştü
//   ② `stokSayimi`in `requiresFinance` bayrağı silindi → §1 + §2 düştü
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { DOC_DEFS } from "@/services/documentConfig";

const flags = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => flags(),
}));

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasAnyPermission: () => true, hasPermission: () => true }),
}));

vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Ayar panelleri bu testin konusu değil (ve ağır) — seçici + gövde kapısı ölçülüyor.
vi.mock("./DocumentStyleControls", () => ({ DocumentStyleControls: () => null }));
vi.mock("./DocumentFieldsPanel", () => ({ DocumentFieldsPanel: () => null }));
vi.mock("./DocumentAdvancedControls", () => ({ DocumentAdvancedControls: () => null }));

import { DocumentConfigSection } from "./DocumentConfigSection";

/** Rejime bağlı belgeler — genişletmek BİLİNÇLİ bir karardır (bkz. §1 notu). */
const FINANCE_ONLY = [
  "cekTeslimBordrosu",
  "fatura",
  "mutabakatMektubu",
  "stokSayimi",
  "tahsilatMakbuzu",
];

function setFinance(enabled: boolean): void {
  flags.mockReturnValue({
    isLoading: false,
    data: { data: { financeEnabled: enabled, documentsConfig: {} } },
  });
}

describe("Belge Şablonları — rejim süzgeci", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("§1 `requiresFinance` işaretli belge kümesi AÇIKÇA sayılı", () => {
    const marked = DOC_DEFS.filter((d) => d.requiresFinance).map((d) => d.key);
    expect(marked.sort()).toEqual(FINANCE_ONLY);
  });

  it("§1b üretim belgeleri işaretlenmemiş (kaynağı fabrikada meşru olan liste dışı)", () => {
    const factory = DOC_DEFS.filter((d) => !d.requiresFinance).map((d) => d.key);
    // Depo transferi + mal kabulü fabrikada da doğabilir → şablonları listelenir.
    expect(factory).toContain("depoTransfer");
    expect(factory).toContain("malKabul");
    expect(factory).toContain("shipmentDispatch");
    // Körlük zemini §3: liste gerçekten dolu.
    expect(factory.length).toBeGreaterThan(5);
  });

  it("§2 fabrikada (finance KAPALI) ticaret belgeleri listede ÇİZİLMEZ", async () => {
    setFinance(false);
    const user = userEvent.setup();
    renderWithProviders(<DocumentConfigSection />);
    // ⚠️ İLK combobox "Belge:" seçicisidir (gövdedeki dil/boy seçicileri de
    // combobox rolü taşır) — index sabit çünkü seçici gövdeden ÖNCE çizilir.
    await user.click(screen.getAllByRole("combobox")[0]!);

    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("Sevk İrsaliyesi");
    expect(options).not.toContain("Stok Sayım Tutanağı");
    expect(options).not.toContain("Fatura (İç)");
    expect(options).not.toContain("Mutabakat Mektubu");
  });

  it("§2b ticaret kurulumunda (finance AÇIK) aynı belgeler listede VAR", async () => {
    setFinance(true);
    const user = userEvent.setup();
    renderWithProviders(<DocumentConfigSection />);
    // ⚠️ İLK combobox "Belge:" seçicisidir (gövdedeki dil/boy seçicileri de
    // combobox rolü taşır) — index sabit çünkü seçici gövdeden ÖNCE çizilir.
    await user.click(screen.getAllByRole("combobox")[0]!);

    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("Stok Sayım Tutanağı");
    expect(options).toContain("Mutabakat Mektubu");
  });
});
