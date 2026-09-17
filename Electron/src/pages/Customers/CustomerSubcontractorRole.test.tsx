// =============================================================================
// BEKÇİ — Cari kartında "Fason iş yapar" (fason = carinin rolü, 2026-09-17) + Cariler listesi "Fason" rozeti
// =============================================================================
// ① profil yok → kutu boş; işaretle → `subcontractorService.create({customerId, code/name/... cariden})`
// ② aktif profil → kutu dolu + kod + fason sayfası bağlantısı; kaldır → `update(id,{isActive:false})` (silme yok)
// ③ pasif profil → kutu boş; işaretle → `update(id,{isActive:true})` (ikinci profil DOĞMAZ)
// ④ Tedarikçi ROLÜ olmayan kart → kutu pasif + "önce Tedarikçi rolü" ipucu (backend 400 ile aynı kural; rol modeli)
// ⑤ Rol kolonu: bayrak başına rozet — fason rolü (isSubcontractorRole) → "Fason"; yoksa yok
// Negatif sonda (kırmızı görüldü): rozet bayrak yerine `subcontractor.isActive` okuyunca ⑤ ❌;
// `CustomerSubcontractorRole` rol kapısı kaldırılınca ④ ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerSubcontractorRole, SUBCONTRACTOR_ROLE_LABEL, SUBCONTRACTOR_ROLE_TYPE_HINT } from "./CustomerSubcontractorRole";
import { customerColumns } from "./columns";
import type { Customer } from "./types";

const getAll = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/pages/Subcontractors/service", () => ({
  subcontractorService: { getAll: (...a: unknown[]) => getAll(...a), create: (...a: unknown[]) => create(...a), update: (...a: unknown[]) => update(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const cari = (over: Partial<Customer> = {}): Customer =>
  ({ id: "c1", code: "MUS-1", name: "Boya A.Ş.", taxNumber: "1234567890", type: "SUPPLIER", isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: false, contactPhone: "0212", address: "Bursa", isActive: true, createdAt: "", updatedAt: "", ...over }) as Customer;
const page = (rows: unknown[]) => Promise.resolve({ success: true, data: rows, pagination: { page: 1, pageSize: 1, total: rows.length, totalPages: 1 } });

beforeEach(() => {
  getAll.mockReset();
  create.mockReset();
  update.mockReset();
  create.mockResolvedValue({ success: true, data: { id: "s-new" } });
  update.mockResolvedValue({ success: true, data: { id: "s1" } });
});

describe("CustomerSubcontractorRole", () => {
  it("⭐ ① profil yok → kutu boş; işaretle → create(customerId + kart alanları cariden)", async () => {
    getAll.mockImplementation(() => page([]));
    renderWithProviders(<CustomerSubcontractorRole customer={cari()} />);
    const box = await screen.findByRole("checkbox", { name: SUBCONTRACTOR_ROLE_LABEL });
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box).not.toBeChecked();
    expect(getAll).toHaveBeenCalledWith(expect.objectContaining({ filters: { customerId: "c1" } }));
    await userEvent.click(box);
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerId: "c1", code: "MUS-1", name: "Boya A.Ş.", taxNumber: "1234567890", phone: "0212", address: "Bursa" })));
    expect(update).not.toHaveBeenCalled();
  });

  it("⭐ ② aktif profil → kutu dolu + kod + bağlantı; kaldır → update(id,{isActive:false}) — silme yok, create yok", async () => {
    getAll.mockImplementation(() => page([{ id: "s1", code: "FSN-1", isActive: true }]));
    renderWithProviders(<CustomerSubcontractorRole customer={cari()} />);
    const box = await screen.findByRole("checkbox", { name: SUBCONTRACTOR_ROLE_LABEL });
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText("FSN-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fason firmaları sayfasında aç/ })).toHaveAttribute("href", "/definitions/subcontractors");
    await userEvent.click(box);
    await waitFor(() => expect(update).toHaveBeenCalledWith("s1", { isActive: false }));
    expect(create).not.toHaveBeenCalled();
  });

  it("③ pasif profil → kutu boş '(pasif)'; işaretle → update(id,{isActive:true}) — ikinci profil doğmaz", async () => {
    getAll.mockImplementation(() => page([{ id: "s1", code: "FSN-1", isActive: false }]));
    renderWithProviders(<CustomerSubcontractorRole customer={cari({ isCustomerRole: true, isSupplierRole: true })} />);
    const box = await screen.findByRole("checkbox", { name: SUBCONTRACTOR_ROLE_LABEL });
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box).not.toBeChecked();
    expect(screen.getByText(/\(pasif\)/)).toBeInTheDocument();
    await userEvent.click(box);
    await waitFor(() => expect(update).toHaveBeenCalledWith("s1", { isActive: true }));
    expect(create).not.toHaveBeenCalled();
  });

  it("⭐ ④ Tedarikçi rolü olmayan kart → kutu pasif + rol ipucu; tıklama hiçbir şey yazmaz", async () => {
    getAll.mockImplementation(() => page([]));
    renderWithProviders(<CustomerSubcontractorRole customer={cari({ isCustomerRole: true, isSupplierRole: false })} />);
    const box = await screen.findByRole("checkbox", { name: SUBCONTRACTOR_ROLE_LABEL });
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(box).toBeDisabled();
    expect(screen.getByText(SUBCONTRACTOR_ROLE_TYPE_HINT)).toBeInTheDocument();
    expect(SUBCONTRACTOR_ROLE_TYPE_HINT).toContain("Tedarikçi rolü");
    await userEvent.click(box);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Cariler listesi Rol kolonu", () => {
  const rolCell = (c: Customer) => {
    const col = customerColumns.find((d) => "accessorKey" in d && d.accessorKey === "type")!;
    const Cell = col.cell as (ctx: { row: { original: Customer } }) => React.ReactNode;
    return Cell({ row: { original: c } });
  };
  const { render } = { render: (node: React.ReactNode) => renderWithProviders(<>{node}</>) };
  it("⭐ ⑤ üç rol → üç rozet (Müşteri · Tedarikçi · Fason), bayraklardan; 'Müşteri + Tedarikçi' birleşik rozeti YOK", () => {
    render(rolCell(cari({ isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true })));
    expect(screen.getByText("Müşteri")).toBeInTheDocument();
    expect(screen.getByText("Tedarikçi")).toBeInTheDocument();
    expect(screen.getByText("Fason")).toBeInTheDocument();
    expect(screen.queryByText("Müşteri + Tedarikçi")).toBeNull();
  });
  it("fason rolü false → 'Fason' rozeti YOK (profil pasifse sunucu bayrağı düşürür — bayrak tek kaynak)", () => {
    render(rolCell(cari({ isSupplierRole: true, isSubcontractorRole: false, subcontractor: { id: "s1", isActive: true } })));
    expect(screen.getByText("Tedarikçi")).toBeInTheDocument();
    expect(screen.queryByText("Fason")).toBeNull();
    expect(screen.queryByText("Müşteri")).toBeNull();
  });
});
