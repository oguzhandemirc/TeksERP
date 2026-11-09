// Belge Tipleri (eski "Gönderen şablonları", E2 + belge tanıt 3 aşama): liste, kullanma/geri al + seçici → PATCH yalnız değişen alan,
// fotoğrafsız düzenle (PATCH /tanim yalnız değişen parça), kural özeti, şablon önerisi etiketi, bulunabilirlik.
// Negatif sonda: buildEditBody her zaman `name` koyunca "yalnız değişen" kırmızı; 409 satırı kaldırılınca "başka biri" kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { routeModuleOf } from "@/lib/route-modules";
import { SenderTemplatesPage, SENDER_TEMPLATES_PATH, DOCUMENT_TYPES_TITLE } from "../GonderenSablonlariPage";
import { SuggestionChips } from "../SuggestionChips";
import type { SenderTemplateView } from "../types";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
// Seçici doğrudan modal açar; burada tık = "c9 seçildi" (modal içi ayrı bileşenin testinde).
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ placeholder, onChange, value }: { placeholder?: string; onChange: (id: string | null) => void; value: string | null }) => (
    <button type="button" data-value={value ?? ""} onClick={() => onChange("c9")}>
      {placeholder}
    </button>
  ),
}));

// Yükleme zinciri bu testin konusu değil (RemarkDialog kendi testinde değil; yalnız düğme varlığı ölçülür).
vi.mock("../tanit/RemarkDialog", () => ({ RemarkDialog: () => <div data-testid="remark-dialog" /> }));

const listSenderTemplates = vi.fn();
const updateSenderTemplate = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => Promise.resolve({ multiPartyWorkOrder: "SINGLE" }),
  listSenderTemplates: (...a: unknown[]) => listSenderTemplates(...a),
  updateSenderTemplate: (...a: unknown[]) => updateSenderTemplate(...a),
}));

const getUserTemplate = vi.fn();
const editUserTemplate = vi.fn();
const listUserTemplates = vi.fn();
vi.mock("../tanit/service", () => ({
  USER_TEMPLATES_QUERY_KEY: ["gelen-belge", "sablonlar", "ozel"],
  getUserTemplate: (...a: unknown[]) => getUserTemplate(...a),
  editUserTemplate: (...a: unknown[]) => editUserTemplate(...a),
  listUserTemplates: (...a: unknown[]) => listUserTemplates(...a),
  previewTemplateReset: () => Promise.resolve({ items: [], failed: [] }),
  resetTemplates: vi.fn(),
}));

const row = (o: Partial<SenderTemplateView>): SenderTemplateView => ({
  code: "ceki-listesi-a", name: "Kumaş çeki listesi", version: 1, rowVersion: 1, inEngine: true, inFile: true, id: "t1",
  isActive: true, hitCount: 7, senderCustomer: { id: "c1", code: "C1", name: "Güleçsoy", isActive: true },
  defaultOwnerCustomer: null, updatedAt: "2026-10-29T08:00:00Z", ...o,
});

beforeEach(() => {
  listSenderTemplates.mockReset().mockResolvedValue([row({}), row({ code: "urun-sevk-fisi", name: "Ürün sevk fişi", id: null, hitCount: 0, senderCustomer: null })]);
  updateSenderTemplate.mockReset().mockResolvedValue(row({}));
  listUserTemplates.mockReset().mockResolvedValue([]);
});

describe("gönderen şablonları sayfası", () => {
  it("⭐ başlık Belge Tipleri; boş hazır tip bölümü ve yanıltıcı metin yok", async () => {
    listSenderTemplates.mockResolvedValue([]);
    renderWithProviders(<SenderTemplatesPage />);
    expect(await screen.findByTestId("user-templates-empty")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: DOCUMENT_TYPES_TITLE })).toBeInTheDocument();
    expect(screen.queryByText(/Okuma motorunda gönderen şablonu yok/)).toBeNull();
    expect(screen.queryByTestId("file-templates-heading")).toBeNull();
  });

  it("satırı olmayan şablon da listelenir; okuma sayısı görünür", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    expect(await screen.findByText("Kumaş çeki listesi")).toBeInTheDocument();
    expect(screen.getByText("Ürün sevk fişi")).toBeInTheDocument();
    expect(screen.getByText(/ceki-listesi-a · sürüm 1 · 7 okuma/)).toBeInTheDocument();
  });

  it("hazır tipi kullanmama yalnız isActive gönderir", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await screen.findByTestId("file-templates-heading");
    await userEvent.click(within(screen.getByTestId("template-ceki-listesi-a")).getByRole("button", { name: "Kullanma" }));
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("ceki-listesi-a", { isActive: false }));
  });

  it("⭐ pasif tip 'Kullanılmayan tipler'de: Geri al isActive true; yetim satır kilitli", async () => {
    listSenderTemplates.mockResolvedValue([
      row({ isActive: false, inEngine: false }),
      row({ code: "eski-sablon", name: "Eski şablon", id: "t9", inEngine: false, inFile: false }),
    ]);
    renderWithProviders(<SenderTemplatesPage />);
    const section = await screen.findByTestId("unused-templates");
    expect(screen.queryByTestId("template-ceki-listesi-a")).toBeNull();
    await userEvent.click(within(section).getByRole("button", { name: /Kullanılmayan tipler \(2\)/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kumaş çeki listesi geri al" }));
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("ceki-listesi-a", { isActive: true }));
    expect(screen.queryByRole("button", { name: "Eski şablon geri al" })).toBeNull();
    expect(screen.getByText("Okuma motorunda artık yok")).toBeInTheDocument();
  });

  it("gönderen ve varsayılan sahip seçicisi ayrı alanı yazar", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await screen.findByText("Ürün sevk fişi");
    await userEvent.click(screen.getAllByRole("button", { name: "Gönderen seç" })[1]!);
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("urun-sevk-fisi", { senderCustomerId: "c9" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Varsayılan sahip seç" })[0]!);
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("ceki-listesi-a", { defaultOwnerCustomerId: "c9" }));
  });

  it("liste hatası boş liste gibi gösterilmez", async () => {
    listSenderTemplates.mockRejectedValue(new Error("x"));
    renderWithProviders(<SenderTemplatesPage />);
    expect(await screen.findByText("Belge tipleri yüklenemedi.")).toBeInTheDocument();
  });
});

describe("parti no alanı (Gülkesim parti/metre P1)", () => {
  // Negatif sonda: aday düğmesinin `onPatch({ batchNoKey })` çağrısı kaldırılınca "seçim PATCH" kırmızı.
  const withKey = (batchNoKey: string | null) => row({
    batchNoKey,
    batchNoCandidates: [{ field: "isEmriNo", kind: "BARCODE", label: "İş Emri No" }, { field: "musteriPartiNo", kind: "BATCH", label: "Müşteri Parti No" }],
  });

  it("⭐ adaylar şablon tanımından; seçim yalnız batchNoKey gönderir; temizle null gönderir", async () => {
    listSenderTemplates.mockResolvedValue([withKey("isEmriNo")]);
    renderWithProviders(<SenderTemplatesPage />);
    const current = await screen.findByRole("button", { name: /İş Emri No \(barkod no\)/ });
    expect(current).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(current);
    expect(updateSenderTemplate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Müşteri Parti No \(parti no\)/ }));
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("ceki-listesi-a", { batchNoKey: "musteriPartiNo" }));
    await userEvent.click(screen.getByRole("button", { name: "Kumaş çeki listesi parti no alanını temizle" }));
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("ceki-listesi-a", { batchNoKey: null }));
  });

  it("seçili değilken temizle yok; tanımda olmayan hatırlanan anahtar uyarılır; eski backend bölüm çizmez", async () => {
    listSenderTemplates.mockResolvedValue([withKey(null), row({ code: "urun-sevk-fisi", name: "Ürün sevk fişi", batchNoKey: "eskiAlan", batchNoCandidates: [] }), row({ code: "eski", name: "Eski" })]);
    renderWithProviders(<SenderTemplatesPage />);
    expect(await screen.findByTestId("batch-no-key-ceki-listesi-a")).toHaveTextContent("Seçili değil");
    expect(screen.queryByRole("button", { name: "Kumaş çeki listesi parti no alanını temizle" })).toBeNull();
    expect(screen.getByTestId("batch-no-key-urun-sevk-fisi")).toHaveTextContent("Hatırlanan alan (eskiAlan) şablon tanımında artık yok");
    expect(screen.getByRole("button", { name: "Ürün sevk fişi parti no alanını temizle" })).toBeInTheDocument();
    expect(screen.queryByTestId("batch-no-key-eski")).toBeNull();
  });
});

describe("şablon önerisi etiketi", () => {
  it("TEMPLATE kaynağı '(şablon)' ile işaretlenir", () => {
    renderWithProviders(
      <SuggestionChips suggestion={{ rawText: null, suggested: { id: "c1", code: "C1", name: "Güleçsoy", score: 1 }, source: "TEMPLATE", list: [] }} currentId={null} onPick={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Güleçsoy \(şablon\)/ })).toHaveAttribute("title", "Gönderen şablonuna bağlı cari");
  });
});

describe("bulunabilirlik", () => {
  it("karo + palet girişi aynı adres ve izinle; modül kapısı gelenBelge", () => {
    const tile = operationsTiles.find((t) => t.key === "gelen-belge-sablonlari");
    expect(tile?.to).toBe(SENDER_TEMPLATES_PATH);
    expect(tile?.title).toBe(DOCUMENT_TYPES_TITLE);
    expect(tile?.permission).toBe("gelen-belge:template");
    expect(allCommandEntries.find((e) => e.to === SENDER_TEMPLATES_PATH)?.visibleWhen).toBe(tile?.visibleWhen);
    expect(routeModuleOf(SENDER_TEMPLATES_PATH)).toBe("gelenBelgeEnabled");
  });
});

describe("tanıtılan belge tipleri (S1b + fotoğrafsız düzenle)", () => {
  const user = row({ kind: "USER", code: "u-gulecsoy", name: "Güleçsoy çeki", id: "t7", inEngine: true, inFile: false, isActive: true, senderCustomer: null });
  const tpl = {
    id: "u-gulecsoy", version: 3, name: "Güleçsoy çeki",
    fields: [{ key: "partiNo", label: "Ham PartiNo" }, { key: "hedefKg", label: "KG/MT" }, { key: "toplamMetre", label: "Metre" }],
    sections: { startLabels: ["Ham PartiNo"], fields: ["partiNo"] },
    tables: [{ totals: { labels: ["T.Adet"] } }],
    rules: { multiParty: "PER_PARTY" },
    identifiers: { keywords: ["GÜLEÇSOY", "ÇEKİ"], minScore: 0.6 },
  };
  beforeEach(() => {
    listSenderTemplates.mockResolvedValue([row({}), user]);
    listUserTemplates.mockResolvedValue([{ id: "t7", code: "u-gulecsoy", name: "Güleçsoy çeki", version: 3, isActive: true, updatedAt: "", template: tpl }]);
    getUserTemplate.mockReset().mockResolvedValue({
      id: "t7", code: "u-gulecsoy", name: "Güleçsoy çeki", version: 3, isActive: true, updatedAt: "", template: tpl,
      versions: [{ version: 3, createdAt: "2026-11-03T05:00:00Z", createdById: null }],
    });
    editUserTemplate.mockReset().mockResolvedValue({ code: "u-gulecsoy", name: "Güleçsoy çeki", version: 4, warnings: [], changes: {} });
  });

  it("kart kural özetini ve üç düğmeyi gösterir", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    const rules = await screen.findByTestId("template-rules-u-gulecsoy");
    expect(rules).toHaveTextContent("Çok parti: Her parti ayrı");
    expect(rules).toHaveTextContent("Tekrar eden bölüm: Ham PartiNo");
    expect(rules).toHaveTextContent("Toplam satırı: T.Adet");
    expect(screen.getByTestId("user-template-edit-u-gulecsoy")).toBeInTheDocument();
    expect(screen.getByTestId("template-remark-u-gulecsoy")).toBeInTheDocument();
    expect(screen.getByTestId("template-reset-u-gulecsoy")).toBeInTheDocument();
  });

  it("⭐ düzenle: değişiklik yokken Kaydet kapalı; kimlik + alan kaldır + kural → PATCH yalnız değişen parça ve expectedVersion", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByTestId("user-template-edit-u-gulecsoy"));
    expect(await screen.findByTestId("user-template-save")).toBeDisabled();
    expect(screen.getByTestId("user-template-hint")).toHaveTextContent("Değişiklik yok");
    await userEvent.click(screen.getByRole("button", { name: "ÇEKİ kimlik yazısını çıkar" }));
    await userEvent.type(screen.getByPlaceholderText("Yeni kimlik yazısı"), "BOYA SAN.{Enter}");
    await userEvent.click(screen.getByRole("checkbox", { name: "Hedef kg alanını kaldır" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Fabrika ayarı \(şu an: Tek/ }));
    await userEvent.click(screen.getByTestId("user-template-save"));
    await waitFor(() => expect(editUserTemplate).toHaveBeenCalledTimes(1));
    expect(editUserTemplate.mock.calls[0]).toEqual(["u-gulecsoy", {
      expectedVersion: 3, identifiers: ["GÜLEÇSOY", "BOYA SAN."], dropFields: ["hedefKg"], rules: { multiParty: null },
    }]);
  });

  it("yalnız ad değişince gövdede yalnız ad", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByTestId("user-template-edit-u-gulecsoy"));
    const name = await screen.findByTestId("user-template-name");
    await userEvent.type(name, " 2");
    await userEvent.click(screen.getByTestId("user-template-save"));
    await waitFor(() => expect(editUserTemplate).toHaveBeenCalledWith("u-gulecsoy", { expectedVersion: 3, name: "Güleçsoy çeki 2" }));
  });

  it("⭐ 409 sürüm çakışması: 'Başka biri değiştirdi' + Yenile", async () => {
    const err = Object.assign(new Error("409"), { isAxiosError: true, response: { status: 409, data: { details: { code: "USER_TEMPLATE_VERSION_CHANGED" } } } });
    editUserTemplate.mockRejectedValue(err);
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByTestId("user-template-edit-u-gulecsoy"));
    await userEvent.type(await screen.findByTestId("user-template-name"), "x");
    await userEvent.click(screen.getByTestId("user-template-save"));
    expect(await screen.findByTestId("user-template-conflict")).toHaveTextContent("Başka biri değiştirdi");
    await userEvent.click(within(screen.getByTestId("user-template-conflict")).getByRole("button", { name: /Yenile/ }));
    await waitFor(() => expect(getUserTemplate).toHaveBeenCalledTimes(2));
  });

  it("bütün alanlar kaldırılamaz", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByTestId("user-template-edit-u-gulecsoy"));
    for (const n of ["Gönderen parti no", "Gelen metre", "Hedef kg"]) await userEvent.click(await screen.findByRole("checkbox", { name: `${n} alanını kaldır` }));
    expect(screen.getByTestId("user-template-save")).toBeDisabled();
    expect(screen.getByTestId("user-template-hint")).toHaveTextContent("en az bir alan kalmalı");
  });

});

describe("belge tipi düzenle — Barkoddan al (2026-11-09)", () => {
  const user = row({ kind: "USER", code: "u-gulecsoy", name: "Güleçsoy çeki", id: "t7", inEngine: true, inFile: false, isActive: true, senderCustomer: null });
  const tpl = { id: "u-gulecsoy", version: 3, name: "Güleçsoy çeki", fields: [{ key: "partiNo", label: "Ham PartiNo" }, { key: "hedefKg", label: "KG/MT" }], identifiers: { keywords: ["GÜLEÇSOY"] } };
  beforeEach(() => {
    listSenderTemplates.mockResolvedValue([row({}), user]);
    listUserTemplates.mockResolvedValue([{ id: "t7", code: "u-gulecsoy", name: "Güleçsoy çeki", version: 3, isActive: true, updatedAt: "", template: tpl }]);
    getUserTemplate.mockReset().mockResolvedValue({ id: "t7", code: "u-gulecsoy", name: "Güleçsoy çeki", version: 3, isActive: true, updatedAt: "", template: tpl, versions: [] });
    editUserTemplate.mockReset().mockResolvedValue({ code: "u-gulecsoy", name: "Güleçsoy çeki", version: 4, warnings: [], changes: {} });
  });

  it("⭐ Barkoddan al: işaretlenince gövdede yalnız barcodeFields; kaldırılan alanın kutusu kapanır", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByTestId("user-template-edit-u-gulecsoy"));
    await userEvent.click(await screen.findByTestId("user-template-barcode-partiNo"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Hedef kg alanını kaldır" }));
    expect(screen.getByTestId("user-template-barcode-hedefKg")).toBeDisabled();
    await userEvent.click(screen.getByTestId("user-template-save"));
    await waitFor(() => expect(editUserTemplate).toHaveBeenCalledWith("u-gulecsoy", { expectedVersion: 3, dropFields: ["hedefKg"], barcodeFields: ["partiNo"] }));
  });

  it("işaretli alan kutusu dolu gelir; kaldırınca barcodeFields: []", async () => {
    const marked = { ...tpl, fields: tpl.fields.map((f) => (f.key === "partiNo" ? { ...f, fromBarcode: true } : f)) };
    getUserTemplate.mockResolvedValue({ id: "t7", code: "u-gulecsoy", name: "Güleçsoy çeki", version: 3, isActive: true, updatedAt: "", template: marked, versions: [] });
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByTestId("user-template-edit-u-gulecsoy"));
    const box = await screen.findByTestId("user-template-barcode-partiNo");
    expect(box).toBeChecked();
    expect(screen.getByTestId("user-template-save")).toBeDisabled();
    await userEvent.click(box);
    await userEvent.click(screen.getByTestId("user-template-save"));
    await waitFor(() => expect(editUserTemplate).toHaveBeenCalledWith("u-gulecsoy", { expectedVersion: 3, barcodeFields: [] }));
  });
});
