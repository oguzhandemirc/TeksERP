import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LicenseDetail } from "@/types/license";
import type { AcceptanceGate } from "@/lib/license/acceptance";
import { LicenseActivateCard } from "./LicenseActivateCard";
import { LicenseOfflineCard } from "./LicenseOfflineCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({ licenseService: { activate: vi.fn(), offlineRequest: vi.fn(), offlineResponse: vi.fn(), relayRequest: vi.fn(), relayResponse: vi.fn(), pollNow: vi.fn() } }));

const d = { kurulum: { etkin: false } } as unknown as LicenseDetail;
const KAPALI: AcceptanceGate = { ready: false, reason: "Etkinleştirmeden önce lisans sözleşmesini kabul edin." };
const ACIK: AcceptanceGate = { ready: true, reason: null };
const kodYaz = (el: HTMLElement) => fireEvent.change(el, { target: { value: "TKS-7K3M-9QRT-2XWZ-4HJN" } });
const pasif = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled");

/** Üç etkinleştirme yolu da (çevrimiçi · bu bilgisayar üzerinden · QR) sözleşme kabulü olmadan PASİF (Ek-7 §5). */
describe("Lisans ekranı — etkinleştirme kabul kapısı", () => {
  beforeEach(() => {
    (window as unknown as { api: unknown }).api = { license: { relay: vi.fn() } };
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("⭐ kabul yokken kod yazılsa da çevrimiçi ve 'bu bilgisayar üzerinden' pasif, gerekçe görünür", () => {
    renderWithProviders(<LicenseActivateCard d={d} gate={KAPALI} />);
    kodYaz(screen.getByLabelText("Etkinleştirme kodu"));
    expect(pasif("Etkinleştir")).toBe(true);
    expect(pasif("Bu bilgisayar üzerinden etkinleştir")).toBe(true);
    expect(screen.getByTestId("lisans-kabul-kapisi").textContent).toBe(KAPALI.reason);
  });

  it("kabul geçerliyse iki düğme de kodla açılır", () => {
    renderWithProviders(<LicenseActivateCard d={d} gate={ACIK} />);
    expect(pasif("Etkinleştir")).toBe(true);
    kodYaz(screen.getByLabelText("Etkinleştirme kodu"));
    expect(pasif("Etkinleştir")).toBe(false);
    expect(pasif("Bu bilgisayar üzerinden etkinleştir")).toBe(false);
    expect(screen.queryByTestId("lisans-kabul-kapisi")).toBeNull();
  });

  it("⭐ QR: kabul yokken etkinleştirme isteği oluşturulamaz; kabulle açılır", () => {
    const { unmount } = renderWithProviders(<LicenseOfflineCard d={d} gate={KAPALI} />);
    kodYaz(screen.getByPlaceholderText(/Etkinleştirme kodu/));
    expect(pasif("Etkinleştirme isteği oluştur")).toBe(true);
    expect(screen.getByText(KAPALI.reason!)).toBeTruthy();
    unmount();
    renderWithProviders(<LicenseOfflineCard d={d} gate={ACIK} />);
    kodYaz(screen.getByPlaceholderText(/Etkinleştirme kodu/));
    expect(pasif("Etkinleştirme isteği oluştur")).toBe(false);
  });

  it("etkin kurulumun yenilemesi kabul kapısından ETKİLENMEZ (yalnız ilk/yeniden etkinleştirme)", () => {
    const etkin = { kurulum: { etkin: true } } as unknown as LicenseDetail;
    renderWithProviders(<LicenseOfflineCard d={etkin} gate={KAPALI} />);
    expect(pasif("Yenileme isteği oluştur")).toBe(false);
  });
});
