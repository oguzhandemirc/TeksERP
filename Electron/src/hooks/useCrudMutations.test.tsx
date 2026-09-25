import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCrudMutations } from "./useCrudMutations";
import type { CrudService } from "@/services/crudService";

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}));

interface Widget {
  id: string;
  name: string;
}

// Servisi tam mock'la — gerçek HTTP yok; çağrı argümanlarını da doğrula.
// Somut shape (Record değil) → noUncheckedIndexedAccess altında fns.create vb.
// 'undefined' olmaz.
function makeService() {
  const fns = {
    create: vi.fn().mockResolvedValue({ success: true, data: { id: "w1", name: "yeni" } }),
    update: vi.fn().mockResolvedValue({ success: true, data: { id: "w1", name: "değişti" } }),
    remove: vi.fn().mockResolvedValue({ success: true, data: { id: "w1", name: "x" } }),
    restore: vi.fn().mockResolvedValue({ success: true, data: { id: "w1", name: "x" } }),
    getAll: vi.fn(),
    listCursor: vi.fn(),
    getById: vi.fn(),
    hardRemove: vi.fn(),
  };
  return { service: fns as unknown as CrudService<Widget>, fns };
}

function renderCrud(service: CrudService<Widget>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useCrudMutations<Widget>({ service, queryKey: "widgets", entityName: "Widget" }),
    { wrapper },
  );
  return { result, invalidateSpy };
}

describe("useCrudMutations", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastWarning.mockClear();
  });

  it("create → service.create(data) + başarı toast'ı + liste invalidate", async () => {
    const { service, fns } = makeService();
    const { result, invalidateSpy } = renderCrud(service);

    result.current.createMutation.mutate({ name: "yeni" });

    await waitFor(() => expect(result.current.createMutation.isSuccess).toBe(true));
    expect(fns.create).toHaveBeenCalledWith({ name: "yeni" });
    expect(toastSuccess).toHaveBeenCalledWith("Widget oluşturuldu.");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["widgets"] });
  });

  it("update → service.update(id, data) doğru argümanlarla + toast", async () => {
    const { service, fns } = makeService();
    const { result } = renderCrud(service);

    result.current.updateMutation.mutate({ id: "w1", data: { name: "değişti" } });

    await waitFor(() => expect(result.current.updateMutation.isSuccess).toBe(true));
    expect(fns.update).toHaveBeenCalledWith("w1", { name: "değişti" });
    expect(toastSuccess).toHaveBeenCalledWith("Widget güncellendi.");
  });

  it("remove → silindi toast'ı 'Geri al' aksiyonu sunar; tıklayınca restore(id) çağrılır", async () => {
    const { service, fns } = makeService();
    const { result } = renderCrud(service);

    result.current.removeMutation.mutate("w1");

    await waitFor(() => expect(result.current.removeMutation.isSuccess).toBe(true));
    expect(fns.remove).toHaveBeenCalledWith("w1");

    // "silindi" toast'ı geri-al aksiyonu taşımalı (soft delete UX kuralı).
    const [msg, opts] = toastSuccess.mock.calls.find((c) => c[0] === "Widget silindi.")!;
    expect(msg).toBe("Widget silindi.");
    const action = (opts as { action: { label: string; onClick: () => void } }).action;
    expect(action.label).toBe("Geri al");

    // Geri-al tıklaması → restore + ikinci başarı toast'ı
    action.onClick();
    await waitFor(() => expect(fns.restore).toHaveBeenCalledWith("w1"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Widget geri alındı."));
  });

  it("hata durumunda başarı toast'ı atmaz (onError toast yok — interceptor sorumlu)", async () => {
    const { service, fns } = makeService();
    fns.create.mockRejectedValueOnce(new Error("400"));
    const { result } = renderCrud(service);

    result.current.createMutation.mutate({ name: "x" });

    await waitFor(() => expect(result.current.createMutation.isError).toBe(true));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

// Sunucunun `warnings` alanı apiClient interceptor'ında GENEL basılır (apiClient.test "sunucu uyarıları").
// Kanca onu KENDİSİ basmaz — basarsa kullanıcı aynı notu iki kez görür.
describe("useCrudMutations — sunucu uyarıları kancada basılmaz", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastWarning.mockClear();
  });

  it("remove → uyarılı yanıtta kanca uyarı tostu BASMAZ; 'Geri al' korunur", async () => {
    const { service, fns } = makeService();
    const uyari = "Bu kayda bağlı canlı kayıtlar var: 3 top, 1 açık sipariş kalemi.";
    fns.remove.mockResolvedValueOnce({
      success: true,
      data: { id: "w1", name: "x" },
      message: `Kayıt pasife alındı. ${uyari}`,
      warnings: [uyari],
    });
    const { result } = renderCrud(service);

    result.current.removeMutation.mutate("w1");

    await waitFor(() => expect(result.current.removeMutation.isSuccess).toBe(true));
    expect(toastWarning).not.toHaveBeenCalled();
    const silindi = toastSuccess.mock.calls.find((c) => c[0] === "Widget silindi.");
    expect((silindi?.[1] as { action: { label: string } }).action.label).toBe("Geri al");
  });

  it("update/restore/hardRemove de uyarıyı kancada basmaz — başarı tostları aynen", async () => {
    const { service, fns } = makeService();
    const res = () => ({ success: true, data: { id: "w1", name: "x" }, warnings: ["u1", "u2"] });
    fns.update.mockResolvedValueOnce(res());
    fns.restore.mockResolvedValueOnce(res());
    fns.hardRemove.mockResolvedValueOnce(res());
    const { result } = renderCrud(service);

    result.current.updateMutation.mutate({ id: "w1", data: { name: "x" } });
    result.current.restoreMutation.mutate("w1");
    result.current.hardRemoveMutation.mutate("w1");

    await waitFor(() => expect(result.current.hardRemoveMutation.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.restoreMutation.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.updateMutation.isSuccess).toBe(true));
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Widget güncellendi.");
  });
});
