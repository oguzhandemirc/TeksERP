import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiEndpointDialog } from "@/components/settings/ApiEndpointDialog";
import { LanTlsSection } from "@/components/settings/LanTlsSection";
import { BULUT_ONLY_REASON, FABRIKA_INTERNET_REASON } from "@/lib/server-mode";
import * as apiConfig from "@/lib/api-config";

/**
 * SUNUCU ADRESİ — "Fabrika içi / Bulut" (kullanıcı isteği 2026-10-08).
 * ⭐ Varsayılan Fabrika içi; ağ adresi yazılınca şifreli LAN (https + 4443), şifreli bağlantı bölümü görünür.
 * ⭐ Bulut: https sabit, port BOŞ ve KİLİTLİ (443), tıklayınca açılır; şifreli LAN bölümü ve ağ araması yok.
 * ⭐ Kayıtlı adres hangi moddaysa pencere o modda açılır (mod adresten türer, `panelTransportFor`).
 * ⭐ Seçilen mod adresi tutmuyorsa kayıt yapılmaz, Türkçe sebep yazılır.
 */
let active = "http://localhost:4000";
vi.mock("@/lib/api-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-config")>()),
  getActiveApiBaseUrl: () => active,
  getRecentApiBaseUrls: vi.fn(async () => []),
  setStoredApiBaseUrl: vi.fn(async () => undefined),
  pushRecentApiBaseUrl: vi.fn(async () => undefined),
  applyApiBaseUrl: vi.fn(),
}));
vi.mock("@/hooks/useServerDiscovery", () => ({ useServerDiscovery: () => ({ state: null, start: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

function installBridge() {
  (window as unknown as { api?: unknown }).api = {
    discovery: { tlsPins: vi.fn(async () => []), tlsObserve: vi.fn(async () => null), probe: vi.fn(async () => null) },
  };
}

function open(url: string) {
  active = url;
  return render(<ApiEndpointDialog open onOpenChange={vi.fn()} />);
}

const radio = (name: string) => screen.getByRole("radio", { name });
const port = () => screen.getByLabelText("Port") as HTMLInputElement;
const host = () => screen.getByLabelText(/Sunucu adresi/) as HTMLInputElement;
const shown = (url: string) => screen.getByText(url, { selector: "span.font-mono" });

beforeEach(() => {
  installBridge();
  vi.mocked(apiConfig.setStoredApiBaseUrl).mockClear();
});
afterEach(() => {
  (window as unknown as { api?: unknown }).api = undefined;
});

describe("Fabrika içi (varsayılan)", () => {
  it("seçili gelir; şifreli bağlantı bölümü ve ağ araması görünür", async () => {
    open("http://localhost:4000");
    expect(radio("Fabrika içi")).toHaveAttribute("aria-checked", "true");
    expect(radio("Bulut")).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByTestId("lan-tls-section")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ağda Bul/ })).toBeInTheDocument();
  });
  it("ağ adresi yazılınca şifreli LAN'a yükselir: https + 4443", async () => {
    open("http://localhost:4000");
    await userEvent.clear(host());
    await userEvent.type(host(), "192.168.1.50");
    expect(shown("https://192.168.1.50:4443")).toBeInTheDocument();
  });
  it("bulut adresi yazılırsa kaydedilmez — 'Bulut'u seçin", async () => {
    open("http://localhost:4000");
    await userEvent.clear(host());
    await userEvent.type(host(), "deneme.etkiliyazilim.com");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(FABRIKA_INTERNET_REASON);
    expect(apiConfig.setStoredApiBaseUrl).not.toHaveBeenCalled();
  });
});

describe("Bulut", () => {
  it("şifreli LAN bölümü ve ağ araması yok; https sabit; port boş ve kilitli", async () => {
    open("http://localhost:4000");
    await userEvent.click(radio("Bulut"));
    expect(radio("Bulut")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("lan-tls-section")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ağda Bul/ })).toBeNull();
    expect(screen.queryByText(/Şifreli bağlantıya geç/)).toBeNull();
    expect(screen.getByLabelText("Protokol")).toHaveValue("https");
    expect(port().value).toBe("");
    expect(port()).toHaveAttribute("readonly");
    expect(port()).toHaveAttribute("placeholder", "443");
  });
  it("kilitli porta tıklayınca açılır ve elle port yazılır", async () => {
    open("https://deneme.etkiliyazilim.com");
    port().focus();
    await userEvent.type(port(), "9", { skipClick: true });
    expect(port().value).toBe("");
    await userEvent.click(port());
    expect(port()).not.toHaveAttribute("readonly");
    await userEvent.type(port(), "8443");
    expect(shown("https://deneme.etkiliyazilim.com:8443")).toBeInTheDocument();
  });
  it("kilit simgesi de açar", async () => {
    open("https://deneme.etkiliyazilim.com");
    await userEvent.click(screen.getByRole("button", { name: "Portu elle yaz" }));
    expect(port()).not.toHaveAttribute("readonly");
  });
  it("etkiliyazilim.com dışı ad kaydedilmez — Türkçe sebep", async () => {
    open("https://deneme.etkiliyazilim.com");
    await userEvent.clear(host());
    await userEvent.type(host(), "192.168.1.50");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(BULUT_ONLY_REASON);
    expect(apiConfig.setStoredApiBaseUrl).not.toHaveBeenCalled();
  });
  it("internet adresi portsuz kaydedilir (443)", async () => {
    open("http://localhost:4000");
    await userEvent.click(radio("Bulut"));
    await userEvent.clear(host());
    await userEvent.type(host(), "deneme.etkiliyazilim.com");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(apiConfig.setStoredApiBaseUrl).toHaveBeenCalledWith("https://deneme.etkiliyazilim.com"));
  });
});

describe("kayıtlı ayarın modu", () => {
  it("kayıtlı internet adresi → Bulut seçili, port kilitli", async () => {
    open("https://deneme.etkiliyazilim.com");
    expect(radio("Bulut")).toHaveAttribute("aria-checked", "true");
    expect(port()).toHaveAttribute("readonly");
    expect(screen.queryByTestId("lan-tls-section")).toBeNull();
  });
  it("kayıtlı portlu internet adresi → Bulut, port açık ve dolu", async () => {
    open("https://deneme.etkiliyazilim.com:8443");
    expect(radio("Bulut")).toHaveAttribute("aria-checked", "true");
    expect(port().value).toBe("8443");
    expect(port()).not.toHaveAttribute("readonly");
  });
  it("kayıtlı LAN adresi → Fabrika içi", async () => {
    open("https://192.168.1.50:4443");
    expect(radio("Fabrika içi")).toHaveAttribute("aria-checked", "true");
    expect(port().value).toBe("4443");
  });
  it("tam adres yapıştırılınca mod adresten seçilir", async () => {
    open("http://localhost:4000");
    await userEvent.clear(host());
    await userEvent.click(host());
    await userEvent.paste("https://deneme.etkiliyazilim.com");
    expect(radio("Bulut")).toHaveAttribute("aria-checked", "true");
  });
});

describe("şifreli bağlantı bölümü internet adresinde kendiliğinden gizlenir", () => {
  it("bölüm tek başına çizilse de bulut adresinde 'Doğrulama kodunu göster' yok; LAN adresinde var", async () => {
    const { rerender } = render(<LanTlsSection url="https://deneme.etkiliyazilim.com" recent={[]} onAddressChanged={vi.fn()} />);
    expect(screen.queryByTestId("lan-tls-section")).toBeNull();
    rerender(<LanTlsSection url="https://192.168.1.50:4443" recent={[]} onAddressChanged={vi.fn()} />);
    expect(await screen.findByTestId("lan-tls-section")).toBeInTheDocument();
  });
});
