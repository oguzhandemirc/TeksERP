// =============================================================================
// DUMAN — atkı kartı seçicisi (ürün penceresi Atkı sekmesi, dokuma iş emri): Yeni · Örnek al · Düzenle.
// Örnek al kaynak kartı çeker, kimliksiz taslakla YALNIZ POST eder; ortak kart seçiciden düzenlenmez ("Kart ekranında aç").
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

const WEFT = { id: "w1", code: "1205", name: "Ortak atkı", picksPerCm: "18", sequenceCode: null, weftProgramNo: null, isActive: true, fabricCount: 3,
  yarns: [{ yarnItemId: "y1", picksInRepeat: 2, sortOrder: 0, yarnItem: { id: "y1", code: "IP-1", name: "600 KAR" } }] };
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: vi.fn() },
}));
const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));

const { EntityPickerModal } = await import("../entity-picker/EntityPickerModal");
const { useWeftSpecRecordForm } = await import("@/pages/WeftSpecs/useWeftSpecRecordForm");
const { weftSpecPickerService } = await import("@/pages/Items/construction-service");

const listBody = (rows: unknown[]) => ({ data: { success: true, data: rows, pagination: { nextCursor: null, hasMore: false, limit: 50, page: 1, pageSize: 500, total: rows.length, totalPages: 1 } } });

function WeftHarness({ onChange }: { onChange: (id: string | null) => void }) {
  const form = useWeftSpecRecordForm();
  return <EntityPickerModal value={null} onChange={onChange} service={weftSpecPickerService} recordForm={form} queryKey="t-weft" getLabel={(w) => w.name} title="Atkı kartı seç" placeholder="Atkı kartı seç" />;
}

beforeEach(() => {
  for (const f of [get, post, patch, openTab]) f.mockReset();
  get.mockImplementation((url: string) => {
    if (url.startsWith("/api/weft-specs/w1")) return Promise.resolve({ data: { success: true, data: WEFT } });
    if (url.startsWith("/api/weft-specs")) return Promise.resolve(listBody([WEFT]));
    return Promise.resolve(listBody([]));
  });
  // Yan hesap paneli (`/calc`) ayrı uç — sayılar burada ölçülmez, boş hesap döner.
  post.mockImplementation((url: string, body: Record<string, unknown>) => Promise.resolve(url.endsWith("/calc")
    ? { data: { success: true, data: { missing: [], rows: [] } } }
    : { data: { success: true, data: { ...body, id: "new-1", yarns: [] } } }));
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["warpspec:read", "warpspec:write", "item:read"] } as unknown as JwtPayload });
});

describe("Atkı kartı seçicisi — Örnek al / Düzenle", () => {
  it("⭐ Düzenle → Atkı Kartları ekranı (ortak kart seçiciden değişmez)", async () => {
    renderWithProviders(<WeftHarness onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Atkı kartı seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Ortak atkı — düzenle" }));
    await userEvent.click(await screen.findByRole("button", { name: /Kart ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/weft-specs?search=1205", { forceNew: true }));
    expect(patch).not.toHaveBeenCalled();
  });

  it("⭐ Örnek al: kaynak kart çekilir, kod boş + ad (kopya), iplikler aynen; yalnız POST, yeni kart seçili", async () => {
    const onChange = vi.fn();
    renderWithProviders(<WeftHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Atkı kartı seç/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Ortak atkı — örnek al/ }));
    const dlg = await screen.findByRole("dialog", { name: "Yeni atkı kartı" });
    expect(within(dlg).getByLabelText(/Atkı kartı kodu/)).toHaveValue("");
    expect(within(dlg).getByLabelText(/Atkı kartı adı/)).toHaveValue("Ortak atkı (kopya)");
    await userEvent.type(within(dlg).getByLabelText(/Atkı kartı kodu/), "1206");
    await userEvent.click(within(dlg).getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/weft-specs", expect.objectContaining({ code: "1206", name: "Ortak atkı (kopya)" })));
    const body = post.mock.calls.find((c) => c[0] === "/api/weft-specs")?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("id");
    expect(JSON.stringify(body)).toContain("y1");
    expect(patch).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("new-1", expect.objectContaining({ id: "new-1" })));
  });
});
