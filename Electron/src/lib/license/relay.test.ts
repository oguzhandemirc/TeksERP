import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LicenseDetail } from "@/types/license";

const relayRequest = vi.fn();
const relayResponse = vi.fn();
vi.mock("@/services/licenseService", () => ({
  licenseService: {
    relayRequest: (...a: unknown[]) => relayRequest(...a),
    relayResponse: (...a: unknown[]) => relayResponse(...a),
  },
}));
const { shouldAutoRelay, relayViaPanel } = await import("./relay");

type Slice = Pick<LicenseDetail, "kurulum" | "yoklama" | "tasima">;
function detail(y: Partial<LicenseDetail["yoklama"]>, over: Partial<Slice> = {}): Slice {
  return {
    kurulum: { kurulumId: "k", anahtarKimligi: "a", etkin: true, ilkAcilis: null },
    tasima: null,
    yoklama: {
      saticiYapilandirildi: true,
      saticiAdresi: "lisans.example.com",
      sonDeneme: null,
      sonBasari: null,
      sonBasarisizlik: null,
      sonHataKodu: null,
      sonrakiDeneme: null,
      zil: { bagli: false, sonBaglanti: null, sonZil: null, sonKalpAtisi: null, sonHataKodu: null },
      ...y,
    },
    ...over,
  };
}

/**
 * OTOMATİK AKTARMA KARARI — backend adlı bir "dışarı çıkamıyor" alanı taşımıyor;
 * karar yalnız `detay.yoklama`dan okunur ve TEK yüklemde yaşar.
 */
describe("shouldAutoRelay", () => {
  const eski = "2026-09-29T08:00:00.000Z";
  const yeni = "2026-09-29T09:00:00.000Z";

  it("⭐ son deneme AĞDA düştü ve sonra başarı yok → aktar", () => {
    expect(shouldAutoRelay(detail({ sonHataKodu: "EGRESS_NETWORK", sonBasarisizlik: yeni, sonBasari: eski }))).toBe(true);
    expect(shouldAutoRelay(detail({ sonHataKodu: "EGRESS_TIMEOUT", sonBasarisizlik: yeni }))).toBe(true);
  });

  it("başarı hatadan yeni → aktarma yok", () => {
    expect(shouldAutoRelay(detail({ sonHataKodu: "EGRESS_NETWORK", sonBasarisizlik: eski, sonBasari: yeni }))).toBe(false);
  });

  it("satıcı cevap verip reddettiyse (ağ hatası değil) → aktarma yok", () => {
    expect(shouldAutoRelay(detail({ sonHataKodu: "KIRA_YENILENMEDI", sonBasarisizlik: yeni }))).toBe(false);
    expect(shouldAutoRelay(detail({ sonHataKodu: "HTTP_500", sonBasarisizlik: yeni }))).toBe(false);
  });

  it("etkin değil / satıcı adresi yok / bekleyen taşıma → aktarma yok", () => {
    const hata = { sonHataKodu: "EGRESS_NETWORK", sonBasarisizlik: yeni };
    expect(shouldAutoRelay(detail(hata, { kurulum: { kurulumId: "k", anahtarKimligi: "a", etkin: false, ilkAcilis: null } }))).toBe(false);
    expect(shouldAutoRelay(detail({ ...hata, saticiYapilandirildi: false }))).toBe(false);
    expect(shouldAutoRelay(detail(hata, { tasima: { talepId: "t", istendi: eski, gerekce: null } }))).toBe(false);
  });
});

describe("relayViaPanel", () => {
  const relay = vi.fn();
  beforeEach(() => {
    relayRequest.mockReset();
    relayResponse.mockReset();
    relay.mockReset();
    (window as unknown as { api: unknown }).api = { license: { relay } };
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  const req = { hedefUrl: "https://lisans.example.com/v1/cevrimdisi", istekGovdesi: { v: 1, zarf: "abc" } };

  it("⭐ imzalı isteği AYNEN taşır, satıcı yanıtını AYNEN backend'e verir", async () => {
    relayRequest.mockResolvedValue(req);
    relay.mockResolvedValue({ ok: true, status: 200, yanit: { kira: "k" } });
    relayResponse.mockResolvedValue({ hazir: true });
    const r = await relayViaPanel("yokla");
    expect(r.ok).toBe(true);
    expect(relay).toHaveBeenCalledWith({ hedefUrl: req.hedefUrl, istekGovdesi: req.istekGovdesi });
    expect(relayResponse).toHaveBeenCalledWith({ kira: "k" });
  });

  it("satıcı reddi backend'e GİTMEZ; satıcının cümlesi döner", async () => {
    relayRequest.mockResolvedValue(req);
    relay.mockResolvedValue({ ok: true, status: 409, yanit: { success: false, message: "Kod kullanılmış.", details: { code: "X" } } });
    expect(await relayViaPanel("etkinlestir", "TKS-1")).toEqual({ ok: false, message: "Kod kullanılmış." });
    expect(relayRequest).toHaveBeenCalledWith("etkinlestir", "TKS-1");
    expect(relayResponse).not.toHaveBeenCalled();
  });

  it("satıcı adresi yoksa köprü çağrılmaz; köprü yoksa (web) istek bile kurulmaz", async () => {
    relayRequest.mockResolvedValue({ ...req, hedefUrl: null });
    expect((await relayViaPanel("yokla")).ok).toBe(false);
    expect(relay).not.toHaveBeenCalled();
    delete (window as unknown as { api?: unknown }).api;
    relayRequest.mockClear();
    expect((await relayViaPanel("yokla")).ok).toBe(false);
    expect(relayRequest).not.toHaveBeenCalled();
  });
});
