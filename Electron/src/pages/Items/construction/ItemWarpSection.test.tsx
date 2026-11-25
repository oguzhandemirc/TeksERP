// =============================================================================
// Ürün penceresi > Çözgü — kullanım yeri kuralı (kullanıcı 2026-11-25):
// paylaşılan kart burada DÜZENLENMEZ (PATCH yok, "Kart ekranında aç"), paylaşılmayan kart yerinde düzenlenir,
// Örnek al yalnız POST eder ve kaynağı değiştirmez.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import type { ItemFormValues } from "../schema";

const SPEC: WarpSpec = {
  id: "w1", code: "UA-Ç", name: "UA çözgüsü", yarnItemId: "y1", endsCount: 3000, selvedgeEnds: null, reedNo: 20, endsPerDent: 1,
  reedWidthCm: 350, takeUpPct: null, wastePct: 3, notes: null, isActive: true, createdAt: "", updatedAt: "",
  yarns: [{ yarnItemId: "y1", endsCount: 3000, sortOrder: 0 }], sequenceNote: null,
};
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const put = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: (...a: unknown[]) => put(...a) },
}));
const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));
// Ağır çözgü formu yerine taslağı olduğu gibi gönderen ince form: burada ölçülen yol seçimi (create/update), form değil.
vi.mock("@/pages/WarpSpecs/WarpSpecFormDialog", async () => {
  const { buildDefaults } = await import("@/pages/WarpSpecs/payload");
  return {
    WarpSpecFormDialog: (p: { open: boolean; initial?: WarpSpec | null; draft?: unknown; onSubmit: (v: unknown) => void }) => p.open ? (
      <div role="dialog" aria-label={p.initial ? "Çözgü düzenle" : p.draft ? "Çözgü örnekten" : "Çözgü yeni"}>
        <button type="button" onClick={() => p.onSubmit(p.draft ?? buildDefaults(p.initial ?? null))}>Kaydet</button>
      </div>
    ) : null,
  };
});

const { ItemWarpSection } = await import("./ItemWarpSection");

function Harness({ itemId }: { itemId: string | null }) {
  const form = useForm<ItemFormValues>({ defaultValues: { warpSpecId: "w1" } as Partial<ItemFormValues> as ItemFormValues });
  return <ItemWarpSection form={form} canWrite itemId={itemId} />;
}

function setUsers(total: number) {
  get.mockImplementation((url: string) => {
    if (url.startsWith("/api/warp-specs/w1")) return Promise.resolve({ data: { success: true, data: SPEC } });
    if (url.startsWith("/api/items")) return Promise.resolve({ data: { success: true, data: [], pagination: { total, page: 1, pageSize: 1, totalPages: 1, hasMore: false, nextCursor: null, limit: 1 } } });
    return Promise.resolve({ data: { success: true, data: [], pagination: { total: 0, page: 1, pageSize: 50, totalPages: 1, hasMore: false, nextCursor: null, limit: 50 } } });
  });
}

beforeEach(() => {
  for (const f of [get, post, patch, put, openTab]) f.mockReset();
  post.mockImplementation((_u: string, body: Record<string, unknown>) => Promise.resolve({ data: { success: true, data: { ...SPEC, ...body, id: "w-new" } } }));
  patch.mockImplementation(() => Promise.resolve({ data: { success: true, data: SPEC } }));
  put.mockImplementation(() => Promise.resolve({ data: { success: true, data: SPEC } }));
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["warpspec:write", "item:write"] } as unknown as JwtPayload });
});

describe("ItemWarpSection — kullanım yerinde çözgü kartı", () => {
  it("⭐ paylaşılan kart: Düzenle formu açmaz, update YOK; Kart ekranında aç sekme açar", async () => {
    setUsers(3);
    renderWithProviders(<Harness itemId="i1" />);
    expect(await screen.findByText(/2 kumaşta daha kullanılıyor/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Düzenle/ }));
    expect(await screen.findByText(/burada düzenlenmez/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Çözgü düzenle" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith(expect.stringContaining("/definitions/warp-specs"), { forceNew: true }));
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("⭐ Örnek al: yalnız POST (kimliksiz), kaynağa PATCH/PUT yok", async () => {
    setUsers(3);
    renderWithProviders(<Harness itemId="i1" />);
    await userEvent.click(await screen.findByRole("button", { name: /Örnek al \(yalnız bu kumaş\)/ }));
    await userEvent.click(saveBtn(await screen.findByRole("dialog", { name: "Çözgü örnekten" })));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/warp-specs", expect.objectContaining({ code: "" })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("id");
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("paylaşılmayan kart (yalnız bu kumaş): Düzenle yerinde açılır ve update çağrılır", async () => {
    setUsers(1);
    renderWithProviders(<Harness itemId="i1" />);
    await screen.findByTestId("warp-summary");
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/items/)));
    await userEvent.click(screen.getByRole("button", { name: /Düzenle/ }));
    const dlg = await screen.findByRole("dialog", { name: "Çözgü düzenle" });
    await userEvent.click(saveBtn(dlg));
    await waitFor(() => expect(patch.mock.calls.length + put.mock.calls.length).toBe(1));
    const call = (patch.mock.calls[0] ?? put.mock.calls[0])!;
    expect(call[0]).toBe("/api/warp-specs/w1");
    expect(post).not.toHaveBeenCalled();
  });
});

function saveBtn(dlg: HTMLElement): HTMLElement {
  return dlg.querySelector("button")!;
}
