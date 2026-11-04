import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShipCell, WhereCell } from "./OrderWhereCells";
import { orderShipText, orderWhereExportText } from "./order-where-text";
import type { Order, OrderLine, OrderWhere } from "./types";

const nerede: OrderWhere = {
  durum: "YERLER",
  yerler: [{ tur: "FASON", id: "f1", ad: "Akın Boya", topSayisi: 8, metre: 400, gun: 3 }],
  terminGecti: true,
  sonHareket: null,
};

describe("Nerede? / Sevk hücreleri", () => {
  it("ekrandaki metin = Excel/PDF metni (rozetler ' · ' ile birleşir)", () => {
    const row = { nerede, manualClosedById: null };
    const { container } = render(<WhereCell order={row} />);
    const shown = Array.from(container.firstElementChild!.children)
      .map((el) => el.textContent)
      .join(" · ");
    expect(shown).toBe(orderWhereExportText(row));
    expect(screen.getByText("Fasonda – Akın Boya · 8 top · 3 gündür").className).toMatch(/warning/);
    expect(screen.getByTestId("where-overdue")).toHaveTextContent("Termini geçti");
  });

  it("termin geçmediyse ek rozet çizilmez", () => {
    render(<WhereCell order={{ nerede: { ...nerede, terminGecti: false }, manualClosedById: null }} />);
    expect(screen.queryByTestId("where-overdue")).toBeNull();
  });

  it("alan yok (üretim kapalı / eski backend) → '—'", () => {
    expect(render(<WhereCell order={{ nerede: null, manualClosedById: null }} />).container.textContent).toBe("—");
  });

  it("Sevk hücresi Excel metniyle aynı", () => {
    const o = { status: "PARTIAL_SHIPPED", shippedQty: 1200, manualClosedById: null, lines: [{ quantity: 2400, unit: "MT" } as OrderLine] } as Pick<
      Order,
      "status" | "shippedQty" | "manualClosedById" | "lines"
    >;
    const { container } = render(<ShipCell order={o} />);
    expect(container.textContent).toBe("Bir kısmı gönderildi (1.200 / 2.400 m)");
    expect(container.textContent).toBe(orderShipText(o));
  });

  it("Sevk durumu rozeti: iptal sipariş 'Henüz gönderilmedi' demez, sönük renkte", () => {
    const o = { status: "CANCELLED", shippedQty: 0, manualClosedById: null, lines: [{ quantity: 2400, unit: "MT" } as OrderLine] } as Pick<
      Order,
      "status" | "shippedQty" | "manualClosedById" | "lines"
    >;
    render(<ShipCell order={o} />);
    expect(screen.getByText("Sipariş iptal edildi").className).toMatch(/muted/);
  });
});
