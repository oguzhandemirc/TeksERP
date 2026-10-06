import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...a) } }));
const { useAuthStore } = await import("@/store/auth");
const { useTabsStore } = await import("@/store/tabs");
const { CLIENT_ERROR_ENDPOINT, CLIENT_REPORTS_PER_MINUTE, buildClientErrorBody, reportClientError, resetClientErrorReportingForTest } = await import("./error-report");

const GIZLI = "Ahmet Yılmaz siparişi 3f2b8c1e okunamadı";
const hata = (): Error => {
  const e = new TypeError(GIZLI);
  e.stack = `TypeError: ${GIZLI}\n    at Sevkiyat (http://localhost:5174/src/pages/Shipping/List.tsx:42:7)`;
  return e;
};
const IZINLI = new Set(["kaynak", "sinif", "bilesen", "yol", "yigin"]);

describe("panel hata raporu", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { success: true, data: { alindi: true } } });
    resetClientErrorReportingForTest();
    useAuthStore.setState({ user: { userId: "u1", permissions: [] } as never });
    useTabsStore.setState({ tabs: [{ id: "t1", path: "/sevkiyat/3f2b8c1e-9d4a-4e6b-8a1c-2f5e7d9b0a13?q=ahmet", title: "Sevkiyat" }] as never, activeId: "t1" });
  });

  it("gövde yalnız allowlist alanlarını taşır; MESAJ metni hiçbir alanda yok", () => {
    const b = buildClientErrorBody(hata(), "/sevkiyat/x?musteri=ahmet", "ekran");
    expect(Object.keys(b).every((k) => IZINLI.has(k))).toBe(true);
    expect(JSON.stringify(b)).not.toContain("Ahmet");
    expect(JSON.stringify(b)).not.toContain("okunamadı");
    expect(b.yol).toBe("/sevkiyat/x");
    expect(b.sinif).toBe("TypeError");
    expect(b.yigin).toContain("List.tsx:42");
  });

  it("oturumlu kullanıcıda uca gider, gövdede mesaj yok, toast bastırılır", () => {
    reportClientError(hata(), "ekran");
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = post.mock.calls[0] as [string, Record<string, unknown>, { suppressErrorToast?: boolean }];
    expect(url).toBe(CLIENT_ERROR_ENDPOINT);
    expect(JSON.stringify(body)).not.toContain("Ahmet");
    expect(Object.keys(body).every((k) => IZINLI.has(k))).toBe(true);
    expect(body["yol"]).toBe("/sevkiyat/3f2b8c1e-9d4a-4e6b-8a1c-2f5e7d9b0a13");
    expect(cfg.suppressErrorToast).toBe(true);
  });

  it("oturum yoksa hiç istek atılmaz", () => {
    useAuthStore.setState({ user: null });
    reportClientError(hata());
    expect(post).not.toHaveBeenCalled();
  });

  it("dakikalık hız sınırı; bildirim hatası yutulur", async () => {
    post.mockRejectedValue(new Error("ağ yok"));
    for (let i = 0; i < CLIENT_REPORTS_PER_MINUTE + 5; i++) {
      reportClientError(hata(), undefined, 1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(post).toHaveBeenCalledTimes(CLIENT_REPORTS_PER_MINUTE);
    reportClientError(hata(), undefined, 70_000);
    expect(post).toHaveBeenCalledTimes(CLIENT_REPORTS_PER_MINUTE + 1);
  });
});
