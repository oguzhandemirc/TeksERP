// BEKÇİ — Teslim bordrosu diyaloğu, hareket fişi (K3): bayrak KAPALIYKEN ekran ve gövde bugünkü gibi;
//   AÇIKKEN teslim türü sorulur, gövde yalnız seçilen hedefi taşır, taslağın planı gösterilir, engelli
//   satır ve `finance:cheque` eksikliği Kaydet'i sebebiyle kapatır.
// NEGATİF SONDA (2026-09-26, md5 ile geri alındı): diyaloğun taslağı hedefi gövdeye bağlamadı → ⭐ testi ❌ ·
//   `finance:cheque` kapısı kaldırıldı → izin testi ❌.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { ChequeRow } from "./service";

const h = vi.hoisted(() => ({
  flagOn: false,
  perms: new Set(["finance:read", "finance:write", "finance:cheque"]),
  draft: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { financeChequeNoteMovementEnabled: h.flagOn } } }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => h.perms.has(p), hasAnyPermission: () => true, hasAllPermissions: () => true }),
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./ChequeNoteDocDialog", () => ({ ChequeNoteDocDialog: ({ description }: { description: string }) => <div>{description}</div> }));
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  draftChequeDeliveryNote: h.draft,
  createChequeDeliveryNote: h.create,
}));
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  listBankAccounts: async () => ({ data: [{ id: "bank-try", name: "Ziraat", currency: "TRY", isActive: true }], pagination: { total: 1, totalPages: 1 } }),
}));

import { ChequeBordroDialog } from "./ChequeBordroDialog";

const row = (id: string): ChequeRow =>
  ({ id, docNo: id, kind: "RECEIVED", status: "PORTFOLIO", currency: "TRY", amount: 100 }) as unknown as ChequeRow;
const rows = [row("C1"), row("C2")];
const plan = (blocked: string | null) => ({
  type: "DEPOSIT" as const,
  rows: [
    { chequeId: "C1", docNo: "C1", action: "DEPOSIT", fromStatus: "PORTFOLIO", toStatus: "AT_BANK", blockedReason: null },
    { chequeId: "C2", docNo: "C2", action: "DEPOSIT", fromStatus: "PORTFOLIO", toStatus: "AT_BANK", blockedReason: blocked },
  ],
});

beforeEach(() => {
  h.flagOn = false;
  h.perms = new Set(["finance:read", "finance:write", "finance:cheque"]);
  h.draft.mockReset();
  h.create.mockReset();
});

describe("ChequeBordroDialog — hareket fişi", () => {
  it("bayrak KAPALI → teslim türü yok, gövdede hedef kimliği yok (bugünkü ekran)", async () => {
    h.draft.mockResolvedValue({ html: "<p/>", tables: { tables: [] } });
    const user = userEvent.setup();
    renderWithProviders(<ChequeBordroDialog rows={rows} open onOpenChange={() => {}} />);
    expect(screen.queryByRole("radiogroup", { name: "Teslim türü" })).toBeNull();
    expect(screen.getByText("Teslim edilen yer / firma (opsiyonel)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Önizle/ }));
    await waitFor(() => expect(h.draft).toHaveBeenCalledTimes(1));
    const body = h.draft.mock.calls[0]![0] as Record<string, unknown>;
    expect("bankAccountId" in body || "cariId" in body).toBe(false);
  });

  it("⭐ bayrak AÇIK → tür seçilmeden önizleme kapalı; bankaya + hesap → gövdede bankAccountId, plan görünür, Kaydet aynı hedefle", async () => {
    h.flagOn = true;
    h.draft.mockResolvedValue({ html: "<p/>", tables: { tables: [] }, movement: plan(null) });
    h.create.mockResolvedValue({ data: { id: "n1", docNo: "BRD1", count: 2, movement: "DEPOSIT" }, message: "ok" });
    const user = userEvent.setup();
    renderWithProviders(<ChequeBordroDialog rows={rows} open onOpenChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Önizle/ })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Bankaya/ }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Banka hesabı" }), "bank-try");
    await user.click(screen.getByRole("button", { name: /Önizle/ }));
    await waitFor(() => expect(h.draft).toHaveBeenCalledTimes(1));
    expect((h.draft.mock.calls[0]![0] as { bankAccountId?: string }).bankAccountId).toBe("bank-try");
    expect(await screen.findByText(/2 kıymet bankaya verilecek/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Kaydet \(BRD\)/ }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect((h.create.mock.calls[0]![0] as { bankAccountId?: string }).bankAccountId).toBe("bank-try");
    expect(await screen.findByText(/bankaya verildi/)).toBeInTheDocument();
  });

  it("plan engelli satır taşıyorsa satır nedeniyle listelenir ve Kaydet kapanır", async () => {
    h.flagOn = true;
    h.draft.mockResolvedValue({ html: "<p/>", tables: { tables: [] }, movement: plan("C2 şu an bankada") });
    const user = userEvent.setup();
    renderWithProviders(<ChequeBordroDialog rows={rows} open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("radio", { name: /Bankaya/ }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Banka hesabı" }), "bank-try");
    await user.click(screen.getByRole("button", { name: /Önizle/ }));
    expect(await screen.findByText(/C2 şu an bankada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kaydet \(BRD\)/ })).toBeDisabled();
  });

  it("finance:cheque yoksa hareketli bordro kaydedilemez; 'yalnız belge' kaydedilir", async () => {
    h.flagOn = true;
    h.perms = new Set(["finance:read", "finance:write"]);
    h.draft.mockResolvedValue({ html: "<p/>", tables: { tables: [] }, movement: plan(null) });
    const user = userEvent.setup();
    renderWithProviders(<ChequeBordroDialog rows={rows} open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("radio", { name: /Bankaya/ }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Banka hesabı" }), "bank-try");
    expect(screen.getByRole("button", { name: /Kaydet \(BRD\)/ })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /yalnız belge/ }));
    expect(screen.getByRole("button", { name: /Kaydet \(BRD\)/ })).toBeEnabled();
  });
});
