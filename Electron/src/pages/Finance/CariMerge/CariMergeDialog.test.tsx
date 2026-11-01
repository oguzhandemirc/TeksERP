// =============================================================================
// BEKÇİ — Panel cari birleştirme (D4-K3e): §1 aday modalı aynı kartın öbür hesabını doğrudan listeler · §2 ön izleme
//   HER kalemi satır satır gösterir · §3 ⭐ yazılı onay yazılmadan / engel varken Birleştir KAPALI · §4 uygula gövdesi
//   strict (damga + token) · §5 409 STALE'de ön izleme yenilenir, sunucu metni gösterilir · §6 izinsizde düğme YOK
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => perms.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => perms.includes(p)),
  }),
}));
import { CariMergeDialog } from "./CariMergeDialog";
import { CariMergeButton } from "../CariRowExtras";
import { canApply, isConfirmTyped, toApplyBody, type CariMergePreview } from "./cariMergeService";

const CAND = { id: "card", kind: "CUSTOMER", label: "K1 Kart", isActive: true, sourceId: "leg", targetId: "card", balances: [{ currency: "TRY", balance: "700.00" }] };
const PREVIEW: CariMergePreview = {
  sourceId: "leg", targetId: "card", sourceLabel: "F1 Fason", targetLabel: "K1 Kart", alreadyMerged: false, blockers: [],
  balances: [{ currency: "TRY", source: "1500.00", target: "700.00" }, { currency: "USD", source: "200.00", target: "0.00" }],
  items: [
    { currency: "TRY", invoiceId: "i1", docNo: "SF-001", signedAmount: "1000.00", dueDate: "2026-10-17" },
    { currency: "TRY", invoiceId: "i2", docNo: "SF-002", signedAmount: "500.00", dueDate: "2026-11-26" },
    { currency: "USD", invoiceId: "i3", docNo: "SF-003", signedAmount: "200.00", dueDate: "2026-10-30" },
  ],
  termsToCopy: {}, draftInvoices: 0, stamp: "a".repeat(32),
};
const STALE_MSG = "Ön izlemeden sonra kayıtlar değişti — ön izlemeyi yenileyin.";
const err409 = () => new AxiosError("x", "409", undefined, undefined, { status: 409, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: { message: STALE_MSG, details: { code: "CARI_MERGE_STALE" } } });

function mockGets(preview: CariMergePreview = PREVIEW) {
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: { data: url.includes("merge-candidates") ? [CAND] : preview } }),
  );
}

async function openPreview() {
  renderWithProviders(<CariMergeDialog cariId="leg" cariName="F1 Fason" onClose={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Ön izle" }));
  await screen.findByText("SF-001");
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  perms = ["finance:read", "finance:cari-merge"];
});

describe("CariMergeDialog", () => {
  it("§1 aday listesi aynı kartın hesabını yönüyle gösterir", async () => {
    mockGets();
    renderWithProviders(<CariMergeDialog cariId="leg" cariName="F1 Fason" onClose={() => undefined} />);
    expect(await screen.findByText("K1 Kart")).toBeTruthy();
    expect(screen.getByText(/bu hesap → seçilen hesap/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/api/finance/cari/leg/merge-candidates");
  });

  it("§2 ön izleme her kalemi ayrı satırda listeler", async () => {
    mockGets();
    await openPreview();
    for (const d of ["SF-001", "SF-002", "SF-003"]) expect(screen.getByText(d)).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/api/finance/cari/merge/preview", { params: { sourceId: "leg", targetId: "card" } });
  });

  it("§3 ⭐ onay yazılmadan Birleştir kapalı; yazınca açılır; engel varsa kapalı", async () => {
    mockGets();
    await openPreview();
    const btn = screen.getByRole("button", { name: "Birleştir" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Onaylamak için/), { target: { value: "birleştir" } });
    expect(btn.disabled).toBe(false);
    expect(canApply({ ...PREVIEW, blockers: ["Aktif cari kilidi var."] }, "BİRLEŞTİR")).toBe(false);
    expect(canApply({ ...PREVIEW, alreadyMerged: true }, "BİRLEŞTİR")).toBe(false);
    expect(isConfirmTyped("BIRLESTIR")).toBe(false);
  });

  it("§4 uygula gövdesi strict: kaynak, hedef, damga, token", async () => {
    mockGets();
    post.mockResolvedValue({ data: { data: { alreadyMerged: false, transferGroupId: "t", legs: 6, movedDrafts: 0 }, message: "Cari hesaplar birleştirildi." } });
    await openPreview();
    fireEvent.change(screen.getByLabelText(/Onaylamak için/), { target: { value: "BİRLEŞTİR" } });
    fireEvent.click(screen.getByRole("button", { name: "Birleştir" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/api/finance/cari/merge");
    expect(Object.keys(body).sort()).toEqual(["clientToken", "sourceId", "stamp", "targetId"]);
    expect(body).toMatchObject({ sourceId: "leg", targetId: "card", stamp: PREVIEW.stamp });
    expect(Object.keys(toApplyBody(PREVIEW, "tok")).sort()).toEqual(["clientToken", "sourceId", "stamp", "targetId"]);
  });

  it("§5 409 STALE: sunucu metni gösterilir, ön izleme yeniden istenir, onay sıfırlanır", async () => {
    mockGets();
    post.mockRejectedValue(err409());
    await openPreview();
    const previewCalls = () => get.mock.calls.filter((c) => c[0] === "/api/finance/cari/merge/preview").length;
    const before = previewCalls();
    fireEvent.change(screen.getByLabelText(/Onaylamak için/), { target: { value: "BİRLEŞTİR" } });
    fireEvent.click(screen.getByRole("button", { name: "Birleştir" }));
    expect(await screen.findByText(STALE_MSG)).toBeTruthy();
    await waitFor(() => expect(previewCalls()).toBeGreaterThan(before));
    expect((screen.getByLabelText(/Onaylamak için/) as HTMLInputElement).value).toBe("");
  });

  it("§6 izinsiz kullanıcıda Birleştir düğmesi çizilmez", () => {
    perms = ["finance:read"];
    renderWithProviders(<CariMergeButton onClick={() => undefined} />);
    expect(screen.queryByRole("button", { name: /Birleştir/ })).toBeNull();
    perms = ["finance:read", "finance:cari-merge"];
    renderWithProviders(<CariMergeButton onClick={() => undefined} />);
    expect(screen.getByRole("button", { name: /Birleştir/ })).toBeTruthy();
  });
});
