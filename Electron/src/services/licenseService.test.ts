import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.fn();
const get = vi.fn();
vi.mock("./apiClient", () => ({ default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));
const { licenseService } = await import("./licenseService");

const REQ = { amac: "etkinlestir", zarf: "z", gecerlilikSonu: "", hedefYol: "/v1/cevrimdisi", hedefUrl: null, istekGovdesi: { v: 1, zarf: "z" }, qrAdresi: null };
const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
const missing = () => Promise.reject(Object.assign(new Error("404"), { response: { status: 404 } }));

/**
 * D12: etkinleştirme KODU taşıyan istek zarfı GÖVDEYLE gider (kod URL'ye → erişim günlüğüne girmez).
 * POST ucu olmayan eski backend (404) için bir kez eski GET yoluna düşülür; başka hata aynen döner.
 */
describe("licenseService — kod taşıyan çağrılar", () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
  });

  it.each([
    ["offlineRequest", "cevrimdisi-istek"],
    ["relayRequest", "aktarma-istegi"],
  ] as const)("⭐ %s: POST gövdesi {amac, kod}; URL'de kod YOK", async (fn, path) => {
    post.mockReturnValue(ok(REQ));
    await licenseService[fn]("etkinlestir", "TKS-AAAA-BBBB-CCCC-DDDD");
    expect(get).not.toHaveBeenCalled();
    const [url, body] = post.mock.calls[0] as [string, unknown];
    expect(url).toBe(`/api/license/${path}`);
    expect(url).not.toContain("TKS-");
    expect(body).toEqual({ amac: "etkinlestir", kod: "TKS-AAAA-BBBB-CCCC-DDDD" });
  });

  it("kodsuz yenilemede gövde yalnız {amac}", async () => {
    post.mockReturnValue(ok(REQ));
    await licenseService.offlineRequest("yokla");
    expect(post.mock.calls[0]?.[1]).toEqual({ amac: "yokla" });
  });

  it("eski backend (POST yok → 404) → bir kez GET; başka hata GET'e DÜŞMEZ", async () => {
    post.mockReturnValueOnce(missing());
    get.mockReturnValueOnce(ok(REQ));
    await expect(licenseService.relayRequest("yokla")).resolves.toEqual(REQ);
    expect(get).toHaveBeenCalledTimes(1);
    post.mockReturnValueOnce(Promise.reject(Object.assign(new Error("409"), { response: { status: 409 } })));
    await expect(licenseService.relayRequest("yokla")).rejects.toThrow("409");
    expect(get).toHaveBeenCalledTimes(1);
  });
});
