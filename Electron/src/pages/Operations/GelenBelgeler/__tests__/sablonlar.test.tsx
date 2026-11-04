// Gönderen şablonları (E2): liste, aktif/pasif + seçici → PATCH yalnız değişen alan, şablon önerisi etiketi, bulunabilirlik.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { routeModuleOf } from "@/lib/route-modules";
import { SenderTemplatesPage, SENDER_TEMPLATES_PATH } from "../GonderenSablonlariPage";
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

const listSenderTemplates = vi.fn();
const updateSenderTemplate = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  listSenderTemplates: (...a: unknown[]) => listSenderTemplates(...a),
  updateSenderTemplate: (...a: unknown[]) => updateSenderTemplate(...a),
}));

const getUserTemplate = vi.fn();
const updateUserTemplate = vi.fn();
vi.mock("../tanit/service", () => ({
  USER_TEMPLATES_QUERY_KEY: ["gelen-belge", "sablonlar", "ozel"],
  getUserTemplate: (...a: unknown[]) => getUserTemplate(...a),
  updateUserTemplate: (...a: unknown[]) => updateUserTemplate(...a),
}));

const row = (o: Partial<SenderTemplateView>): SenderTemplateView => ({
  code: "ceki-listesi-a", name: "Kumaş çeki listesi", version: 1, rowVersion: 1, inEngine: true, inFile: true, id: "t1",
  isActive: true, hitCount: 7, senderCustomer: { id: "c1", code: "C1", name: "Güleçsoy", isActive: true },
  defaultOwnerCustomer: null, updatedAt: "2026-10-29T08:00:00Z", ...o,
});

beforeEach(() => {
  listSenderTemplates.mockReset().mockResolvedValue([row({}), row({ code: "urun-sevk-fisi", name: "Ürün sevk fişi", id: null, hitCount: 0, senderCustomer: null })]);
  updateSenderTemplate.mockReset().mockResolvedValue(row({}));
});

describe("gönderen şablonları sayfası", () => {
  it("satırı olmayan şablon da listelenir; okuma sayısı görünür", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    expect(await screen.findByText("Kumaş çeki listesi")).toBeInTheDocument();
    expect(screen.getByText("Ürün sevk fişi")).toBeInTheDocument();
    expect(screen.getByText(/ceki-listesi-a · sürüm 1 · 7 okuma/)).toBeInTheDocument();
  });

  it("pasife alma yalnız isActive gönderir", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByRole("switch", { name: "Kumaş çeki listesi aktif" }));
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("ceki-listesi-a", { isActive: false }));
  });

  it("⭐ pasif dosya şablonu yeniden etkinleştirilebilir + ipucu; yetim satır kilitli", async () => {
    listSenderTemplates.mockResolvedValue([
      row({ isActive: false, inEngine: false }),
      row({ code: "eski-sablon", name: "Eski şablon", id: "t9", inEngine: false, inFile: false }),
    ]);
    renderWithProviders(<SenderTemplatesPage />);
    const sw = await screen.findByRole("switch", { name: "Kumaş çeki listesi aktif" });
    expect(sw).toBeEnabled();
    expect(screen.getByText("Pasif: belge bu şablonla tanınmaz.")).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("ceki-listesi-a", { isActive: true }));
    expect(screen.getByRole("switch", { name: "Eski şablon aktif" })).toBeDisabled();
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
    expect(await screen.findByText("Şablonlar yüklenemedi.")).toBeInTheDocument();
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
    expect(tile?.permission).toBe("gelen-belge:template");
    expect(allCommandEntries.find((e) => e.to === SENDER_TEMPLATES_PATH)?.visibleWhen).toBe(tile?.visibleWhen);
    expect(routeModuleOf(SENDER_TEMPLATES_PATH)).toBe("gelenBelgeEnabled");
  });
});

describe("tanıtılan belge tipleri (S1b)", () => {
  const user = row({ kind: "USER", code: "u-gulecsoy", name: "Güleçsoy çeki", id: "t7", inEngine: false, inFile: false, isActive: false, senderCustomer: null });
  beforeEach(() => {
    listSenderTemplates.mockResolvedValue([row({}), user]);
    getUserTemplate.mockReset().mockResolvedValue({
      id: "t7", code: "u-gulecsoy", name: "Güleçsoy çeki", version: 3, isActive: false, updatedAt: "",
      template: { id: "u-gulecsoy", version: 3, fields: [{ key: "partiNo" }], sections: { startLabels: ["Ham PartiNo"] }, identifiers: { keywords: ["GÜLEÇSOY", "ÇEKİ"], minScore: 0.6 } },
      versions: [{ version: 3, createdAt: "2026-11-03T05:00:00Z", createdById: null }],
    });
    updateUserTemplate.mockReset().mockResolvedValue({ code: "u-gulecsoy", name: "Güleçsoy çeki", version: 4 });
  });

  it("ayrı bölümde listelenir; pasif kullanıcı şablonu yeniden etkinleştirilebilir", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await screen.findByTestId("user-templates-heading");
    const sw = await screen.findByRole("switch", { name: "Güleçsoy çeki aktif" });
    expect(sw).toBeEnabled();
    await userEvent.click(sw);
    await waitFor(() => expect(updateSenderTemplate).toHaveBeenCalledWith("u-gulecsoy", { isActive: true }));
    expect(screen.queryByText("Okuma motorunda artık yok")).toBeNull();
  });

  it("düzenle: kimlik yazısı çıkar/ekle → PUT expectedVersion, şablonun geri kalanı aynen", async () => {
    renderWithProviders(<SenderTemplatesPage />);
    await userEvent.click(await screen.findByTestId("user-template-edit-u-gulecsoy"));
    await userEvent.click(await screen.findByRole("button", { name: "ÇEKİ kimlik yazısını çıkar" }));
    await userEvent.type(screen.getByPlaceholderText("Yeni kimlik yazısı"), "BOYA SAN.{Enter}");
    await userEvent.click(screen.getByTestId("user-template-save"));
    await waitFor(() => expect(updateUserTemplate).toHaveBeenCalledTimes(1));
    const [code, body] = updateUserTemplate.mock.calls[0]!;
    expect(code).toBe("u-gulecsoy");
    expect(body).toEqual({
      expectedVersion: 3, name: "Güleçsoy çeki",
      template: { fields: [{ key: "partiNo" }], sections: { startLabels: ["Ham PartiNo"] }, identifiers: { keywords: ["GÜLEÇSOY", "BOYA SAN."], minScore: 0.6 } },
    });
  });
});
