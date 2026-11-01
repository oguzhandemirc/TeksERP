// =============================================================================
// BEKÇİ — Mükerrer kart birleştirmesinden cari birleştirmeye yönlendirme (2026-11-01, Gülkesim provası)
//   §1 önizleme notu kalan HER hesabı bakiyesiyle listeler · §2 ⭐ izinli kullanıcıda "Şimdi cari hesapları birleştir"
//   cari birleştirme diyaloğunu kalan hesapla açar (aday listesi o hesap için istenir) · §3 izinsizde düğme YOK, yol tarifi var
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => perms.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => perms.includes(p)),
  }),
}));
import { MergeCariFollowUpDialog, MergeCariFollowUpNote } from "./MergeCariFollowUps";
import type { MergeFollowUp } from "@/services/mergeService";

const FU: MergeFollowUp = {
  kind: "CARI_MERGE", cariId: "tomb-acc", label: "MUS05 DRN TEKSTİL", targetCariId: "card-acc",
  balances: [{ currency: "TRY", balance: "1000.00" }, { currency: "USD", balance: "250.00" }],
};

describe("MergeCariFollowUps", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { data: [{ id: "card-acc", kind: "CUSTOMER", label: "MUS07 DRN TEKS", isActive: true, sourceId: "tomb-acc", targetId: "card-acc", balances: [] }] } });
  });

  it("§1 önizleme notu kalan hesabı bakiyesiyle listeler; boş listede çizilmez", () => {
    const { container, rerender } = render(<MergeCariFollowUpNote followUps={[FU]} />);
    expect(screen.getByText(/MUS05 DRN TEKSTİL — 1000.00 TRY · 250.00 USD/)).toBeInTheDocument();
    rerender(<MergeCariFollowUpNote followUps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("§2 ⭐ izinli: 'Şimdi cari hesapları birleştir' kalan hesabın cari birleştirmesini açar", async () => {
    perms = ["finance:cari-merge"];
    renderWithProviders(<MergeCariFollowUpDialog followUps={[FU]} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Şimdi cari hesapları birleştir/ }));
    expect(await screen.findByText(/Başka cariyle birleştir — MUS05 DRN TEKSTİL/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(expect.stringContaining("/tomb-acc/merge-candidates"));
    expect(await screen.findByText("MUS07 DRN TEKS")).toBeInTheDocument();
  });

  it("§3 izinsiz: düğme yok, muhasebeye yol tarifi var", () => {
    perms = [];
    renderWithProviders(<MergeCariFollowUpDialog followUps={[FU]} onClose={() => undefined} />);
    expect(screen.queryByRole("button", { name: /Şimdi cari hesapları birleştir/ })).toBeNull();
    expect(screen.getByText(/muhasebe yetkilisi yapar/)).toBeInTheDocument();
  });
});
