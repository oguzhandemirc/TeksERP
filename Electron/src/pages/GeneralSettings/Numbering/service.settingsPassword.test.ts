// BEKÇİ — numaralandırma kaydı AYAR ŞİFRESİ bağlantısı (2026-09-23): üç yazma ucu backend'de
// `requireSettingsPassword` taşır; `apiClient` o 403'ün toast'ını bastırdığı için sarmalayıcısız çağrı
// "Kaydet hiçbir şey yapmıyor" olur. Ölçülen: 403 REQUIRED → diyalog (sorucu) açılır → AYNI yük başlıkla
// tekrar gider. Önizleme/etki/tükenme şifresiz kalır (her tuşta pencere açılmasın).
// Negatif sonda: `updateCounter`dan `withSettingsPassword` kaldırıldı → ⭐ sayaç ×.
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const patch = vi.fn();
const post = vi.fn(async () => ({ data: { data: { preview: "P-1" } } }));
vi.mock("@/services/apiClient", () => ({ default: { patch: (...a: unknown[]) => patch(...a), post: (...a: unknown[]) => post(...(a as [])), get: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { registerSettingsPasswordAsker, SETTINGS_PASSWORD_HEADER } from "@/lib/settings-password";
import { numberingService } from "./service";

function gerekli(): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError("403", "ERR_BAD_REQUEST", { headers }, null, {
    status: 403, statusText: "Forbidden", headers: {}, config: { headers },
    data: { success: false, message: "Ayar şifresi gerekli", details: { code: "SETTINGS_PASSWORD_REQUIRED" } },
  });
}
const sorucu = vi.fn(async () => "gizli-sifre");

beforeEach(() => {
  patch.mockReset();
  post.mockClear();
  sorucu.mockClear();
  registerSettingsPasswordAsker(sorucu);
  // İlk deneme şifresiz → 403 REQUIRED; başlıklı tekrar → 200.
  patch.mockImplementation(async (_url: string, _body: unknown, cfg?: { headers?: Record<string, string> }) => {
    if (!cfg?.headers?.[SETTINGS_PASSWORD_HEADER]) throw gerekli();
    return { data: { success: true } };
  });
});

const ikiCagri = () => {
  expect(sorucu).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledTimes(2);
  const calls = patch.mock.calls as Array<[string, unknown, { headers?: Record<string, string> }?]>;
  const [url1, body1] = calls[0]!;
  const [url2, body2, cfg2] = calls[1]!;
  expect(url2).toBe(url1);
  expect(body2).toEqual(body1);
  expect(cfg2?.headers?.[SETTINGS_PASSWORD_HEADER]).toBe("gizli-sifre");
};

describe("numaralandırma yazma uçları ayar şifresinden geçer", () => {
  it("⭐ biçim (PATCH /:key): 403 → diyalog → aynı yük şifreyle", async () => {
    await numberingService.update("SHIPMENT", { prefix: "S", dateSegment: "YYMM", digits: 4, separator: "-" } as never, "2026-10-01");
    ikiCagri();
  });
  it("⭐ sayaç (PATCH /:key/counter): 403 → diyalog → aynı yük şifreyle", async () => {
    await numberingService.updateCounter("SHIPMENT", { startValue: 100, step: 1, maxValue: null });
    ikiCagri();
  });
  it("⭐ kaynak (PATCH /:key/source): 403 → diyalog → aynı yük şifreyle", async () => {
    await numberingService.updateSource("SHIPMENT", "FREE");
    ikiCagri();
  });
  it("önizleme şifresiz kalır — sorucu açılmaz", async () => {
    await numberingService.preview("SHIPMENT", {} as never);
    expect(sorucu).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
