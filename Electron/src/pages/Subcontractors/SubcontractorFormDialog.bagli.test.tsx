// =============================================================================
// BEKÇİ — Fason formu "Bağlı cari" ZORUNLU (kullanıcı 15:50): bağsız profil kaydedilemez
// =============================================================================
// ① yeni fason: ad + kategori dolu, bağlı cari boş → Kaydet → şema hatası (NO_LINK_MESSAGE), onSubmit ÇAĞRILMAZ
// ② bağlı cari seçilince (create-and-link yolu ya da seçici) → Kaydet → onSubmit customerId ile
// ③ şema: customerId null/"" → geçmez; uuid → geçer
// Negatif sonda (kırmızı görüldü): şemada `customerId` yeniden `nullable()` olunca ① ve ③ ❌.
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SubcontractorFormDialog } from "./SubcontractorFormDialog";
import { NO_LINK_MESSAGE, subcontractorFormDefaults, subcontractorFormSchema } from "./schema";

vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: async () => ({ data: [{ id: "cat1", name: "Boyahane", code: "BOYA", description: null }] }) }));
vi.mock("@/components/forms/DocumentProfileSelect", () => ({ DocumentProfileSelect: () => null }));
const create = vi.fn();
vi.mock("@/pages/Customers/service", () => ({
  customerService: { create: (...a: unknown[]) => create(...a), getById: async () => ({ success: true, data: { id: "c1", code: "TED1", name: "Boyahane Ltd" } }), listCursor: vi.fn(), getAll: vi.fn(), update: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("SubcontractorFormDialog — bağlı cari zorunlu", () => {
  it("⭐ ① bağsız Kaydet → NO_LINK_MESSAGE, onSubmit çağrılmaz", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<SubcontractorFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await userEvent.type(document.getElementById("name") as HTMLInputElement, "Boyahane Ltd");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Boyahane/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await screen.findByText(NO_LINK_MESSAGE);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("⭐ ② 'Cari kart oluştur ve bağla' → bağ dolunca Kaydet → onSubmit customerId ile", async () => {
    create.mockResolvedValue({ success: true, data: { id: "6c2c0f2e-2c3a-4f6f-9c3d-8a5a6b7c8d9e", name: "Boyahane Ltd" } });
    const onSubmit = vi.fn();
    renderWithProviders(<SubcontractorFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await userEvent.type(document.getElementById("name") as HTMLInputElement, "Boyahane Ltd");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Boyahane/ }));
    await userEvent.click(screen.getByRole("button", { name: /Cari kart oluştur ve bağla/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ isSupplierRole: true })));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ customerId: "6c2c0f2e-2c3a-4f6f-9c3d-8a5a6b7c8d9e", categoryIds: ["cat1"] });
  });

  it("③ şema: customerId boş → geçmez; uuid → geçer", () => {
    const base = { ...subcontractorFormDefaults, name: "X", categoryIds: ["cat1"] };
    expect(subcontractorFormSchema.safeParse({ ...base, customerId: null }).success).toBe(false);
    expect(subcontractorFormSchema.safeParse({ ...base, customerId: "" }).success).toBe(false);
    expect(subcontractorFormSchema.safeParse({ ...base, customerId: "6c2c0f2e-2c3a-4f6f-9c3d-8a5a6b7c8d9e" }).success).toBe(true);
  });
});
