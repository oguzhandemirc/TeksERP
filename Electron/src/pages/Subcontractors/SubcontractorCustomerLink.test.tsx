// =============================================================================
// BEKÇİ — Fason formu "Bağlı cari" + "Cari kart oluştur ve bağla" (fason = carinin rolü, 2026-09-17)
// =============================================================================
// ① bağsız: seçici boş ("Bağlı cari yok — bağsız fason"), düğme var; tıkla → customerService.create
//    ({type:"SUPPLIER", ad/vergi no/telefon/adres fasondan}) → onChange(yeni id)
// ② bağlı (value var): düğme çizilmez; × → onChange(null)
// ③ ad boşsa düğme pasif
// Negatif sonda (kırmızı görüldü): create gövdesinden `type:"SUPPLIER"` kaldırılınca ① ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CREATE_AND_LINK_LABEL, SubcontractorCustomerLink } from "./SubcontractorCustomerLink";

const create = vi.fn();
const getById = vi.fn();
vi.mock("@/pages/Customers/service", () => ({
  customerService: { create: (...a: unknown[]) => create(...a), getById: (...a: unknown[]) => getById(...a), listCursor: vi.fn(), getAll: vi.fn(), update: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const source = { name: "Boyahane Ltd", taxNumber: "1234567890", phone: "0532 222", address: "Bursa OSB" };

beforeEach(() => {
  create.mockReset();
  getById.mockReset();
  create.mockResolvedValue({ success: true, data: { id: "c-new", name: "Boyahane Ltd" } });
  getById.mockResolvedValue({ success: true, data: { id: "c1", code: "TED1", name: "İplik A.Ş." } });
});

describe("SubcontractorCustomerLink", () => {
  it("⭐ ① bağsız: boş seçici + düğme; tıkla → create(type SUPPLIER, alanlar fasondan) → onChange(id)", async () => {
    const onChange = vi.fn();
    renderWithProviders(<SubcontractorCustomerLink value={null} onChange={onChange} source={source} />);
    expect(screen.getByRole("button", { name: "Bağlı cari seç (liste)" })).toHaveTextContent("Bağlı cari yok — bağsız fason");
    await userEvent.click(screen.getByRole("button", { name: new RegExp(CREATE_AND_LINK_LABEL) }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Boyahane Ltd", taxNumber: "1234567890", contactPhone: "0532 222", address: "Bursa OSB", type: "SUPPLIER", isActive: true }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("c-new"));
  });

  it("⭐ ② bağlı: düğme yok, kutu 'Ad — KOD'; × → onChange(null)", async () => {
    const onChange = vi.fn();
    renderWithProviders(<SubcontractorCustomerLink value="c1" onChange={onChange} source={source} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Bağlı cari seç (liste)" })).toHaveTextContent("İplik A.Ş. — TED1"));
    expect(screen.queryByRole("button", { name: new RegExp(CREATE_AND_LINK_LABEL) })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Bağı kaldır" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(create).not.toHaveBeenCalled();
  });

  it("③ ad boşsa düğme pasif", () => {
    renderWithProviders(<SubcontractorCustomerLink value={null} onChange={() => {}} source={{ ...source, name: "  " }} />);
    expect(screen.getByRole("button", { name: new RegExp(CREATE_AND_LINK_LABEL) })).toBeDisabled();
  });
});
