// =============================================================================
// DUMAN — ikinci dalga (C1): Depo · Makine · İstasyon · Fason firma · müşteri (elle top girişi).
// Örnek al gerçek formu "(örnekten)" + "(kopya)" ile açar, kayıt YALNIZ POST; PATCH yok.
// Düzenle ortak kartta formu açmaz → "Kart ekranında aç" (tanımın asıl ekranı yeni sekmede).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

const WH = { id: "w1", code: "DP-1", name: "Merkez", address: "Bursa", notes: null, isActive: true, isDefault: true };
const ST = { id: "st1", code: "IST-1", name: "Kalite", type: "INTERNAL", kind: "PROCESS_QC", department: null, isActive: true, appliesColor: false, appliesProperty: true, appliesQuality: true };
const MC = { id: "m1", code: "MAK-1", name: "Tezgah 1", stationId: "st1", isActive: true, warpBeamSlots: 1, station: { id: "st1", code: "IST-1", name: "Kalite" } };
const SUB = { id: "f1", code: "FSN-1", name: "Aras Boya", taxNumber: "123", phone: null, address: null, isActive: true, isFavorite: false, customerId: "cu1", categories: [{ categoryId: "cat1" }] };
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: vi.fn() },
}));
const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));

const { WarehousePicker, SubcontractorPicker } = await import("@/pages/BeamBodies/Pickers");
const { MachineRateDialog } = await import("@/pages/Cost/MachineRates/MachineRateDialog");
const { EntityPickerModal } = await import("../entity-picker/EntityPickerModal");
const { useStationRecordForm } = await import("@/pages/Stations/useStationRecordForm");
const { stationService } = await import("@/pages/Stations/service");
// Fason formu seçicide tembel yüklenir; modülü önden ısıt ki test süresi dinamik import'a gitmesin.
await import("@/pages/Subcontractors/SubcontractorFormDialog");

const listBody = (rows: unknown[]) => ({ data: { success: true, data: rows, pagination: { nextCursor: null, hasMore: false, limit: 50, page: 1, pageSize: 500, total: rows.length, totalPages: 1 } } });

function StationHarness({ onChange }: { onChange: (id: string | null) => void }) {
  const form = useStationRecordForm();
  return <EntityPickerModal value={null} onChange={onChange} service={stationService} recordForm={form} queryKey="t-stations" getLabel={(s) => s.name} title="İstasyon seç" placeholder="İstasyon seç" />;
}

beforeEach(() => {
  for (const f of [get, post, patch, openTab]) f.mockReset();
  get.mockImplementation((url: string) => {
    if (url.startsWith("/api/warehouses")) return Promise.resolve(listBody([WH]));
    if (url.startsWith("/api/stations")) return Promise.resolve(listBody([ST]));
    if (url.startsWith("/api/machines")) return Promise.resolve(listBody([MC]));
    if (url.startsWith("/api/subcontractors")) return Promise.resolve(listBody([SUB]));
    return Promise.resolve(listBody([]));
  });
  post.mockImplementation((_url: string, body: Record<string, unknown>) => Promise.resolve({ data: { success: true, data: { ...body, id: "new-1", code: "YENI" } } }));
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["warehouse:write", "station:write", "subcontractor:write", "cost:write"] } as unknown as JwtPayload });
});

describe("İkinci dalga seçiciler — Örnek al / Düzenle (C1)", () => {
  it("⭐ Depo: Örnek al formu doldurur, kayıt yalnız POST (kimliksiz), yeni depo seçili; PATCH yok", async () => {
    const onChange = vi.fn();
    renderWithProviders(<WarehousePicker value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Depo seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Merkez — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni Depo \(örnekten\)/ });
    expect(within(form).getByDisplayValue("Merkez (kopya)")).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/warehouses", expect.objectContaining({ name: "Merkez (kopya)", address: "Bursa" })));
    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("isDefault");
    expect(patch).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("new-1"));
  });

  it("⭐ seçici üst formun içindeyse: örnekten kaydet üst formu GÖNDERMEZ (portal olayı kabarmaz)", async () => {
    const outerSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    renderWithProviders(<form onSubmit={outerSubmit}><WarehousePicker value={null} onChange={vi.fn()} /></form>);
    await userEvent.click(screen.getByRole("button", { name: /Depo seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Merkez — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni Depo \(örnekten\)/ });
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it("⭐ Depo: Düzenle → Depolar ekranı yeni sekmede; PATCH yok", async () => {
    renderWithProviders(<WarehousePicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Depo seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Merkez — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/warehouses?search=DP-1", { forceNew: true }));
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Depo: yazma izni yoksa Yeni/Düzenle/Örnek al çizilmez", async () => {
    useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["warehouse:read"] } as unknown as JwtPayload });
    renderWithProviders(<WarehousePicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Depo seç/ }));
    await screen.findByText("Merkez");
    expect(screen.queryByRole("button", { name: /örnek al|düzenle|Yeni Depo/ })).toBeNull();
  });

  it("⭐ Makine (maliyet tarifesi): Örnek al yalnız POST /api/machines; Düzenle → Makineler ekranı", async () => {
    renderWithProviders(<MachineRateDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Makine seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Tezgah 1 — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni Makine \(örnekten\)/ });
    expect(within(form).getByDisplayValue("Tezgah 1 (kopya)")).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/machines", expect.objectContaining({ name: "Tezgah 1 (kopya)", stationId: "st1" })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("code");
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ İstasyon: Örnek al yeteneklerle gelir, yalnız POST; Düzenle → İstasyonlar ekranı", async () => {
    const onChange = vi.fn();
    renderWithProviders(<StationHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /İstasyon seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Kalite — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/stations?search=IST-1", { forceNew: true }));
    // Seçici açık kalır (yalnız paylaşılan-kayıt penceresi kapandı): aynı satırdan örnek al.
    await userEvent.click(await screen.findByRole("button", { name: /Kalite — örnek al/ }));
    const form = await screen.findByRole("dialog", { name: /Yeni İstasyon \(örnekten\)/ });
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/stations", expect.objectContaining({ name: "Kalite (kopya)", kind: "PROCESS_QC", appliesQuality: true })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("id");
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Fason firma: Düzenle → bağlı cari kartı; Örnek alda bağlı cari ve vergi no boş gelir (cari seçilmeden kayıt yok); PATCH yok", async () => {
    renderWithProviders(<SubcontractorPicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Devereci seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Aras Boya — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/cariler/cu1", { forceNew: true }));
    await userEvent.click(await screen.findByRole("button", { name: /Aras Boya — örnek al/ }));
    // Form tembel yüklenir (ücret/iplik bölümleri ağır) — ilk açılış 1 sn'yi aşabilir.
    const form = await screen.findByRole("dialog", { name: /Yeni Fason Firma \(örnekten\)/ }, { timeout: 8000 });
    expect(within(form).getByDisplayValue("Aras Boya (kopya)")).toBeInTheDocument();
    expect(within(form).queryByDisplayValue("123")).toBeNull();
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    expect((await within(form).findAllByText(/bir cari kartına bağlı olmalı/)).length).toBeGreaterThan(0);
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
