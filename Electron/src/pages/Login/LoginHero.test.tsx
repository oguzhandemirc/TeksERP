import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { authService } from "@/services/authService";
import { LoginHero } from "./LoginHero";

/**
 * ⭐ İDDİA: giriş ekranının sol üstündeki firma adı BAĞLANILAN SUNUCUDAN gelir
 * (public login-methods → `company.name`); sunucu okunamazsa ya da ad boşsa
 * nötr "TeksERP" — hiçbir müşterinin adı koda gömülü değildir.
 */
function cizdir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LoginHero />
    </QueryClientProvider>,
  );
  return screen.getByTestId("login-company-name");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LoginHero — firma adı sunucudan", () => {
  it("⭐ sunucunun company.name değerini gösterir", async () => {
    vi.spyOn(authService, "getLoginMethods").mockResolvedValue({
      success: true,
      data: { companyName: "TEST SUNUCUSU · ThinkPad" },
    });
    const el = cizdir();
    await waitFor(() => expect(el.textContent).toBe("TEST SUNUCUSU · ThinkPad"));
  });

  it("⭐ sunucuya ulaşılamazsa nötr yedek (müşteri adı değil)", async () => {
    const spy = vi.spyOn(authService, "getLoginMethods").mockRejectedValue(new Error("ağ yok"));
    const el = cizdir();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(el.textContent).toBe("TeksERP");
  });

  it("ad boş dönerse nötr yedek", async () => {
    const spy = vi.spyOn(authService, "getLoginMethods").mockResolvedValue({
      success: true,
      data: { companyName: "   " },
    });
    const el = cizdir();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(el.textContent).toBe("TeksERP");
  });
});
