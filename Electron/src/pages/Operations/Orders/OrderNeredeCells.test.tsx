import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeredeCell, SevkCell } from "./OrderNeredeCells";
import { neredeExportText } from "./order-nerede";
import { orderSevkText } from "./order-cell-text";
import type { Order } from "./types";

const row: Pick<Order, "status" | "nerede" | "sevk"> = {
  status: "PARTIAL_SHIPPED",
  nerede: {
    kind: "FASON",
    tone: "orange",
    text: "Fasonda – Akın Boya · 8 top · 3 gündür",
    extraPlaces: 0,
    overdue: true,
    overdueText: "Termini geçti",
  },
  sevk: { kind: "PARTIAL", text: "Bir kısmı gönderildi (1.200 / 2.400 m)", shipped: 1200, requested: 2400, unit: "MT" },
};

describe("Nerede? / Sevk hücreleri", () => {
  it("ekrandaki metin = Excel/PDF metni (rozetler ' · ' ile birleşir)", () => {
    const { container } = render(<NeredeCell order={row} />);
    const shown = Array.from(container.firstElementChild!.children)
      .map((el) => el.textContent)
      .join(" · ");
    expect(shown).toBe(neredeExportText(row));
    const s = render(<SevkCell order={row} />);
    expect(s.container.textContent).toBe(orderSevkText(row));
    expect(s.container.textContent).toBe("Bir kısmı gönderildi (1.200 / 2.400 m)");
  });

  it("termin geçtiyse kırmızı ek rozet; geçmediyse yok", () => {
    render(<NeredeCell order={row} />);
    expect(screen.getByTestId("nerede-overdue")).toHaveTextContent("Termini geçti");
    expect(screen.getByText("Fasonda – Akın Boya · 8 top · 3 gündür").className).toMatch(/text-warning/);
  });

  it("termin geçmediyse ek rozet çizilmez", () => {
    render(<NeredeCell order={{ nerede: { ...row.nerede!, overdue: false, overdueText: null } }} />);
    expect(screen.queryByTestId("nerede-overdue")).toBeNull();
  });

  it("eski sunucu (alan yok) → '—'", () => {
    expect(render(<NeredeCell order={{}} />).container.textContent).toBe("—");
    // Sevk durumu eski sunucuda da boş kalmaz: durumun günlük etiketi yazılır.
    expect(render(<SevkCell order={{ status: "APPROVED" }} />).container.textContent).toBe("Henüz gönderilmedi");
  });
});
