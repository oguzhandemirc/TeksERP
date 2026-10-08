import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseTlsQr, type TlsPin } from "@shared/lan-tls";
import { TabletTlsQrButton } from "@/pages/Devices/TabletTlsQrButton";

/**
 * Tablet için şifreli bağlantı QR'ı: varsayılan kod sunucu adresini taşır (v2); adres alanını bilmeyen eski
 * tablet için adressiz kod (v1) aynı pencereden açılır.
 */
let active = "https://192.168.1.50:4443";
vi.mock("@/lib/api-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-config")>()),
  getActiveApiBaseUrl: () => active,
}));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="tablet-tls-qr" data-value={value} />,
}));

const FP = "ab".repeat(32);
const IID = "11111111-2222-3333-4444-555555555555";
const PIN: TlsPin = { installationId: IID, fingerprint: FP, port: 4443, via: "confirmed", pinnedAt: "" };

function setApi(lanHosts?: () => Promise<string[]>) {
  (window as unknown as { api: unknown }).api = { discovery: { tlsPins: async () => [PIN], ...(lanHosts ? { lanHosts } : {}) } };
}

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  active = "https://192.168.1.50:4443";
});

async function openDialog() {
  await userEvent.click(await screen.findByRole("button", { name: /Tablet için şifreli bağlantı/ }));
  return () => screen.getByTestId("tablet-tls-qr").getAttribute("data-value") ?? "";
}

describe("TabletTlsQrButton", () => {
  it("varsayılan kod panelin bağlı olduğu adresi taşır; eski tablet için adressiz koda geçilir", async () => {
    setApi(async () => ["10.0.0.9"]);
    render(<TabletTlsQrButton />);
    const value = await openDialog();
    expect(parseTlsQr(value())).toEqual({ installationId: IID, advert: { port: 4443, fingerprint: FP }, hosts: ["192.168.1.50"] });
    expect(screen.getByTestId("tablet-tls-qr-hosts").textContent).toContain("192.168.1.50");
    await userEvent.click(screen.getByRole("button", { name: /eski sürüm/ }));
    expect(value()).toBe(`teks-erp-tls:1:${IID}:${FP}:4443`);
    await userEvent.click(screen.getByRole("button", { name: /Adresli koda dön/ }));
    expect(parseTlsQr(value())?.hosts).toEqual(["192.168.1.50"]);
  });

  it("panel sunucunun kendisindeyse bu makinenin LAN adresleri girer", async () => {
    active = "https://127.0.0.1:4443";
    setApi(async () => ["192.168.1.50", "169.254.1.1"]);
    render(<TabletTlsQrButton />);
    const value = await openDialog();
    expect(parseTlsQr(value())?.hosts).toEqual(["192.168.1.50"]);
  });

  it("adres bilinmiyorsa (eski ana süreç, döngü + LAN yok) yalnız bugünkü v1 kodu, geçiş düğmesi yok", async () => {
    active = "https://127.0.0.1:4443";
    setApi();
    render(<TabletTlsQrButton />);
    const value = await openDialog();
    expect(value()).toBe(`teks-erp-tls:1:${IID}:${FP}:4443`);
    expect(screen.queryByRole("button", { name: /eski sürüm/ })).toBeNull();
    expect(screen.queryByTestId("tablet-tls-qr-hosts")).toBeNull();
  });
});
