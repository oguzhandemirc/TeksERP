// BEKÇİ — Fason kokpiti devere gecikmeleri bandı (D8b): devere kapalı / izin yoksa hiç çizilmez ve istek atmaz;
// süzgeç sunucuya `filter[state]` ile gider (varsayılan Geciken); sayaçlar yanıttan; satır sipariş sayfasına gider.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

let devere = true;
let perms: string[] = ["warping-order:read"];
vi.mock("@/hooks/usePricingEnabled", () => ({ useDevereEnabled: () => devere }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
const open = vi.fn();
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useOpenTarget: () => open }));

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const { DevereDelayBand } = await import("../DevereDelayBand");
const { devereDueText, devereProgressText, devereDelayParams, devereChipLabel } = await import("../devere-delays");

const row = (o: Record<string, unknown>) => ({
  warpingOrderId: "wo1", orderNo: "DV-001", status: "IN_PROGRESS", subcontractor: { id: "f1", name: "Deverici A" },
  warpSpec: { id: "s1", code: "CZ-12", name: "Çözgü 12" }, expectedReturnAt: "2026-11-10T20:59:59.999Z", dueSource: "ORDER",
  overdueDays: 4, state: "OVERDUE", firstDispatchedAt: "2026-11-01T08:00:00.000Z", targetLengthM: "12000", receivedLengthM: "3500",
  remainingLengthM: "8500", ...o,
});
const result = (rows: unknown[]) => ({ data: { success: true, data: { data: rows, summary: { openCount: 9, overdueCount: 2, dueSoonCount: 1, noDueDateCount: 3 } } } });

beforeEach(() => {
  devere = true;
  perms = ["warping-order:read"];
  open.mockReset();
  get.mockReset().mockResolvedValue(result([row({})]));
});

describe("Devere gecikmeleri bandı", () => {
  it("⭐ devere kapalıyken çizilmez ve istek atmaz", () => {
    devere = false;
    const { container } = renderWithProviders(<DevereDelayBand subcontractorId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it("⭐ `warping-order:read` yoksa çizilmez ve istek atmaz", () => {
    perms = [];
    const { container } = renderWithProviders(<DevereDelayBand subcontractorId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it("⭐ varsayılan Geciken: `filter[state]=OVERDUE` + firma süzgeci sunucuya gider; sayaçlar yanıttan", async () => {
    renderWithProviders(<DevereDelayBand subcontractorId="f1" />);
    await screen.findByText("DV-001");
    expect(get).toHaveBeenCalledWith("/api/warping-orders/delays", { params: { "filter[state]": "OVERDUE", "filter[subcontractorId]": "f1" } });
    expect(screen.getByRole("button", { name: "Geciken (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2 gün içinde (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminsiz (3)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tüm açık (9)" }));
    await waitFor(() => expect(get.mock.calls.at(-1)![1]).toEqual({ params: { "filter[subcontractorId]": "f1" } }));
  });

  it("satır sipariş sayfasına gider; gecikme metni sunucu gününden", async () => {
    renderWithProviders(<DevereDelayBand subcontractorId={null} />);
    const link = (await screen.findByText("DV-001")).closest("a")!;
    expect(link).toHaveAttribute("href", "/operations/fason-devere/wo1");
    expect(screen.getByText("4 gün gecikti")).toBeInTheDocument();
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith("/operations/fason-devere/wo1", expect.anything());
  });

  it("boş yanıt seçili duruma göre cümle kurar; hata 'yok' gibi gösterilmez", async () => {
    get.mockResolvedValueOnce(result([]));
    renderWithProviders(<DevereDelayBand subcontractorId={null} />);
    expect(await screen.findByText("Termini geçmiş açık devere siparişi yok.")).toBeInTheDocument();
  });

  it("hata durumunda yüklenemedi + tekrar dene", async () => {
    get.mockRejectedValue(new Error("500"));
    renderWithProviders(<DevereDelayBand subcontractorId={null} />);
    expect(await screen.findByText(/Devere gecikmeleri yüklenemedi/)).toBeInTheDocument();
  });

  it("5 satırdan fazlası katlanır", async () => {
    get.mockResolvedValue(result(Array.from({ length: 7 }, (_, i) => row({ warpingOrderId: `wo${i}`, orderNo: `DV-00${i}` }))));
    renderWithProviders(<DevereDelayBand subcontractorId={null} />);
    await screen.findByText("DV-000");
    expect(screen.queryByText("DV-006")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tümünü göster (7)" }));
    expect(screen.getByText("DV-006")).toBeInTheDocument();
  });

  it("saf etiketler: termin, ilerleme (ayırıcısız), parametre, sayaçsız çip", () => {
    expect(devereDueText({ overdueDays: 2, dueSource: "DISPATCH" })).toBe("2 gün gecikti (sevk termini)");
    expect(devereDueText({ overdueDays: 0, dueSource: "ORDER" })).toBe("Bugün dönmeli");
    expect(devereDueText({ overdueDays: -3, dueSource: "ORDER" })).toBe("3 gün var");
    expect(devereDueText({ overdueDays: null, dueSource: null })).toBe("Termin yok");
    expect(devereProgressText({ targetLengthM: "12000", receivedLengthM: "3500.4", remainingLengthM: "8499.6" })).toMatch(/^gelen 3\.?500 \/ 12\.?000 m · kalan 8\.?500 m$/);
    expect(devereDelayParams("ALL", null)).toEqual({});
    expect(devereChipLabel("OVERDUE", null)).toBe("Geciken");
  });
});
