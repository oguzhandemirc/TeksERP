import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TlsObservation } from "@shared/ipc-contract";
import type { DiscoveredServer } from "@shared/discovery";
import { HTTP_TO_PINNED_REASON, formatFingerprintGroups, parseTlsQr, type TlsPin } from "@shared/lan-tls";
import { LanTlsSection } from "@/components/settings/LanTlsSection";
import { activePinFor, httpFallbackUrl, httpSwitchBlock, planTlsSwitch, tabletQrHosts, tabletTlsQr } from "@/lib/lan-tls-ui";

/**
 * FABRİKA AĞINDA TLS — PANEL ARAYÜZÜ (docs/design/LAN-TLS.md §4, §6).
 * ⭐ Döngü adresi dışında sabitleme yalnız kullanıcı "kodlar aynı" diyince; onaysız düğme kapalı.
 * ⭐ İlan ile el sıkışma ayrışırsa sabitleme TEKLİF EDİLMEZ.
 * ⭐ Tablet QR'ı yalnız panel şifreli ve sabitliyken (QR'ın güveni panelin sabitinden gelir).
 */
vi.mock("@/lib/api-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-config")>()),
  setStoredApiBaseUrl: vi.fn(async () => undefined),
  pushRecentApiBaseUrl: vi.fn(async () => undefined),
  applyApiBaseUrl: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

const FP = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const IID = "11111111-2222-3333-4444-555555555555";
const PIN: TlsPin = { installationId: IID, fingerprint: FP, port: 4443, via: "confirmed", pinnedAt: "" };

function obs(patch: Partial<TlsObservation>): TlsObservation {
  return { host: "192.168.1.50", advert: { port: 4443, fingerprint: FP }, observedFingerprint: FP, identity: null, ...patch };
}

describe("geçiş planı", () => {
  it("LAN adresinde göz ile karşılaştırma, döngü adresinde doğrudan", () => {
    expect(planTlsSwitch(obs({}))).toEqual({ kind: "confirm", fingerprint: FP });
    expect(planTlsSwitch(obs({ host: "127.0.0.1" }))).toEqual({ kind: "loopback", fingerprint: FP });
  });
  it("ilan ile el sıkışma farklı → sabitleme teklif edilmez", () => {
    expect(planTlsSwitch(obs({ observedFingerprint: OTHER })).kind).toBe("mismatch");
  });
  it("el sıkışma yok → kullanılamaz (sunucu off)", () => {
    expect(planTlsSwitch(obs({ advert: null, observedFingerprint: null })).kind).toBe("unavailable");
    expect(planTlsSwitch(null).kind).toBe("unavailable");
  });
});

describe("etkin sabit, dönüş adresi, tablet QR'ı", () => {
  it("yalnız https + sabitli porttaki adres şifreli sayılır", () => {
    expect(activePinFor([PIN], "https://192.168.1.50:4443")).toEqual(PIN);
    expect(activePinFor([PIN], "http://192.168.1.50:4443")).toBeNull();
    expect(activePinFor([PIN], "https://192.168.1.50:9999")).toBeNull();
  });
  it("dönüş yalnız döngü adresinde: son http adresi, yoksa varsayılan port; ağ adresinde dönüş YOK", () => {
    expect(httpFallbackUrl("https://localhost:4443", ["http://10.0.0.9:4000", "http://localhost:4010"])).toBe("http://localhost:4010");
    expect(httpFallbackUrl("https://127.0.0.1:4443", [])).toBe("http://127.0.0.1:4000");
    expect(httpFallbackUrl("https://10.0.0.5:4443", ["http://10.0.0.5:4010"])).toBeNull();
  });
  it("QR yalnız sabitli şifreli panelde ve ayrıştırıcıyla gidiş-dönüş", () => {
    expect(tabletTlsQr([PIN], "http://192.168.1.50:4000")).toBeNull();
    expect(tabletTlsQr([], "https://192.168.1.50:4443")).toBeNull();
    const qr = tabletTlsQr([PIN], "https://192.168.1.50:4443");
    expect(parseTlsQr(qr!)).toEqual({ installationId: IID, advert: { port: 4443, fingerprint: FP }, hosts: [] });
  });
  it("adresli QR (v2): panelin bağlı olduğu adres; döngüde bu makinenin LAN adresleri", () => {
    expect(tabletQrHosts("https://192.168.1.50:4443", ["10.0.0.9"])).toEqual(["192.168.1.50"]);
    expect(tabletQrHosts("https://sahinsrv:4443", [])).toEqual(["sahinsrv"]);
    expect(tabletQrHosts("https://127.0.0.1:4443", ["192.168.1.50", "169.254.3.4", "100.101.1.2", "fe80::1", "10.0.0.5"])).toEqual(["192.168.1.50", "10.0.0.5"]);
    expect(tabletQrHosts("https://localhost:4443", [])).toEqual([]);
    const qr = tabletTlsQr([PIN], "https://192.168.1.50:4443", ["192.168.1.50"]);
    expect(qr!.startsWith("teks-erp-tls:2:")).toBe(true);
    expect(parseTlsQr(qr!)?.hosts).toEqual(["192.168.1.50"]);
  });
});

describe("sabitli sunucuya şifresiz geçiş (kullanıcı kararı 2026-10-07)", () => {
  const ACTIVE = "https://192.168.1.50:4443";
  function fakeApi(pins: TlsPin[], installationId: string | null) {
    const probe = vi.fn(async (): Promise<DiscoveredServer | null> =>
      installationId
        ? ({ identity: { installationId } } as unknown as DiscoveredServer)
        : null,
    );
    return { tlsPins: async () => pins, probe };
  }
  it("sabitli makine + http → engellenir, cümle kararlaştırılan", async () => {
    const block = await httpSwitchBlock(fakeApi([PIN], null), "http://192.168.1.50:4000", ACTIVE);
    expect(block?.reason).toBe("Bu sunucuya şifreli bağlanılıyor; şifresiz adrese geçmek için önce 'Şifreli bağlantıyı kaldır'");
    expect(block?.reason).toBe(HTTP_TO_PINNED_REASON);
    expect(block?.pin).toEqual(PIN);
  });
  it("başka adresteki aynı kurulum + http → engellenir", async () => {
    expect(await httpSwitchBlock(fakeApi([PIN], IID), "http://192.168.1.77:4000", ACTIVE)).not.toBeNull();
  });
  it("sabitli makine + https (aynı parmak izi) → serbest, yoklama yok", async () => {
    const api = fakeApi([PIN], IID);
    expect(await httpSwitchBlock(api, ACTIVE, ACTIVE)).toBeNull();
    expect(api.probe).not.toHaveBeenCalled();
  });
  it("başka sunucu + http → serbest", async () => {
    expect(await httpSwitchBlock(fakeApi([PIN], "99999999-2222-3333-4444-555555555555"), "http://192.168.1.60:4000", ACTIVE)).toBeNull();
    expect(await httpSwitchBlock(fakeApi([PIN], null), "http://192.168.1.60:4000", ACTIVE)).toBeNull();
  });
  it("sabit kaldırıldıktan sonra http serbest; köprü yoksa kapı yok", async () => {
    expect(await httpSwitchBlock(fakeApi([], IID), "http://192.168.1.50:4000", ACTIVE)).toBeNull();
    expect(await httpSwitchBlock(undefined, "http://192.168.1.50:4000", ACTIVE)).toBeNull();
  });
});

describe("Şifreli bağlantı bölümü", () => {
  let tlsPin: ReturnType<typeof vi.fn>;
  let tlsUnpin: ReturnType<typeof vi.fn>;
  let pins: TlsPin[];
  let observation: TlsObservation;

  beforeEach(() => {
    pins = [];
    observation = obs({});
    tlsPin = vi.fn(async () => {
      pins = [PIN];
      return { ok: true as const, baseUrl: "https://192.168.1.50:4443" };
    });
    tlsUnpin = vi.fn(async () => {
      pins = [];
    });
    (window as unknown as { api: unknown }).api = {
      discovery: {
        tlsObserve: async () => observation,
        tlsPin,
        tlsUnpin,
        tlsPins: async () => pins,
      },
    };
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("LAN adresinde kod gösterilir; 'Kodlar aynı — bağlan' ile 'confirmed' gider", async () => {
    const onChanged = vi.fn();
    render(<LanTlsSection url="http://192.168.1.50:4000" recent={[]} onAddressChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: /Doğrulama kodunu göster/ }));
    expect(await screen.findByTestId("lan-tls-observed-fp")).toHaveTextContent(formatFingerprintGroups(FP));
    expect(tlsPin).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Kodlar aynı — bağlan" }));
    await waitFor(() => expect(tlsPin).toHaveBeenCalledWith({ baseUrl: "http://192.168.1.50:4000", fingerprint: FP, via: "confirmed" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("https://192.168.1.50:4443"));
  });

  it("döngü adresinde kod karşılaştırma yok, 'loopback' gider", async () => {
    observation = obs({ host: "127.0.0.1" });
    render(<LanTlsSection url="http://127.0.0.1:4000" recent={[]} onAddressChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Doğrulama kodunu göster/ }));
    await screen.findByTestId("lan-tls-observed-fp");
    expect(screen.queryByRole("button", { name: "Kodlar aynı — bağlan" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Şifreli bağlantıya geç/ }));
    await waitFor(() => expect(tlsPin).toHaveBeenCalledWith(expect.objectContaining({ via: "loopback" })));
  });

  it("ilan ile el sıkışma farklıysa sabitleme düğmesi hiç çıkmaz", async () => {
    observation = obs({ observedFingerprint: OTHER });
    render(<LanTlsSection url="http://192.168.1.50:4000" recent={[]} onAddressChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Doğrulama kodunu göster/ }));
    expect(await screen.findByText(/araya giren/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kodlar aynı/ })).toBeNull();
    expect(tlsPin).not.toHaveBeenCalled();
  });

  it("sabitli ağ adresinde kod görünür; kaldırma onaylı ve şifresiz adrese DÖNMEZ (yeniden eşleşme)", async () => {
    pins = [PIN];
    const onChanged = vi.fn();
    render(<LanTlsSection url="https://192.168.1.50:4443" recent={["http://192.168.1.50:4000"]} onAddressChanged={onChanged} />);
    expect(await screen.findByTestId("lan-tls-active-fp")).toHaveTextContent(formatFingerprintGroups(FP));
    await userEvent.click(screen.getByRole("button", { name: "Şifreli bağlantıyı kaldır" }));
    expect(tlsUnpin).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Kaldır" }));
    await waitFor(() => expect(tlsUnpin).toHaveBeenCalledWith(IID));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("https://192.168.1.50:4443"));
    expect(onChanged).not.toHaveBeenCalledWith(expect.stringMatching(/^http:/));
  });

  it("köprü yoksa (tarayıcı derlemesi) bölüm hiç görünmez", () => {
    delete (window as unknown as { api?: unknown }).api;
    const { container } = render(<LanTlsSection url="http://x:4000" recent={[]} onAddressChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("engellenen şifresiz geçiş — bölüm", () => {
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });
  it("sabit görünür, kaldırınca yazılan http adresine geçer", async () => {
    let pins: TlsPin[] = [PIN];
    const tlsUnpin = vi.fn(async () => {
      pins = [];
    });
    (window as unknown as { api: unknown }).api = {
      discovery: { tlsObserve: async () => null, tlsPin: vi.fn(), tlsUnpin, tlsPins: async () => pins },
    };
    const onChanged = vi.fn();
    render(
      <LanTlsSection
        url="http://192.168.1.77:4000"
        recent={[]}
        onAddressChanged={onChanged}
        blocked={{ pin: PIN, url: "http://192.168.1.77:4000" }}
      />,
    );
    expect(await screen.findByTestId("lan-tls-active-fp")).toHaveTextContent(formatFingerprintGroups(FP));
    await userEvent.click(screen.getByRole("button", { name: "Şifreli bağlantıyı kaldır" }));
    await userEvent.click(await screen.findByRole("button", { name: "Kaldır" }));
    await waitFor(() => expect(tlsUnpin).toHaveBeenCalledWith(IID));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("http://192.168.1.77:4000"));
  });
});
