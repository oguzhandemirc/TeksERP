import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { MergeCandidateGroup, MergePreview } from "./types";

// =============================================================================
// Kopya birleştirme diyaloğu (D4). İddia: düşük güven VARSAYILAN SEÇİLİ DEĞİL; açık oturumlu
// kaynak seçilemez ve nedeni yazılı; her kaynakta iş oturumu "yerinde kalır" + taşınan donanım;
// geri alma notu görünür; "N kaydı birleştir" yalnız seçilenleri DOĞRU uca gönderir.
// Sonda: HENÜZ ÖLÇÜLMEDİ (devir notunda açık iş) — LOW süzgeci kaldır / engelli kaynağa onay kutusu ver.
// =============================================================================

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("@/services/apiClient", () => ({
  default: { get: h.get, post: h.post, patch: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (_e: unknown, yedek = "x") => yedek,
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, info: vi.fn() } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

const { MergeDialog, MERGE_UNDO_NOTE } = await import("./MergeDialog");

const T = "11111111-1111-4111-8111-111111111111";
const S_HIGH = "22222222-2222-4222-8222-222222222222";
const S_LOW = "33333333-3333-4333-8333-333333333333";
const S_OPEN = "44444444-4444-4444-8444-444444444444";
const uye = (id: string, name: string, confidence: "HIGH" | "MEDIUM" | "LOW", warnings: string[] = []) => ({
  id, deviceId: `${id.slice(0, 8)}-local`, name, kind: "TABLET" as const, isActive: true, status: "APPROVED" as const,
  createdAt: "2026-07-31T17:26:00.000Z", lastSeenAt: "2026-07-31T17:49:00.000Z", confidence, reasons: ["ardıllık 1 dk"], warnings,
});
const GROUP: MergeCandidateGroup = {
  kind: "TABLET",
  confidence: "LOW",
  target: uye(T, "Tambur-1 Tablet", "HIGH"),
  sources: [
    uye(S_HIGH, "Tablet d7d79d42", "HIGH"),
    uye(S_LOW, "samsun a9", "LOW", ["ayrı cihaz olabilir (adlar farklı)"]),
    uye(S_OPEN, "Tablet 129f8c6c", "HIGH"),
  ],
};
const kaynak = (id: string, blockers: MergePreview["sources"][number]["blockers"] = []) => ({
  id, deviceId: `${id.slice(0, 8)}-local`, name: "x", kind: "TABLET" as const, isActive: true, status: "APPROVED" as const,
  createdAt: "", lastSeenAt: null, blockers, notes: [],
  workSessions: { count: 14, staysInPlace: true, recent: [] },
  hardwareLinks: id === S_HIGH ? [{ id: "p1", code: "YZC-1", name: "Tambur Yazıcısı", kind: "LABEL_PRINTER", alreadyOnTarget: false }] : [],
  legacyPeripherals: [],
});
const PREVIEW: MergePreview = {
  target: { id: T, deviceId: "t", name: "Tambur-1 Tablet", kind: "TABLET", isActive: true, status: "APPROVED" },
  targetBlockers: [],
  sources: [
    kaynak(S_HIGH),
    kaynak(S_LOW),
    kaynak(S_OPEN, [{ code: "DEVICE_MERGE_OPEN_SESSION", message: "Kayıtta açık iş oturumu var; oturum kapanmadan birleştirilemez." }]),
  ],
  undoNote: MERGE_UNDO_NOTE,
};

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.toastSuccess.mockReset();
  h.post.mockImplementation((url: string) => {
    if (url.endsWith("/merge/preview")) return Promise.resolve({ data: { success: true, data: PREVIEW } });
    if (url.endsWith("/merge")) {
      return Promise.resolve({ data: { success: true, data: { target: { id: T, name: "Tambur-1 Tablet" }, merged: [{ id: S_HIGH }], mergedAt: "" } } });
    }
    return Promise.reject(new Error(`beklenmeyen uç ${url}`));
  });
});

async function ac() {
  renderWithProviders(<MergeDialog group={GROUP} onClose={() => undefined} />);
  await screen.findByText(/Kayıtta açık iş oturumu var/);
}

describe("MergeDialog", () => {
  it("düşük güven varsayılan SEÇİLİ DEĞİL, yüksek güven seçili; düğme sayıyı izler", async () => {
    await ac();
    expect(screen.getByRole("checkbox", { name: /Tablet d7d79d42/ })).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("checkbox", { name: /samsun a9/ })).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByRole("button", { name: "1 kaydı birleştir" })).toBeEnabled();
    expect(screen.getByText(/ayrı cihaz olabilir/)).toBeInTheDocument();
  });

  it("açık oturumlu kaynak seçilemez ve nedeni yazılı", async () => {
    await ac();
    expect(screen.queryByRole("checkbox", { name: /Tablet 129f8c6c/ })).toBeNull();
    expect(screen.getByText(/Seçilemez: Kayıtta açık iş oturumu var/)).toBeInTheDocument();
    expect(screen.getByText("açık oturum VAR", { exact: false })).toBeInTheDocument();
  });

  it("her kaynakta iş oturumu yerinde kalır + taşınan donanım; geri alma notu görünür", async () => {
    await ac();
    expect(screen.getAllByText(/iş oturumu YERİNDE KALIR/)).toHaveLength(3);
    expect(screen.getByText(/Tambur Yazıcısı/)).toBeInTheDocument();
    expect(screen.getByText(MERGE_UNDO_NOTE)).toBeInTheDocument();
  });

  it("birleştir yalnız seçilenleri doğru uca gönderir; düşük güven elle seçilebilir", async () => {
    await ac();
    fireEvent.click(screen.getByRole("checkbox", { name: /samsun a9/ }));
    fireEvent.click(screen.getByRole("button", { name: "2 kaydı birleştir" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith(
      "/api/admin/devices/merge",
      { targetId: T, sourceIds: [S_HIGH, S_LOW] },
      expect.anything(),
    ));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });
});
