import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { FormField } from "./FormField";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// A11Y testi — Login formunun yapı taşları (FormField + Label + Input + Button).
// Login sayfasının tamamını mount etmek router/auth-store/tema/asset bağımlılığı
// getirir; bunun yerine erişilebilirlik açısından ASIL önemli olan bileşimi
// (label↔input eşleşmesi, buton ismi, zorunlu alan) izole test ediyoruz —
// jsdom'da anlamlı kurallar bunlar. Login.tsx aynı FormField+Input+Button'u kullanır.
// ─────────────────────────────────────────────────────────────────────────────

const axeOptions = {
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
} as const;

function LoginLikeForm() {
  return (
    <form aria-label="Giriş formu">
      <FormField label="Kullanıcı adı" htmlFor="username" required>
        <Input id="username" autoComplete="username" placeholder="ör. admin" />
      </FormField>
      <FormField label="Şifre" htmlFor="password" required>
        <Input id="password" type="password" autoComplete="current-password" />
      </FormField>
      <Button type="submit">Giriş Yap</Button>
    </form>
  );
}

describe("FormField (Login formu yapısı) — a11y", () => {
  it("kritik/ciddi erişilebilirlik ihlali yok", async () => {
    const { container } = render(<LoginLikeForm />);
    const results = await axe(container, axeOptions);
    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(blocking).toEqual([]);
  });

  it("hata gösterilen alanda da ihlal yok (label↔input + hata metni)", async () => {
    const { container } = render(
      <FormField label="Kullanıcı adı" htmlFor="u" error={{ message: "Kullanıcı adı gerekli" }} required>
        <Input id="u" />
      </FormField>,
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
