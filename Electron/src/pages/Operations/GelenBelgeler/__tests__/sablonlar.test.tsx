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

const row = (o: Partial<SenderTemplateView>): SenderTemplateView => ({
  code: "ceki-listesi-a", name: "Kumaş çeki listesi", version: 1, rowVersion: 1, inEngine: true, id: "t1",
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
