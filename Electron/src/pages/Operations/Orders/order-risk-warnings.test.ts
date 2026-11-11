// SY-3 risk uyarısı: teklif→sipariş dönüşümü ve sipariş güncellemesi yanıtındaki `warnings` genel sunucu notu
// yolundan (apiClient interceptor → lib/serverNotes) tost olur. Kilit: iki istek de `serverWarnings` bayrağıyla
// bu yolu KAPATMAZ — kapatırsa işlem başarılı görünür, risk uyarısı sessizce kaybolur.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldToastWarnings } from "@/lib/serverNotes";

const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
vi.mock("@/services/apiClient", () => ({ default: { post, patch, get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { orderService } from "./service";
import { quoteService } from "@/pages/Cost/Quotes/service";

const body = { success: true, data: { id: "o1", orderId: "o1" }, warnings: ["Müşteri risk limitini aşıyor."] };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: body });
  patch.mockReset().mockResolvedValue({ data: body });
});

describe("sipariş risk uyarısı — sunucu notu yolu açık", () => {
  it("teklif→sipariş dönüşümü (hata tostu bastırılır, uyarı bastırılmaz)", async () => {
    const res = await quoteService.convert("q1", "tok-1", []);
    expect(res.warnings).toEqual(body.warnings);
    const [url, , config] = post.mock.calls[0] ?? [];
    expect(url).toBe("/api/quotes/q1/convert");
    expect(config?.serverWarnings).toBeUndefined();
    expect(shouldToastWarnings({ method: "post", url, ...config }, body)).toBe(true);
  });

  it("sipariş güncellemesi", async () => {
    const res = await orderService.update("o1", { notes: "x" } as never);
    expect(res.warnings).toEqual(body.warnings);
    const [url, , config] = patch.mock.calls[0] ?? [];
    expect(url).toBe("/api/orders/o1");
    expect(config?.serverWarnings).toBeUndefined();
    expect(shouldToastWarnings({ method: "patch", url, ...config }, body)).toBe(true);
  });
});
