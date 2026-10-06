import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { UpdateStatus } from "@/types/server-update";
import { approvalPrompt, useApprovalPromptStore } from "./approvalPrompt";

const status = vi.fn();
const approve = vi.fn();
vi.mock("@/services/serverUpdateService", () => ({ serverUpdateService: { status: () => status(), approve: (b: unknown) => approve(b) } }));
const perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const { UpdateApprovalPrompt } = await import("./UpdateApprovalPrompt");

const bekleyenDurum = (p: Partial<UpdateStatus> = {}): UpdateStatus => ({
  kuruluSurum: "2.12.0",
  kanal: "demofabrika",
  politika: { kip: "ONAYLI", pencere: null, hedefSurum: null, kaynak: "KIRA" },
  donuk: false,
  sonrakiPencere: null,
  indirmeBelirteci: true,
  guncelleyici: { durum: "CALISIYOR", surum: "0.1.0" },
  bekleyen: { surum: "2.13.0", karar: "ONAY_BEKLIYOR", neden: null, zorunlu: false, ozet: "Sözleşme kabulü ve düzeltmeler", aralik: null, pgGuncellemesi: false },
  son: null,
  yerel: null,
  gecmis: [],
  karar: { karar: "ONAY_BEKLIYOR", neden: null },
  canlilik: null,
  onay: null,
  eylemler: { hemen: true, pencere: false, geriAl: false, hedefSurum: "2.13.0", neden: null },
  ...p,
});

describe("onay istemi — kural (saf)", () => {
  it("bekleyen aday + hemen açık → istem; sürüm notu taşınır", () => {
    expect(approvalPrompt(bekleyenDurum())).toMatchObject({ surum: "2.13.0", kuruluSurum: "2.12.0", ozet: "Sözleşme kabulü ve düzeltmeler" });
  });
  it("negatif: onay verilmiş · eylem kapalı · pencere bekliyor · aday kurulu sürüm · durum yok → istem YOK", () => {
    const onay = { onayId: "o", surum: "2.13.0", zamanlama: "HEMEN" as const, onaylayan: { id: "u", ad: "A" }, zaman: "2026-10-06T10:00:00.000Z", kullanildi: false };
    expect(approvalPrompt(bekleyenDurum({ onay }))).toBeNull();
    expect(approvalPrompt(bekleyenDurum({ eylemler: { hemen: false, pencere: false, geriAl: false, hedefSurum: null, neden: "x" } }))).toBeNull();
    expect(approvalPrompt(bekleyenDurum({ bekleyen: { ...bekleyenDurum().bekleyen!, karar: "PENCERE_BEKLIYOR" } }))).toBeNull();
    expect(approvalPrompt(bekleyenDurum({ kuruluSurum: "2.13.0" }))).toBeNull();
    expect(approvalPrompt(bekleyenDurum({ eylemler: { hemen: true, pencere: false, geriAl: false, hedefSurum: "2.14.0", neden: null } }))).toBeNull();
    expect(approvalPrompt(undefined)).toBeNull();
  });
});

describe("onay istemi — ekran", () => {
  beforeEach(() => {
    status.mockReset();
    approve.mockReset();
    perms.length = 0;
    useApprovalPromptStore.setState({ dismissed: [] });
  });

  it("license:manage: sürüm + not + iki düğme; 'Şimdi güncelle' → POST HEMEN", async () => {
    perms.push("license:manage");
    status.mockResolvedValue(bekleyenDurum());
    approve.mockResolvedValue({ kayitId: "k", niyet: { yazildi: true, kod: null }, durum: bekleyenDurum() });
    renderWithProviders(<UpdateApprovalPrompt />);
    expect(await screen.findByText("Sözleşme kabulü ve düzeltmeler")).toBeTruthy();
    expect(screen.getByText("Kurulu sürüm 2.12.0 · yeni sürüm 2.13.0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Şimdi güncelle" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith(expect.objectContaining({ surum: "2.13.0", zamanlama: "HEMEN" })));
    await waitFor(() => expect(screen.queryByTestId("guncelleme-onay-istemi")).toBeNull());
  });

  it("'Sonra' → kapanır, backend'e HİÇBİR şey yazılmaz, aynı sürüm bu oturumda geri gelmez", async () => {
    perms.push("license:manage");
    status.mockResolvedValue(bekleyenDurum());
    renderWithProviders(<UpdateApprovalPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "Sonra" }));
    await waitFor(() => expect(screen.queryByTestId("guncelleme-onay-istemi")).toBeNull());
    expect(approve).not.toHaveBeenCalled();
    expect(useApprovalPromptStore.getState().dismissed).toEqual(["2.13.0"]);
  });

  it("negatif: yalnız license:view → istem YOK ve durum ucu hiç çağrılmaz", async () => {
    perms.push("license:view");
    status.mockResolvedValue(bekleyenDurum());
    renderWithProviders(<UpdateApprovalPrompt />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("guncelleme-onay-istemi")).toBeNull();
    expect(status).not.toHaveBeenCalled();
  });

  it("eski backend (uç 404) → sessiz: istem YOK, çökme YOK", async () => {
    perms.push("license:manage");
    status.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404 } }));
    renderWithProviders(<UpdateApprovalPrompt />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId("guncelleme-onay-istemi")).toBeNull();
  });
});
