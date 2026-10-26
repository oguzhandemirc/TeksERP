// Yayınla onayı aynı kapsam+dövizde yayındaki listeyi ADIYLA söyler; çift tık TEK istek; yazma izni yoksa eylem yok;
// salt-okunur satırlarda maliyet kolonu yalnız sunucu alanı koyduysa.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import type { PriceListDetail, PriceListLine } from "./pl-types";

let perms: string[] = [];
const publish = vi.fn();
const list = vi.fn();
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p), hasAnyPermission: () => true }) }));
vi.mock("./service", async (orig) => ({
  ...(await orig<object>()),
  priceListService: { publish: (...a: unknown[]) => publish(...a), list: (...a: unknown[]) => list(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
import { PriceListActions } from "./PriceListActions";
import { PriceListLinesView } from "./PriceListLinesEditor";

const line = (extra: Partial<PriceListLine> = {}) =>
  ({ id: "l1", lineNo: 1, itemId: "i1", item: { id: "i1", code: "K1", name: "Kumaş" }, colorId: null, color: null, unitPrice: "10", minQty: null, ...extra }) as PriceListLine;
const draft = (lines: PriceListLine[] = [line()]) =>
  ({ id: "p2", listNo: "FL-2", revisionNo: 1, name: "Yeni", customerId: "c1", customer: { id: "c1", code: "M1", name: "Acme" }, currency: "USD", status: "DRAFT", lines }) as unknown as PriceListDetail;

describe("PriceListActions", () => {
  beforeEach(() => {
    publish.mockReset();
    list.mockReset();
    perms = ["price-list:write"];
  });
  it("yayınla: yayındaki eş listeyi adıyla söyler, müşteri+döviz süzgeciyle sorar; çift tık tek istek", async () => {
    list.mockResolvedValue({ data: [{ id: "p1", listNo: "FL-1", revisionNo: 1, name: "2026 Bahar" }], ozet: { toplam: 1 }, toplamSuzulen: 1, nextCursor: null });
    publish.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<PriceListActions list={draft()} />);
    fireEvent.click(screen.getByRole("button", { name: "Yayınla" }));
    expect(await screen.findByTestId("pl-publish-peer")).toHaveTextContent("FL-1 — 2026 Bahar");
    expect(list.mock.calls[0]?.[0]).toMatchObject({ status: "PUBLISHED", currency: "USD", scope: "customer", customerId: "c1" });
    const ok = screen.getByTestId("pl-confirm");
    fireEvent.click(ok);
    fireEvent.click(ok);
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  });
  it("satırsız ya da kaydedilmemiş satırlı taslak yayınlanamaz", () => {
    const { unmount } = renderWithProviders(<PriceListActions list={draft([])} />);
    expect(screen.getByRole("button", { name: "Yayınla" })).toBeDisabled();
    unmount();
    renderWithProviders(<PriceListActions list={draft()} dirtyLines />);
    expect(screen.getByRole("button", { name: "Yayınla" })).toBeDisabled();
  });
  it("price-list:write yok → eylem çubuğu yok", () => {
    perms = [];
    renderWithProviders(<PriceListActions list={draft()} />);
    expect(screen.queryByTestId("pl-actions")).toBeNull();
  });
});

describe("PriceListLinesView", () => {
  it("maliyet alanı yoksa kolon yok; varsa var", () => {
    const { unmount } = renderWithProviders(<PriceListLinesView list={{ ...draft(), status: "PUBLISHED" } as PriceListDetail} />);
    expect(screen.queryByTestId("pl-col-cost")).toBeNull();
    unmount();
    renderWithProviders(<PriceListLinesView list={{ ...draft([line({ costPerMTry: "5", markupPct: "20" })]), status: "PUBLISHED" } as PriceListDetail} />);
    expect(screen.getByTestId("pl-col-cost")).toBeInTheDocument();
  });
});
