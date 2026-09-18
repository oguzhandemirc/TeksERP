// =============================================================================
// BEKÇİ — "Sipariş satırları" bölümü (Z2): kumaşsız kilitli · DTO satırları çizilir · seçiciden ekle · kaldır
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

function Harness({ itemId, initial, onValues }: { itemId: string; initial: WeavingOrderLineLink[]; onValues: (v: WeavingOrderFormValues["orderLines"]) => void }) {
  const form = useForm<WeavingOrderFormValues>({ defaultValues: { ...weavingOrderFormDefaults, itemId, orderLines: initial.map((l) => ({ orderLineId: l.orderLineId, allocatedM: String(l.allocatedM ?? "") })) } });
  return (
    <form>
      <WeavingOrderLinesSection form={form} initialLines={initial} />
      <button type="button" onClick={() => onValues(form.getValues("orderLines"))}>oku</button>
    </form>
  );
}

describe("WeavingOrderLinesSection", () => {
  it("kumaş seçilmeden 'Satır ekle' kilitli (önce kumaş); satır yok", () => {
    renderWithProviders(<Harness itemId="" initial={[]} onValues={() => {}} />);
    expect(screen.getByTestId("wo-ol-ekle")).toBeDisabled();
    expect(screen.queryByTestId("wo-order-lines")).toBeNull();
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
