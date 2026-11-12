import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order } from "../types";
import type { OrderAccess } from "./useOrderRecordData";

let access: OrderAccess;
let perms: string[];
let pricing = true;
let fetched: Order | undefined;
const allOpen = (): OrderAccess => ({ write: true, workOrders: true, weaving: true, shipments: true, documents: true, history: true, production: true });

vi.mock("./useOrderRecordData", () => ({
  useOrderAccess: () => access,
  useOrderRecord: (id: string | null) => ({ data: id ? fetched : undefined }),
}));
vi.mock("./useOrderMovements", () => ({
  useOrderMovements: () => ({ items: [{ key: "s1", kind: "Sevkiyat", tone: "blue", docNo: "SVK-1", sub: null, amount: "200 m", at: null, to: null }], loading: false, error: false, retry: () => {} }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.includes(p)) }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ usePricingEnabled: () => pricing }));
vi.mock("../production-proposal/ProductionProposalButton", () => ({ ProductionProposalButton: () => <button type="button">Üretime gönder</button> }));
vi.mock("../OrderConfirmationButton", () => ({ OrderConfirmationButton: () => <button type="button">Sipariş teyidi</button> }));

const { OrderSidePanel } = await import("./OrderSidePanel");
const { useOrderSelection } = await import("./useOrderSelection");

const line = (id: string, qty: number, name = `KUMAŞ ${id}`) => ({ id, itemId: `i${id}`, colorId: null, quantity: qty, unit: "MT", width: null, unitPrice: null, customerItemName: null, customerColorName: null, cutNote: null, item: { id: `i${id}`, code: id, name }, shippedQty: 0 });

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1", orderNumber: "SIP-1", customerId: "c1", branchId: null, currency: "TRY", totalAmount: "12500.5", status: "APPROVED", shippedQty: 400,
    orderDate: "2026-11-10T00:00:00.000Z", deadline: "2026-11-01T00:00:00.000Z", completedAt: null, manualClosedById: null, manualCloseReason: null,
    customer: { id: "c1", code: "MUS-1", name: "ÖRNEK PERDE" }, lines: [line("a", 1000), line("b", 500)], createdAt: "", updatedAt: "",
    ...over,
  } as unknown as Order;
}

function renderPanel(o: Order, onEdit: ((x: Order) => void) | null = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OrderSidePanel order={o} onClose={vi.fn()} onPrev={null} onNext={null} onEdit={onEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OrderSidePanel — içerik ve kapılar", () => {
  beforeEach(() => {
    access = allOpen();
    perms = ["order:read", "order:write"];
    pricing = true;
  });

  it("istenen / sevk / kalan metre ayırıcısız; tutar binlik ayırıcılı; termin düz tarih, gecikme vurgusu YOK", () => {
    renderPanel(order());
    expect(screen.getByText("1500 m")).toBeTruthy();
    expect(screen.getByText("400 m")).toBeTruthy();
    expect(screen.getByText("1100 m")).toBeTruthy();
    expect(screen.getByText("12.500,50 TRY")).toBeTruthy();
    expect(screen.getByText("01.11.2026")).toBeTruthy();
    expect(screen.queryByText(/gün (kaldı|geçti)|gecik|Termini geçti/i)).toBeNull();
    expect(screen.getByText("SVK-1")).toBeTruthy();
  });

  it("fiyat kapalıysa tutar satırı yok; yazma izni yoksa Düzenle çizilmez", () => {
    pricing = false;
    perms = ["order:read"];
    renderPanel(order());
    expect(screen.queryByText(/TRY/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Sipariş teyidi/ })).toBeTruthy();
  });

  it("Düzenle yalnız düzenlenebilir durumda; tıklayınca siparişi verir", () => {
    const onEdit = vi.fn();
    renderPanel(order(), onEdit);
    fireEvent.click(screen.getByRole("button", { name: /Düzenle/ }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }));
  });

  it("tamamlanmış siparişte Düzenle yok", () => {
    renderPanel(order({ status: "COMPLETED" }));
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
  });

  it("kalem özeti ilk 5; fazlası için 'Tümü' bağlantısı", () => {
    const lines = Array.from({ length: 7 }, (_, i) => line(String(i), 100, `K${i}`));
    renderPanel(order({ lines } as Partial<Order>));
    expect(screen.getByText("K4")).toBeTruthy();
    expect(screen.queryByText("K5")).toBeNull();
    expect(screen.getByRole("button", { name: "Tümü (7)" })).toBeTruthy();
  });
});

function wrapper(initial: string) {
  let loc = "";
  function Spy() {
    loc = useLocation().search;
    return null;
  }
  const W = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>
      <Spy />
      {children}
    </MemoryRouter>
  );
  return { W, loc: () => loc };
}

describe("useOrderSelection — ?kayit= ve ↑↓", () => {
  const rows = [order({ id: "a" }), order({ id: "b" }), order({ id: "c" })];
  beforeEach(() => {
    fetched = undefined;
  });

  it("seçim URL'ye yazılır, komşu kayıtlar uçta durur, kapatınca silinir", () => {
    const { W, loc } = wrapper("/operations/orders");
    const { result } = renderHook(() => useOrderSelection(rows), { wrapper: W });
    expect(result.current.selected).toBeNull();
    act(() => result.current.select("b"));
    expect(loc()).toBe("?kayit=b");
    expect(result.current.selected?.id).toBe("b");
    act(() => result.current.next!());
    expect(result.current.selected?.id).toBe("c");
    expect(result.current.next).toBeNull();
    act(() => result.current.select(null));
    expect(loc()).toBe("");
  });

  it("eski ?focus= derin bağı ?kayit='e çevrilir; listede yoksa uçtan gelen kayıt açılır", () => {
    fetched = order({ id: "z", orderNumber: "SIP-Z" });
    const { W, loc } = wrapper("/operations/orders?focus=z");
    const { result } = renderHook(() => useOrderSelection(rows), { wrapper: W });
    expect(loc()).toBe("?kayit=z");
    expect(result.current.selected?.orderNumber).toBe("SIP-Z");
    expect(result.current.prev).toBeNull();
  });
});
