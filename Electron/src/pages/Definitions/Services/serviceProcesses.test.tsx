// BEKÇİ — hizmet kartı ↔ süreç türü eşlemesi (fason F3): uç yolları, başka karta eşli türün seçilemezliği,
// pasif türün yalnız kendi kartında görünmesi, kaydın KÜME (PUT) olarak gitmesi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
const put = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } }));
vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: async () => ({
    data: [
      { id: "c-boya", name: "Boyahane", isActive: true },
      { id: "c-apre", name: "Apre", isActive: true },
      { id: "c-sardon", name: "Şardon", isActive: true },
      { id: "c-eski", name: "Eski yıkama", isActive: false },
      { id: "c-eski2", name: "Eski baskı", isActive: false },
    ],
  }),
}));

const { getServiceProcessMap, processOptions, putServiceItemProcesses, lastServiceProcessMap } = await import("./serviceProcesses");
const { ServiceProcessesDialog } = await import("./ServiceProcessesDialog");
const { ServiceFormDialog } = await import("./ServiceFormDialog");
const { withProcessWrite } = await import("./serviceProcessWrite");

const MAP = [
  { categoryId: "c-boya", categoryCode: "K1", categoryName: "Boyahane", categoryActive: true, serviceItemId: "s1", serviceItemCode: "H1", serviceItemName: "Boya hizmeti" },
  { categoryId: "c-sardon", categoryCode: "K2", categoryName: "Şardon", categoryActive: true, serviceItemId: "s2", serviceItemCode: "H2", serviceItemName: "Şardon hizmeti" },
  { categoryId: "c-eski", categoryCode: "K3", categoryName: "Eski yıkama", categoryActive: false, serviceItemId: "s1", serviceItemCode: "H1", serviceItemName: "Boya hizmeti" },
];

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { success: true, data: MAP } });
  put.mockReset().mockResolvedValue({ data: { success: true, data: [], changed: true } });
});

describe("süreç türü eşlemesi", () => {
  it("⭐ uçlar: harita GET /process-map, kayıt PUT /:id/processes { categoryIds }", async () => {
    await getServiceProcessMap();
    expect(get).toHaveBeenCalledWith("/api/service-items/process-map");
    expect(lastServiceProcessMap()).toHaveLength(3);
    await putServiceItemProcesses("s1", ["c-boya"]);
    expect(put).toHaveBeenCalledWith("/api/service-items/s1/processes", { categoryIds: ["c-boya"] });
  });

  it("⭐ başka karta eşli tür işaretli; pasif tür yalnız kendi kartına eşliyse listede", () => {
    const opts = processOptions("s1", [
      { id: "c-boya", name: "Boyahane", isActive: true },
      { id: "c-sardon", name: "Şardon", isActive: true },
      { id: "c-eski", name: "Eski yıkama", isActive: false },
      { id: "c-eski2", name: "Eski baskı", isActive: false },
    ], MAP);
    expect(opts.map((o) => o.id)).toEqual(["c-boya", "c-eski", "c-sardon"]);
    expect(opts.find((o) => o.id === "c-sardon")?.takenBy).toBe("Şardon hizmeti");
    expect(opts.find((o) => o.id === "c-boya")?.takenBy).toBeNull();
  });

  it("⭐ diyalog: mevcut küme işaretli açılır, başka karta eşli tür kilitli, kaydet KÜMEYİ gönderir", async () => {
    renderWithProviders(<ServiceProcessesDialog item={{ id: "s1", code: "H1", name: "Boya hizmeti", isActive: true }} onClose={() => {}} />);
    const boya = await screen.findByRole("checkbox", { name: "Boyahane" });
    await waitFor(() => expect(boya).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Şardon" })).toBeDisabled();
    expect(screen.getByText("Şardon hizmeti kartına eşli")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Apre" }));
    fireEvent.click(boya);
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![0]).toBe("/api/service-items/s1/processes");
    expect([...(put.mock.calls[0]![1] as { categoryIds: string[] }).categoryIds].sort()).toEqual(["c-apre", "c-eski"]);
  });

  it("pasif kartta yeni tür eklenemez, mevcut çıkarılabilir", async () => {
    renderWithProviders(<ServiceProcessesDialog item={{ id: "s1", code: "H1", name: "Boya hizmeti", isActive: false }} onClose={() => {}} />);
    const boya = await screen.findByRole("checkbox", { name: "Boyahane" });
    await waitFor(() => expect(boya).toBeChecked());
    expect(boya).not.toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Apre" })).toBeDisabled();
  });
});

describe("B16 — hizmet kartı formunda süreçler", () => {
  const item = { id: "s1", code: "H1", name: "Boya hizmeti", unit: "MT", isActive: true, createdAt: "", updatedAt: "" };

  it("⭐ düzenleme formu kartın süreçlerini işaretli açar; değişen küme onSubmit'e gider", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ServiceFormDialog open onOpenChange={() => {}} initial={item} onSubmit={onSubmit} />);
    const boya = await screen.findByRole("checkbox", { name: "Boyahane" });
    await waitFor(() => expect(boya).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Şardon" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Apre" }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect([...(onSubmit.mock.calls[0]![1] as string[])].sort()).toEqual(["c-apre", "c-boya", "c-eski"]);
  });

  it("süreçlere dokunulmazsa null gider (küme yeniden yazılmaz)", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ServiceFormDialog open onOpenChange={() => {}} initial={item} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Boyahane" })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![1]).toBeNull();
  });

  it("⭐ yeni kart: önce kart doğar, süreçler dönen id'ye PUT edilir; süreç hatası kartı geri almaz", async () => {
    const base = { create: vi.fn().mockResolvedValue({ success: true, data: { id: "yeni" } }), update: vi.fn().mockResolvedValue({ success: true, data: { id: "s1" } }) };
    const svc = withProcessWrite(base as never, () => ["c-apre"], () => {});
    await svc.create({ name: "x" });
    expect(put).toHaveBeenCalledWith("/api/service-items/yeni/processes", { categoryIds: ["c-apre"] });
    put.mockRejectedValueOnce(new Error("409"));
    await expect(svc.create({ name: "y" })).resolves.toMatchObject({ data: { id: "yeni" } });
  });

  it("düzenlemede süreç 409'u fırlatılır (form açık kalır); null küme PUT atmaz", async () => {
    const base = { update: vi.fn().mockResolvedValue({ success: true, data: { id: "s1" } }) };
    put.mockRejectedValueOnce(new Error("409"));
    await expect(withProcessWrite(base as never, () => ["c-sardon"], () => {}).update("s1", {})).rejects.toThrow("409");
    put.mockClear();
    await withProcessWrite(base as never, () => null, () => {}).update("s1", {});
    expect(put).not.toHaveBeenCalled();
  });
});
