import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

/**
 * Şifre Sıfırla — "ilk girişte kendi parolasını belirlesin" kutusu (kullanıcı şikâyeti 2026-11-01).
 * Varsayılan işaretli = eski davranış (geçici parola); kaldırılınca `requireChange:false` gider.
 */
const resetPassword = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/services/adminUserService", () => ({ adminUserService: { resetPassword } }));

import { ResetPasswordTab } from "./ResetPasswordTab";

const PAROLA = "Yeni-Parola-123";

async function doldurVeGonder(): Promise<void> {
  fireEvent.change(document.getElementById("password")!, { target: { value: PAROLA } });
  fireEvent.change(document.getElementById("confirm")!, { target: { value: PAROLA } });
  fireEvent.click(screen.getByRole("button", { name: /Şifreyi Sıfırla/ }));
  await waitFor(() => expect(resetPassword).toHaveBeenCalledTimes(1));
}

describe("ResetPasswordTab — zorunlu değişim seçeneği", () => {
  beforeEach(() => resetPassword.mockClear());

  it("kutu varsayılan işaretli; gönderim requireChange:true taşır", async () => {
    renderWithProviders(<ResetPasswordTab userId="u1" username="ayse" />);
    const kutu = screen.getByRole("checkbox", { name: /ilk girişte kendi parolasını belirlesin/ });
    expect(kutu.getAttribute("data-state")).toBe("checked");
    await doldurVeGonder();
    expect(resetPassword).toHaveBeenCalledWith("u1", PAROLA, true);
  });

  it("kutu kaldırılınca açıklama 'kalıcı' der ve requireChange:false gider", async () => {
    renderWithProviders(<ResetPasswordTab userId="u1" username="ayse" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /ilk girişte kendi parolasını belirlesin/ }));
    expect(screen.getByText(/parola kalıcı olur/)).toBeTruthy();
    await doldurVeGonder();
    expect(resetPassword).toHaveBeenCalledWith("u1", PAROLA, false);
    expect(await screen.findByText(/bu şifreyle doğrudan girecek/)).toBeTruthy();
  });
});
