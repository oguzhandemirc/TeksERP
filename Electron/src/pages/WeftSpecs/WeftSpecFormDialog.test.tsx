// Ürün penceresinden "Örnek alarak yeni aç": yeni kartın hesap paneli kumaş bağlamını (itemId + ham en) taşır →
// atkı boyu kumaşın zincirinden gelir, kg/1000 m "—" kalmaz. Kaynak kart değişmez (yalnız YENİ kart formu).
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { WeftSpecFormDialog } from "./WeftSpecFormDialog";

const post = vi.fn();
const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));

const draft = {
  code: "TEST-ATKI-01", name: "TEST ATKI", picksPerCm: "18", sequenceCode: null, weftProgramNo: null,
  yarns: [{ yarnItemId: "y1", picksInRepeat: 2, sortOrder: 0, colorChannel: 1 }],
};

describe("WeftSpecFormDialog — kumaş bağlamı", () => {
  it("⭐ calcCtx verilince hesap isteği itemId + ham eni taşır (atkı boyu kumaştan)", async () => {
    get.mockResolvedValue({ data: { success: true, data: [] } });
    post.mockResolvedValue({ data: { success: true, data: null } });
    renderWithProviders(
      <WeftSpecFormDialog open onOpenChange={() => {}} initial={null} canWrite draft={draft} calcCtx={{ itemId: "fab-1", rawWidthCm: 305 }} />,
    );
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/weft-specs/calc", expect.objectContaining({ itemId: "fab-1", rawWidthCm: 305 }), { suppressErrorToast: true }), { timeout: 2000 });
  });

  it("bağlamsız (Atkı Kartları ekranı) istek itemId taşımaz", async () => {
    post.mockReset();
    get.mockResolvedValue({ data: { success: true, data: [] } });
    post.mockResolvedValue({ data: { success: true, data: null } });
    renderWithProviders(<WeftSpecFormDialog open onOpenChange={() => {}} initial={null} canWrite draft={draft} />);
    await waitFor(() => expect(post).toHaveBeenCalled(), { timeout: 2000 });
    expect(post.mock.calls[0]![1]).not.toHaveProperty("itemId");
  });
});
