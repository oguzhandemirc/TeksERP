// =============================================================================
// Ürün penceresi > Desen — kullanım yeri kuralı (kullanıcı 2026-11-25): desen burada düzenlenmez.
// "Örnek al" yalnız POST eder (kaynağa PATCH/PUT yok) ve yeni kartı seçer; "Desen Kartları ekranında aç" sekme açar.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import type { WeaveDesign } from "@/pages/WeaveDesigns/types";
import type { ItemFormValues } from "../schema";

const DESIGN: WeaveDesign = {
  id: "d1", code: "DS-1", name: "Saten", kind: "DOBBY", shedMechanism: "DOBBY", weaveStructure: null, familyLabel: null,
  frameCount: 8, repeatCm: null, liftPlan: null, loomFileName: "s.dop", lenoSetup: null, notes: null, isActive: true,
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

const { ItemWeaveSection } = await import("./ItemWeaveSection");

let selected: string | undefined;
function Harness({ canWrite = true }: { canWrite?: boolean }) {
  const form = useForm<ItemFormValues>({ defaultValues: { weaveDesignId: "d1" } as Partial<ItemFormValues> as ItemFormValues });
  selected = form.watch("weaveDesignId");
  return <ItemWeaveSection form={form} canWrite={canWrite} />;
}

beforeEach(() => {
  for (const f of [get, post, patch, put, openTab]) f.mockReset();
  get.mockImplementation((url: string) => Promise.resolve({ data: { success: true, data: url.startsWith("/api/weave-designs/d1") ? DESIGN : [] } }));
  post.mockImplementation((_u: string, body: Record<string, unknown>) => Promise.resolve({ data: { success: true, data: { ...DESIGN, ...body, id: "d-new" } } }));
});

describe("ItemWeaveSection — kullanım yerinde desen kartı", () => {
  it("⭐ Örnek al: yalnız POST, kaynağa PATCH/PUT yok, yeni kart seçilir", async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: /Örnek al \(yalnız bu kumaş\)/ }));
    await userEvent.type(screen.getByLabelText(/Yeni desen kodu/), "DS-2");
    await userEvent.type(screen.getByLabelText(/Yeni desen adı/), "Saten 2");
    await userEvent.click(screen.getByRole("button", { name: "Yeni kartı oluştur" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/weave-designs", expect.objectContaining({ code: "DS-2", name: "Saten 2" })));
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("id");
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    await waitFor(() => expect(selected).toBe("d-new"));
  });

  it("Desen Kartları ekranında aç: kartın sayfası yeni sekmede; yerinde düzenleme düğmesi yok", async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: /Desen Kartları ekranında aç/ }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/weave-designs/d1", { forceNew: true }));
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
  });

  it("yazma izni yokken Örnek al çizilmez, ekranda aç kalır", async () => {
    renderWithProviders(<Harness canWrite={false} />);
    expect(await screen.findByRole("button", { name: /Desen Kartları ekranında aç/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Örnek al/ })).toBeNull();
  });
});
