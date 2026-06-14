import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusBadge, orderStatusTones } from "./StatusBadge";

// ─────────────────────────────────────────────────────────────────────────────
// YAPISAL SNAPSHOT — StatusBadge tamamen deterministik (tarih/uuid/random YOK).
// Ton→sınıf eşlemesi tüm uygulamada durum rozetlerinin tutarlı boyanmasını
// sağlar; bir tonun sınıf seti veya etiket eşlemesi yanlışlıkla değişirse diff verir.
// ─────────────────────────────────────────────────────────────────────────────

const orderLabels: Record<string, string> = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};

describe("StatusBadge — yapısal snapshot", () => {
  it("sipariş durumları için ton/etiket sınıfları sabit kalır", () => {
    const { container } = render(
      <div>
        {(Object.keys(orderStatusTones) as Array<keyof typeof orderStatusTones>).map((status) => (
          <StatusBadge key={status} status={status} labels={orderLabels} tones={orderStatusTones} />
        ))}
      </div>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("bilinmeyen durum → ham status + defaultTone (neutral)", () => {
    const { container } = render(<StatusBadge status="UNKNOWN_STATE" />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
