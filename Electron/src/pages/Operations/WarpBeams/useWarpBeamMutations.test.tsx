// =============================================================================
// BEKÇİ — Levent planla/düzenle: sunucunun `warnings`i (K5b gövde dolu / çift plan) KULLANICIYA ULAŞIR
// =============================================================================
// Kullanıcı bulgusu (2026-09-18): aynı gövde no'lu planlar sessizce kaydediliyor, hata sarımda çıkıyordu. Backend
// artık plan anında uyarır; panel her uyarıyı ayrı `toast.warning` olarak basar (başarı toast'ı da kalır — kayıt oldu).
// Negatif sonda: `settle`den `warnings` döngüsü düşürülünce ① kırmızı.
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServerNotesMutationCache } from "@/lib/serverNotes";
import { useWarpBeamMutations } from "./useWarpBeamMutations";

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a) } }));
const create = vi.fn();
const update = vi.fn();
vi.mock("./service", () => ({ warpBeamService: { create: (...a: unknown[]) => create(...a), update: (...a: unknown[]) => update(...a) } }));

const W1 = "\"T1\" gövdesinde LV1809260001 canlı (TAKILI) — bu levent ancak gövde boşalınca sarılabilir.";
const W2 = "\"T1\" için 2 planlı levent var: LV1809260005 ve bu levent — sırayla sarılır.";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ mutationCache: createServerNotesMutationCache(), defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  toastSuccess.mockReset();
  toastWarning.mockReset();
  create.mockReset();
  update.mockReset();
});

describe("useWarpBeamMutations — K5b plan anı uyarıları", () => {
  it("① ⭐ planla: yanıttaki iki `warnings` iki ayrı uyarı toast'ı olur, başarı toast'ı da basılır, onDone çağrılır", async () => {
    create.mockResolvedValue({ success: true, data: { id: "b1" }, message: "LV1809260006 planlandı", warnings: [W1, W2] });
    const onDone = vi.fn();
    const { result } = renderHook(() => useWarpBeamMutations(onDone), { wrapper });
    result.current.save.mutate({ id: null, body: { warpSpecId: "s1", plannedLengthM: 100, originKind: "IN_HOUSE", physicalBeamNo: "T1" } as never, clientToken: "t" });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("LV1809260006 planlandı");
    expect(toastWarning.mock.calls.map((c) => c[0])).toEqual([W1, W2]);
    expect(toastWarning.mock.calls[0]?.[1]).toMatchObject({ duration: 8000 });
  });

  it("② düzenle: `warnings` yoksa uyarı toast'ı YOK (gövde boşaldı)", async () => {
    update.mockResolvedValue({ success: true, data: { id: "b1" }, message: "LV1809260006 güncellendi" });
    const { result } = renderHook(() => useWarpBeamMutations(() => {}), { wrapper });
    result.current.save.mutate({ id: "b1", body: { physicalBeamNo: "T9" } as never, clientToken: "t" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
