// BEKÇİ — Patron telefonu bağlantı karekodu: https internet adresinde karekod + adres metni; http/yerel adreste karekod
//   YOK ve neden yazılı; yönetici adresi düzeltince karekod o adresle; karekod içeriği ortak biçimden (geri okunur).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { patronKarekoduOku } from "@shared/patron-karekod";
import { varsayilanPatronAdresi } from "./patron-telefon";

let base = "https://erp.etkiliyazilim.com";
vi.mock("@/lib/api-config", () => ({ getActiveApiBaseUrl: () => base }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("qrcode.react", () => ({ QRCodeSVG: (p: { value: string }) => <svg data-testid="patron-karekod" data-value={p.value} /> }));
import { PatronPhonePage } from "./PatronPhonePage";

const karekod = () => screen.queryByTestId("patron-karekod")?.getAttribute("data-value") ?? null;

describe("PatronPhonePage", () => {
  beforeEach(() => {
    base = "https://erp.etkiliyazilim.com";
  });

  it("⭐ panelin https adresi varsayılan: karekod + adres metni, içerik ortak biçimle geri okunur", () => {
    render(<PatronPhonePage />);
    expect(karekod()).toBe("tekserp-patron:1:https://erp.etkiliyazilim.com");
    expect(patronKarekoduOku(karekod()!)).toEqual({ tamam: true, adres: "https://erp.etkiliyazilim.com" });
    expect(screen.getByTestId("patron-karekod-adres").textContent).toBe("https://erp.etkiliyazilim.com");
    expect(screen.queryByText("Sertifikayı denetleyin")).toBeNull();
  });

  it("⭐ http adreste karekod üretilmez, nedeni yazılır", () => {
    base = "http://192.168.1.20:4000";
    render(<PatronPhonePage />);
    expect(karekod()).toBeNull();
    expect(screen.getByTestId("patron-karekod-neden").textContent).toMatch(/şifresiz/);
  });

  it("⭐ yerel https adres (sunucu makinesindeki panel) karekod üretmez", () => {
    base = "https://127.0.0.1:4443";
    render(<PatronPhonePage />);
    expect(karekod()).toBeNull();
    expect(screen.getByTestId("patron-karekod-neden").textContent).toMatch(/yerel/);
  });

  it("yönetici adresi düzeltir → karekod yeni adresle; izinli üst alan dışı ad için sertifika uyarısı", () => {
    base = "https://127.0.0.1:4443";
    render(<PatronPhonePage />);
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "erp.fabrikam.com.tr/api" } });
    expect(karekod()).toBe("tekserp-patron:1:https://erp.fabrikam.com.tr");
    expect(screen.getByText("Sertifikayı denetleyin")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "" } });
    expect(karekod()).toBeNull();
  });

  it("varsayılan adres: mutlak API adresi aynen; göreli (web) adreste sayfa kökeni", () => {
    expect(varsayilanPatronAdresi("https://a.b.com", "https://x.y.com")).toBe("https://a.b.com");
    expect(varsayilanPatronAdresi("", "https://x.y.com")).toBe("https://x.y.com");
    expect(varsayilanPatronAdresi("/api", "https://x.y.com")).toBe("https://x.y.com");
    expect(varsayilanPatronAdresi(undefined, undefined)).toBe("");
  });
});
