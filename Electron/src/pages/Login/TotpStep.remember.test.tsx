import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TotpStep } from "./TotpStep";
import { readTrustDeviceDays } from "@/lib/totp-auth";

// Sonda (2026-11-01): `trustDeviceDays > 0 &&` koşulu kaldırılınca "N=0'da kutu yok" kırmızı;
// gönderimde `remember` yerine `false` → "işaretliyse rememberDevice=true" kırmızı.

const submit = (onSubmit: ReturnType<typeof vi.fn>, days: number, tick: boolean) => {
  render(<TotpStep submitting={false} invalid={false} trustDeviceDays={days} onSubmit={onSubmit} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText("Doğrulama kodu"), { target: { value: "123456" } });
  if (tick) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Doğrula ve gir" }));
};

describe("Kod adımı — bu cihazı hatırla", () => {
  it("N=0 → kutu yok, gönderim rememberDevice=false", () => {
    const onSubmit = vi.fn();
    submit(onSubmit, 0, false);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith("123456", false);
  });

  it("N>0 → 'Bu cihazı N gün hatırla' kutusu; işaretliyse rememberDevice=true", () => {
    const onSubmit = vi.fn();
    submit(onSubmit, 30, true);
    expect(screen.getByText(/Bu cihazı 30 gün hatırla/)).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith("123456", true);
  });

  it("N>0 ama işaretsiz → rememberDevice=false", () => {
    const onSubmit = vi.fn();
    submit(onSubmit, 30, false);
    expect(onSubmit).toHaveBeenCalledWith("123456", false);
  });

  it("409 details.trustDeviceDays okuyucusu: sayı → N, yok/çöp → 0", () => {
    const e = (v: unknown) => ({ response: { status: 409, data: { details: { code: "TOTP_REQUIRED", trustDeviceDays: v } } } });
    expect(readTrustDeviceDays(e(30))).toBe(30);
    expect(readTrustDeviceDays(e(undefined))).toBe(0);
    expect(readTrustDeviceDays(e("30"))).toBe(0);
    expect(readTrustDeviceDays(e(-1))).toBe(0);
  });
});
