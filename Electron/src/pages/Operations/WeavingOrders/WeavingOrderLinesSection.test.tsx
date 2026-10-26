// =============================================================================
// BEKÇİ — "Sipariş satırları" bölümü (Z2): kumaşsız sipariş-önce (kalem kumaş+rengi ön doldurur; dolu alan
// ezilmez; ikinci kumaş kilitli) · DTO satırları çizilir · seçiciden ekle · kaldır
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { WeavingOrderLinesSection } from "./WeavingOrderLinesSection";
import { weavingOrderFormDefaults, type WeavingOrderFormValues } from "./schema";
import type { WeavingOrderLineLink } from "./types";

const listAvailable = vi.fn();
vi.mock("@/pages/Operations/Orders/availableLines", async (orig) => {
  const m = await orig<typeof import("@/pages/Operations/Orders/availableLines")>();
  return { ...m, listAvailableOrderLines: (...a: unknown[]) => listAvailable(...a) };
});

const LINK: WeavingOrderLineLink = { id: "x1", orderLineId: "l1", allocatedM: 120, orderLine: { id: "l1", quantity: 300, shippedQty: 0, unit: "MT", cancelledAt: null, order: { id: "o1", orderNumber: "SP-1", customer: { id: "c1", name: "ALFA" } }, item: { id: "i1", code: "K1", name: "PATOS" } } };
const AVAILABLE = { success: true, data: [{ lineId: "l2", itemId: "i1", orderId: "o2", orderNumber: "SP-2", deadline: null, customerId: "c2", customerName: "BETA", branchName: null, itemCode: "K1", itemName: "PATOS", customerItemName: null, colorId: null, colorCode: null, colorName: null, customerColorName: null, width: null, quantity: "400", openQty: "400", inProduction: "0", netOpenQty: "400", measured: true, hasWorkOrder: false }], pagination: { nextCursor: null, hasMore: false, limit: 100 } };

const ROW = AVAILABLE.data[0];
const SIPARIS_ONCE = { ...AVAILABLE, data: [{ ...ROW, colorId: "r1", colorName: "LACİVERT" }, { ...ROW, lineId: "l3", itemId: "i2", orderNumber: "SP-3", itemName: "SATEN" }] };

function Harness({ itemId, colorId = "", initial, onValues, onFabric }: { itemId: string; colorId?: string; initial: WeavingOrderLineLink[]; onValues: (v: WeavingOrderFormValues["orderLines"]) => void; onFabric?: (v: { itemId: string; colorId: string | undefined }) => void }) {
  const form = useForm<WeavingOrderFormValues>({ defaultValues: { ...weavingOrderFormDefaults, itemId, colorId, orderLines: initial.map((l) => ({ orderLineId: l.orderLineId, allocatedM: String(l.allocatedM ?? "") })) } });
  return (
    <form>
      <WeavingOrderLinesSection form={form} initialLines={initial} />
      <button type="button" onClick={() => onValues(form.getValues("orderLines"))}>oku</button>
      <button type="button" onClick={() => onFabric?.({ itemId: form.getValues("itemId"), colorId: form.getValues("colorId") })}>kumas</button>
    </form>
  );
}

describe("WeavingOrderLinesSection", () => {
  it("⭐ ön doldurma: kumaş seçilmeden kalem seçilir → kumaş + renk kalemden dolar; ikinci kumaşın kalemi kilitli", async () => {
    const user = userEvent.setup();
    listAvailable.mockResolvedValue(SIPARIS_ONCE);
    const onFabric = vi.fn();
    renderWithProviders(<Harness itemId="" initial={[]} onValues={() => {}} onFabric={onFabric} />);
    expect(screen.queryByTestId("wo-order-lines")).toBeNull();
    await user.click(screen.getByTestId("wo-ol-ekle"));
    await waitFor(() => expect(listAvailable).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: undefined, limit: 50 })));
    await user.click(await screen.findByLabelText("SP-2 seç"));
    expect(screen.getByLabelText("SP-3 seç")).toBeDisabled();
    await user.click(screen.getByTestId("ol-ekle"));
    await user.click(screen.getByText("kumas"));
    expect(onFabric).toHaveBeenLastCalledWith({ itemId: "i1", colorId: "r1" });
  });

  it("⭐ elle seçim korunur: kumaş/renk doluysa kalem seçimi onları EZMEZ", async () => {
    const user = userEvent.setup();
    listAvailable.mockResolvedValue({ ...AVAILABLE, data: [{ ...ROW, colorId: "r1" }] });
    const onFabric = vi.fn();
    renderWithProviders(<Harness itemId="i1" colorId="r9" initial={[]} onValues={() => {}} onFabric={onFabric} />);
    await user.click(screen.getByTestId("wo-ol-ekle"));
    await user.click(await screen.findByLabelText("SP-2 seç"));
    await user.click(screen.getByTestId("ol-ekle"));
    await user.click(screen.getByText("kumas"));
    expect(onFabric).toHaveBeenLastCalledWith({ itemId: "i1", colorId: "r9" });
  });

  it("⭐ DTO satırı çizilir (sipariş no · müşteri · açık); kaldır → form dizisi boşalır (REPLACE)", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    renderWithProviders(<Harness itemId="i1" initial={[LINK]} onValues={onValues} />);
    expect(screen.getByText("SP-1")).toBeInTheDocument();
    expect(screen.getByText("ALFA")).toBeInTheDocument();
    expect(screen.getByText(/300 m açık/)).toBeInTheDocument();
    expect(screen.getByLabelText("SP-1 tahsis metresi")).toHaveValue("120");
    await user.click(screen.getByLabelText("SP-1 bağını kaldır"));
    await user.click(screen.getByText("oku"));
    expect(onValues).toHaveBeenLastCalledWith([]);
  });

  it("⭐ seçiciden ekle: yalnız seçili kumaşın açık kalemleri istenir, seçilen satır tabloya ve form dizisine girer (tahsis boş)", async () => {
    const user = userEvent.setup();
    listAvailable.mockResolvedValue(AVAILABLE);
    const onValues = vi.fn();
    renderWithProviders(<Harness itemId="i1" initial={[]} onValues={onValues} />);
    await user.click(screen.getByTestId("wo-ol-ekle"));
    await waitFor(() => expect(listAvailable).toHaveBeenCalledWith(expect.objectContaining({ itemId: "i1", colorId: null })));
    await user.click(await screen.findByLabelText("SP-2 seç"));
    await user.click(screen.getByTestId("ol-ekle"));
    await waitFor(() => expect(screen.getByTestId("wo-ol-l2")).toBeInTheDocument());
    expect(screen.getByText("BETA")).toBeInTheDocument();
    await user.click(screen.getByText("oku"));
    expect(onValues).toHaveBeenLastCalledWith([{ orderLineId: "l2", allocatedM: "" }]);
  });
});
