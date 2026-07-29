import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const getSpecAvailability = vi.fn();
vi.mock("./service", () => ({
  orderService: {
    getSpecAvailability: (...args: unknown[]) => getSpecAvailability(...args),
  },
}));

import { OrderLineAtpHint } from "./OrderLineAtpHint";

function resolve(data: { freeWarehouse: number; inProduction: number; freeStock: number }) {
  getSpecAvailability.mockResolvedValue({ success: true, data });
}

describe("OrderLineAtpHint", () => {
  beforeEach(() => {
    getSpecAvailability.mockReset();
  });

  it("itemId boşsa render yok ve servis çağrılmaz", () => {
    const { container } = renderWithProviders(
      <OrderLineAtpHint itemId="" colorId={null} width={null} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(getSpecAvailability).not.toHaveBeenCalled();
  });

  it("değerleri gösterir (Depoda · Üretimde · Ham)", async () => {
    resolve({ freeWarehouse: 1250, inProduction: 300, freeStock: 500 });
    renderWithProviders(<OrderLineAtpHint itemId="it1" colorId="c1" width={180} />);
    expect(await screen.findByText(/Depoda:/)).toBeInTheDocument();
    expect(screen.getByText("1.250 m")).toBeInTheDocument();
    expect(screen.getByText("300 m")).toBeInTheDocument();
    expect(screen.getByText("500 m")).toBeInTheDocument();
  });

  it("freeStock=0 iken Ham gizlenir", async () => {
    resolve({ freeWarehouse: 100, inProduction: 0, freeStock: 0 });
    renderWithProviders(<OrderLineAtpHint itemId="it1" colorId="c1" width={180} />);
    expect(await screen.findByText(/Depoda:/)).toBeInTheDocument();
    expect(screen.queryByText(/Ham:/)).not.toBeInTheDocument();
  });

  it("üçü 0 iken kompakt 'Serbest stok yok' satırı", async () => {
    resolve({ freeWarehouse: 0, inProduction: 0, freeStock: 0 });
    renderWithProviders(<OrderLineAtpHint itemId="it1" colorId="c1" width={180} />);
    expect(await screen.findByText(/Serbest stok yok/)).toBeInTheDocument();
  });

  it("width=0 → servise null en gider (Zod 400 önlenir)", async () => {
    resolve({ freeWarehouse: 0, inProduction: 0, freeStock: 0 });
    renderWithProviders(<OrderLineAtpHint itemId="it1" colorId="c1" width={0} />);
    await screen.findByText(/Serbest stok yok/);
    expect(getSpecAvailability).toHaveBeenCalledWith("it1", "c1", null);
  });
});
