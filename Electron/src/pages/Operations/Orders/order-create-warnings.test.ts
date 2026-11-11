// Sipariş yaratma uyarısı (risk limiti, K3): `POST /api/orders` 201'inin `warnings`i genel sunucu notu yolundan
// (apiClient interceptor → lib/serverNotes) tost olur. Kilit: yaratma isteği `serverWarnings` bayrağıyla bu yolu
// KAPATMAZ — kapatırsa kayıt başarılı görünür, risk uyarısı sessizce kaybolur.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldToastWarnings } from "@/lib/serverNotes";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/services/apiClient", () => ({ default: { post, get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import { orderService } from "./service";

const body = { success: true, data: { id: "o1" }, warnings: ["Müşteri risk limitini aşıyor."] };

beforeEach(() => post.mockReset().mockResolvedValue({ data: body }));

describe("sipariş yaratma — sunucu uyarısı", () => {
  it.each([
    ["otomatik numara", {}],
    ["elle numara (hata tostu bastırılır, uyarı bastırılmaz)", { orderNumber: "SIP-1" }],
  ])("%s: istek uyarı yolunu kapatmaz", async (_ad, extra) => {
    const res = await orderService.create({ customerId: "c1", ...extra } as never);
    expect(res.warnings).toEqual(body.warnings);
    const [url, , config] = post.mock.calls[0] ?? [];
    expect(url).toBe("/api/orders");
    expect(config?.serverWarnings).toBeUndefined();
    expect(shouldToastWarnings({ method: "post", url, ...config }, body)).toBe(true);
  });
});
