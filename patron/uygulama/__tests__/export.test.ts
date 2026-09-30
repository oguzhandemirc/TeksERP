// Dışa aktarma (Ek-6/A §4.2): indirme istemcisi (ham bayt + dosya adı; hata zarfı aynı `details.code` okuması),
// dosya adı süzgeci (yol ayırıcı sızmaz) ve web'e özgü kaydetme (telefon uygulamasında dosya kaydı YOK).
import { ApiError, attachmentName, createClient } from "../src/api/client";
import { createApi } from "../src/api/endpoints";
import { canSaveFiles, saveDownloadedFile, type BrowserLike } from "../src/lib/export-file";

function fileFetch(status: number, body: string, headers: Record<string, string>, calls: string[] = []) {
  return (async (url: string) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
      json: async () => JSON.parse(body) as unknown,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("dışa aktarma indirmesi", () => {
  it("başarı: ham bayt + Content-Disposition adı; yol ve biçim sorgusu doğru", async () => {
    const calls: string[] = [];
    const c = createClient({ baseUrl: "https://b.test", getToken: () => "t", fetchImpl: fileFetch(200, "id,ad\r\n", { "content-disposition": 'attachment; filename="patron-x-siparis.csv"', "content-type": "text/csv" }, calls) });
    const f = await createApi(c).exportDownload("ozet.siparis", "csv");
    expect(calls[0]).toBe("https://b.test/api/disa-aktar/ozet.siparis?bicim=csv");
    expect(f.fileName).toBe("patron-x-siparis.csv");
    expect(new TextDecoder().decode(f.data)).toBe("id,ad\r\n");
  });
  it("hata zarfı: kod details.code'tan (403 YETKISIZ)", async () => {
    const c = createClient({ baseUrl: "https://b.test", getToken: () => "t", fetchImpl: fileFetch(403, JSON.stringify({ success: false, message: "Yok", details: { code: "YETKISIZ" } }), {}) });
    await expect(createApi(c).exportDownload("siparis", "json")).rejects.toMatchObject({ code: "YETKISIZ", status: 403 });
    await expect(createApi(c).exportDownload("siparis", "json")).rejects.toBeInstanceOf(ApiError);
  });
  it("dosya adı yol ayırıcı ve tırnak taşıyamaz; yoksa yedek ad", () => {
    expect(attachmentName('attachment; filename="a/../b.csv"', "yedek")).toBe("yedek");
    expect(attachmentName(null, "yedek")).toBe("yedek");
    expect(attachmentName('attachment; filename="patron-1.json"', "yedek")).toBe("patron-1.json");
  });
});

describe("dosya kaydetme yalnız web", () => {
  const file = { fileName: "x.csv", contentType: "text/csv", data: new TextEncoder().encode("a").buffer };
  it("telefon uygulamasında kaydetmez (false)", () => {
    expect(canSaveFiles("ios", undefined)).toBe(false);
    expect(saveDownloadedFile(file, "android", undefined)).toBe(false);
  });
  it("web'de geçici bağlantıyla indirir", () => {
    jest.useFakeTimers();
    const clicked: { download: string; href: string }[] = [];
    const revoke = jest.fn();
    const w: BrowserLike = {
      document: {
        createElement: () => {
          const a = { href: "", download: "", rel: "", click: () => clicked.push({ download: a.download, href: a.href }), remove: () => undefined };
          return a;
        },
        body: { appendChild: () => undefined },
      },
      URL: { createObjectURL: () => "blob:1", revokeObjectURL: revoke },
    };
    expect(saveDownloadedFile(file, "web", w)).toBe(true);
    expect(clicked).toEqual([{ download: "x.csv", href: "blob:1" }]);
    jest.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:1");
    jest.useRealTimers();
  });
});
