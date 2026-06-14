import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Inbox } from "lucide-react";
import { EmptyState } from "./empty-state";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// A11Y testi — boş-durum bileşeni (ikon + başlık + açıklama + aksiyon butonu).
// jsdom'da anlamlı kurallar: dekoratif ikonun erişilebilirlik ağacını kirletmemesi
// (lucide svg aria-hidden), aksiyon butonunun erişilebilir bir isminin olması.
// EmptyState uygulama genelinde liste/hata durumlarında tekrar tekrar render edilir.
// ─────────────────────────────────────────────────────────────────────────────

const axeOptions = {
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
} as const;

describe("EmptyState — a11y", () => {
  it("ikon + başlık + açıklama + aksiyon: kritik/ciddi ihlal yok", async () => {
    const { container } = render(
      <EmptyState
        icon={Inbox}
        title="Kayıt bulunamadı"
        description="Filtreleri değiştirin veya yeni bir kayıt ekleyin."
        action={<Button>Yeni Ekle</Button>}
      />,
    );
    const results = await axe(container, axeOptions);
    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(blocking).toEqual([]);
  });

  it("yalnız başlık (aksiyonsuz) varyantında da ihlal yok", async () => {
    const { container } = render(<EmptyState title="Henüz veri yok" />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
