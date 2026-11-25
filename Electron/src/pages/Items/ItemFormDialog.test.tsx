// =============================================================================
// BEKÇİ — Ürün kartı: izinli renk/özellik YALNIZ KUMAŞTA (kullanıcı kararı 2026-09-17)
// =============================================================================
// ⭐ §1 Tür Kumaş → "İzinli Renkler / Özellikler" alanları var; İplik/Sarf → YOK.
// ⭐ §2 Create'te tür İplik'e çevrilince değerler boşalır ve payload anahtarı gitmez.
// ⭐ §3 Eski iplik kartında liste kalmışsa formda tek satır NOT (sessiz düzeltme değil),
//    kaydedince payload `[]` ile kaldırır.
// ⭐ §4 (K4P-TANIM) "En (cm)": Kalite Güvence kapalıyken alan YOK ve payload'da `widthCm` anahtarı YOK
//    (gizli alan mevcut eni silmesin); açıkken kumaşta görünür, virgüllü değer noktalı gider.
//    NEGATİF SONDA (2026-10-25, geri alındı): payload'dan `widthCm` çıkarıldı → §4b kırmızı.
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ItemFormDialog } from "./ItemFormDialog";
import type { Item } from "./types";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: [], pagination: { page: 1, pageSize: 500, total: 0, totalPages: 1 } }) }));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/RecordInfoButton", () => ({ RecordInfoButton: () => null }));
vi.mock("./AllowedColorsDialog", () => ({ AllowedColorsDialog: () => null }));
vi.mock("./AllowedPropertiesDialog", () => ({ AllowedPropertiesDialog: () => null }));
const flags = vi.hoisted(() => ({ kg: false, mal: false, dk: false }));
// Devere kapalı varsayılır: çözgü kartı rejimi (devere ∨ dokuma) burada dokumayı izler.
vi.mock("@/hooks/usePricingEnabled", () => ({ useDevereEnabled: () => false, useWarpSpecEnabled: () => flags.dk, useDokumaEnabled: () => flags.dk, useKaliteGuvenceEnabled: () => flags.kg, useMaliyetEnabled: () => flags.mal, useFeatureFlags: () => ({ data: undefined }) }));
vi.mock("./construction/ItemWarpSection", () => ({ ItemWarpSection: () => <p>çözgü bölümü</p> }));
const WIDTH = /Mamul en \(cm\)/;
// D3: sekme içerikleri ağ çağırır — burada ölçülen sekmenin görünürlüğü ve açılış sekmesi.
vi.mock("./variants/ItemVariantsSection", async (orig) => ({ ...(await orig<object>()), ItemVariantsSection: () => <p>varyant listesi</p> }));
// D4 "Ticari" sekmesinin kendi bekçisi var (`commercial/ItemCommercialSection.test.tsx`); burada sekme çizilmez.
vi.mock("./commercial/ItemCommercialSection", () => ({ useItemCommercialSections: () => null, ItemCommercialSection: () => null }));
vi.mock("./construction/ItemWeftSection", () => ({ ItemWeftSection: () => null }));
vi.mock("./construction/ItemWeaveSection", () => ({ ItemWeaveSection: () => null }));

/** Tip seçicisi formun İLK açılırı (kumaş kartında Yanmazlık da açılır — K8). */
const tipCombo = () => screen.getAllByRole("combobox")[0]!;
const COLORS = "Renkler (kartela)";
const PROPS = "Uygulanabilir özellikler";

const item = (over: Partial<Item>): Item =>
  ({ id: "i1", code: "STK-000001", name: "PATOS", itemType: "FABRIC", unit: "MT", isActive: true, linearDensityDen: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...over }) as Item;

describe("ItemFormDialog — izinli renk/özellik yalnız kumaşta", () => {
  it("⭐ §1 kumaş kartında alanlar var; iplik kartında YOK", () => {
    const { unmount } = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ itemType: "FABRIC" })} />);
    expect(screen.getByText(COLORS)).toBeInTheDocument();
    expect(screen.getByText(PROPS)).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    unmount();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ itemType: "YARN", unit: "KG" })} />);
    expect(screen.queryByText(COLORS)).toBeNull();
    expect(screen.queryByText(PROPS)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull(); // liste yoksa not da yok
  });

  it("⭐ §2 create: tür İplik'e çevrilince alanlar kaybolur, payload'da allowedColorIds YOK", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText(COLORS)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Ad/), "İPLİK 150D");
    await user.click(tipCombo());
    await user.click(await screen.findByRole("option", { name: "İplik" }));
    await waitFor(() => expect(screen.queryByText(COLORS)).toBeNull());
    expect(screen.queryByText(PROPS)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.itemType).toBe("YARN");
    expect("allowedColorIds" in payload).toBe(false);
    expect("allowedPropertyIds" in payload).toBe(false);
  });

  it("⭐ §3 eski iplik kartında liste kalmışsa NOT görünür; Güncelle → payload [] ile kaldırır", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const stale = item({ itemType: "YARN", unit: "KG", allowedColors: [{ colorId: "c1", color: { id: "c1", code: "KRM", name: "Krem", hex: null } }] });
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={stale} />);
    expect(screen.queryByText(COLORS)).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("İplik kartında renk/özellik listesi tutulmaz, kaydedince kaldırılır.");
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ allowedColorIds: [], allowedPropertyIds: [] });
  });
});

describe("ItemFormDialog — Mamul en (cm) Kalite Güvence ya da dokuma açıkken (K4P · inceleme Not 2)", () => {
  it("⭐ §4a iki modül de kapalı: alan yok, payload'da widthCm anahtarı yok", async () => {
    flags.kg = false;
    flags.dk = false;
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({ widthCm: "280.00" })} />);
    expect(screen.queryByLabelText(WIDTH)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect("widthCm" in (onSubmit.mock.calls[0]![0] as Record<string, unknown>)).toBe(false);
  });

  it("⭐ §4b modül açık: kumaşta alan dolu gelir, düzenlenen değer payload'a noktalı gider", async () => {
    flags.kg = true;
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({ widthCm: "280.00" })} />);
    const input = screen.getByLabelText(WIDTH);
    expect(input).toHaveValue("280");
    await user.clear(input);
    await user.type(input, "152,5");
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ widthCm: "152.5" });
  });

  it("⭐ §4c modül açık + iplik kartı: alan yok (en kumaş özelliği)", () => {
    flags.kg = true;
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ itemType: "YARN", unit: "KG" })} />);
    expect(screen.queryByLabelText(WIDTH)).toBeNull();
  });

  it("⭐ §4d yalnız dokuma açık: kumaşta mamul en görünür ve payload'a gider", async () => {
    flags.kg = false;
    flags.dk = true;
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({ widthCm: "280.00" })} />);
    expect(screen.getByLabelText(WIDTH)).toHaveValue("280");
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ widthCm: "280" });
    flags.dk = false;
  });
});

describe("ItemFormDialog — seçici kapsamı Tip'i kilitler (inceleme Not 10b)", () => {
  it("⭐ yalnız kumaş kapsamı: Tip gri salt-okunur kutu (açılır liste değil, yıldızsız); başlık 'Yeni Kumaş'; birim 'm'", () => {
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} allowedTypes={["FABRIC"]} />);
    const tip = screen.getByLabelText(/^Tip/);
    expect(tip).toHaveValue("Kumaş");
    expect(tip).toHaveAttribute("readonly");
    expect(screen.queryByText("Tip")?.closest("label")?.textContent).not.toContain("*");
    expect(screen.getByRole("heading", { name: "Yeni Kumaş" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("m")).toBeInTheDocument();
  });

  it("⭐ yalnız iplik kapsamı: varsayılan Kumaş yerine İplik ön-ayarlı gelir", () => {
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} allowedTypes={["YARN"]} />);
    expect(screen.getByLabelText(/^Tip/)).toHaveValue("İplik");
    expect(screen.getByDisplayValue("kg")).toBeInTheDocument();
  });

  it("çok tip kapsamı: yalnız o tipler listelenir, kilit yok", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} allowedTypes={["FABRIC", "CONSUMABLE"]} />);
    await user.click(tipCombo());
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Kumaş", "Sarf Malzeme"]);
  });
});

describe("ItemFormDialog — hizmet kartı ayrı tabloda (D2)", () => {
  it("⭐ Tip seçenekleri yalnız Kumaş · İplik · Sarf — 'Hizmet' YOK (Tanımlar › Hizmet Kartları)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    await user.click(tipCombo());
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Kumaş", "İplik", "Sarf Malzeme"]);
  });
});

describe("ItemFormDialog — iplik firesi % (SY-3 I2)", () => {
  const LABEL = /İplik firesi/;
  it("maliyet kapalı: iplikte de alan yok, payload'da anahtar yok", async () => {
    flags.mal = false;
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({ itemType: "YARN", unit: "KG", yarnWastePct: 3 })} />);
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect("yarnWastePct" in (onSubmit.mock.calls[0]![0] as Record<string, unknown>)).toBe(false);
  });

  it("maliyet açık: iplikte kayıtlı değer gelir, düzenlenen değer noktalı gider; kumaşta alan yok", async () => {
    flags.mal = true;
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} initial={item({ itemType: "YARN", unit: "KG", yarnWastePct: 3 })} />);
    const input = screen.getByLabelText(LABEL);
    expect(input).toHaveValue("3");
    await user.clear(input);
    await user.type(input, "4,25");
    await user.click(screen.getByRole("button", { name: "Güncelle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ yarnWastePct: "4.25" });
    unmount();
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({ itemType: "FABRIC" })} />);
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    flags.mal = false;
  });
});

describe("ItemFormDialog — Varyantlar sekmesi ve açılış sekmesi (D3/K7)", () => {
  const asUser = (permissions: string[] | null) => useAuthStore.setState({ user: permissions ? ({ userId: "u1", username: "k", permissions } as unknown as JwtPayload) : null });
  // D4/K1: Çözgü sekmesi çözgü kartı rejimine (devere ∨ dokuma) bağlı — devere kapalı, dokuma açık kumaşta görünür.
  it("⭐ çözgü kartı rejimi: devere kapalı + dokuma açık → kumaşta Çözgü sekmesi var; rejim kapalı → yok", () => {
    flags.dk = true;
    const { unmount } = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({})} initialTab="warp" />);
    expect(screen.getByRole("tab", { name: "Çözgü" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("çözgü bölümü")).toBeInTheDocument();
    unmount();
    flags.dk = false;
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({})} initialTab="warp" />);
    expect(screen.queryByRole("tab", { name: "Çözgü" })).toBeNull();
  });
  it("⭐ kayıtlı kumaş + dokuma + okuma izni: Varyantlar sekmesi var; initialTab ile o sekmede açılır", () => {
    flags.dk = true;
    asUser(["warpspec:read", "station:read"]);
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({})} initialTab="variants" />);
    expect(screen.getByRole("tab", { name: "Varyantlar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("varyant listesi")).toBeInTheDocument();
    expect(screen.getByText(/anında kaydedilir/)).toBeInTheDocument();
    flags.dk = false;
    asUser(null);
  });
  it("yeni kumaşta (kimlik yok) ya da şablon okuma izni yoksa sekme yok; olmayan sekme istenirse Genel açılır", () => {
    flags.dk = true;
    asUser(["warpspec:read", "station:read"]);
    const { unmount } = renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByRole("tab", { name: "Varyantlar" })).toBeNull();
    unmount();
    asUser(["warpspec:read"]);
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={item({})} initialTab="variants" />);
    expect(screen.queryByRole("tab", { name: "Varyantlar" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Genel" })).toHaveAttribute("aria-selected", "true");
    flags.dk = false;
    asUser(null);
  });
});
