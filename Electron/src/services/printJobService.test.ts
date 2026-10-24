import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/services/apiClient";
import {
  REPORT_RETRY_DELAYS_MS,
  buildReportBody,
  reportPrintJob,
  resetPrintJobCapabilityForTest,
  type PrintJobReport,
} from "@/services/printJobService";
import { printIdentityCards, printTracked, reportLabelSend } from "@/lib/print";

// =============================================================================
// YAZDIRMA GEÇMİŞİ RAPORU (izlenebilirlik A2) — sözleşme bekçisi.
// - Rapor tek mantıksal deneme: token bir kez doğar, YALNIZ belirsiz hatada (ağ/5xx) aynı
//   token'la yeniden gider; kesin 4xx'te yeniden denenmez (kk1.md İstemci token'ı).
// - 404 = eski backend: sessiz, hatırlanır, sonraki raporlar istek atmaz.
// - Her rapor `suppressErrorToast` taşır: geçmiş kaydı düşse de basım "başarısız" görünmez.
// - Web → BELIRSIZ; Electron iptal → IPTAL; etiket hatası → HATA + sınıflı kod.
// - Kimlik kartı yükünde içerik yok. Sonda (2026-10-24): REPORT_KEYS'e "html" eklendi →
//   "bilinmeyen anahtar düşer" testi kırmızı; geri alındı → yeşil.
// =============================================================================

vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const httpError = (status?: number) => Object.assign(new Error("x"), status ? { response: { status } } : {});
const REPORT: PrintJobReport = { subjectKind: "BELGE", status: "ILETILDI", outputKind: "PRINTER" };

type WinApi = { api?: unknown };
const setApi = (api: unknown) => {
  (window as unknown as WinApi).api = api;
};

/** Boğaz raporu beklemeden bırakır; mikro görevleri boşalt. */
const flush = () => new Promise((r) => setTimeout(r, 0));
const reportBodies = () =>
  mockPost.mock.calls.filter((c) => c[0] === "/api/print-jobs").map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  resetPrintJobCapabilityForTest();
  mockPost.mockResolvedValue({ data: { success: true } });
});
afterEach(() => {
  setApi(undefined);
  vi.useRealTimers();
});

describe("reportPrintJob — token ve yeniden deneme", () => {
  it("belirsiz hatada (5xx, ağ) AYNI token'la yeniden dener", async () => {
    vi.useFakeTimers();
    mockPost.mockRejectedValueOnce(httpError(503)).mockRejectedValueOnce(httpError()).mockResolvedValueOnce({ data: {} });
    let n = 0;
    const p = reportPrintJob(REPORT, () => `tok-${++n}`);
    for (const d of REPORT_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(d);
    await expect(p).resolves.toBe("YAZILDI");
    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(reportBodies().map((b) => b.clientToken)).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(n).toBe(1);
  });

  it("kesin 4xx'te yeniden denemez", async () => {
    mockPost.mockRejectedValueOnce(httpError(400));
    await expect(reportPrintJob(REPORT, () => "t")).resolves.toBe("REDDEDILDI");
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("404 (eski backend) sessiz: hatırlanır, sonraki rapor istek atmaz", async () => {
    mockPost.mockRejectedValueOnce(httpError(404));
    await expect(reportPrintJob(REPORT)).resolves.toBe("DESTEKLENMIYOR");
    await expect(reportPrintJob(REPORT)).resolves.toBe("DESTEKLENMIYOR");
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("her rapor suppressErrorToast taşır", async () => {
    await reportPrintJob(REPORT);
    expect(mockPost.mock.calls[0]?.[2]).toMatchObject({ suppressErrorToast: true });
  });

  it("bilinmeyen anahtar (ör. html) gövdeye girmez", () => {
    const body = buildReportBody({ ...REPORT, html: "<b>PIN 1234</b>" } as unknown as PrintJobReport, "t");
    expect(body).not.toHaveProperty("html");
    expect(JSON.stringify(body)).not.toContain("1234");
  });
});

describe("printTracked — sonuç durumu", () => {
  it("web (window.api yok) → BELIRSIZ, sistem penceresi", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const out = await printTracked({ subject: { kind: "BELGE" }, html: "<p>x</p>" });
    await flush();
    expect(out.status).toBe("BELIRSIZ");
    expect(out.proceed).toBe(true);
    const [body] = reportBodies();
    expect(body).toMatchObject({ status: "BELIRSIZ", transport: "SISTEM_PENCERESI", source: "PANEL_WEB" });
    printSpy.mockRestore();
  });

  it("Electron'da pencere iptal → IPTAL, iş ucu çağrılmaz (proceed=false) ama geçmişe yazılır", async () => {
    const print = vi.fn().mockResolvedValue({ status: "IPTAL", durationMs: 7 });
    setApi({ docPrint: { print, printers: vi.fn() } });
    const out = await printTracked({ subject: { kind: "REFAKAT_KARTI", id: "c1" }, html: "<p>x</p>", workEndpoint: true });
    await flush();
    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0]?.[0]).toMatchObject({ silent: false });
    expect(out).toMatchObject({ status: "IPTAL", proceed: false });
    expect(reportBodies()[0]).toMatchObject({ status: "IPTAL", subjectKind: "REFAKAT_KARTI" });
  });

  it("Electron'da başarı + iş ucu → /print-jobs ÇAĞRILMAZ (çift satır yok), künye döner", async () => {
    setApi({ docPrint: { print: vi.fn().mockResolvedValue({ status: "ILETILDI", durationMs: 3 }), printers: vi.fn() } });
    const out = await printTracked({ subject: { kind: "REFAKAT_KARTI", id: "c1" }, html: "<p>x</p>", workEndpoint: true });
    await flush();
    expect(out.proceed).toBe(true);
    expect(out.printJob).toMatchObject({ transport: "SISTEM_PENCERESI", durationMs: 3 });
    expect(reportBodies()).toHaveLength(0);
  });
});

describe("reportLabelSend — etiket hatası", () => {
  it("kapalı TCP yazıcı → HATA + YAZICI_BAGLANTI_REDDI + Türkçe mesaj; adres taşınır", async () => {
    const r = reportLabelSend(
      { kind: "ETIKET_TOP", table: "rolls", id: "r1" },
      { transport: "tcp", address: "10.0.0.9:9100" },
      { ok: false, error: "connect ECONNREFUSED 10.0.0.9:9100" },
      { workEndpoint: true },
    );
    await flush();
    expect(r.errorCode).toBe("YAZICI_BAGLANTI_REDDI");
    const [body] = reportBodies();
    expect(body).toMatchObject({ status: "HATA", errorCode: "YAZICI_BAGLANTI_REDDI", transport: "TCP_9100", printerAddress: "10.0.0.9:9100" });
    expect(String(body?.errorMessage)).not.toContain("ECONNREFUSED");
  });
});

describe("kimlik kartı — içerik gönderilmez", () => {
  it("yük yalnız kullanıcı kimliği taşır; kâğıttaki PIN gövdeye girmez", async () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    const root = document.createElement("div");
    root.textContent = "PIN 987654";
    document.body.appendChild(root);
    await printIdentityCards(root, ["u1"]);
    await flush();
    const [body] = reportBodies();
    expect(body).toMatchObject({ subjectKind: "KIMLIK_KARTI", subjectTable: "users", subjectId: "u1" });
    expect(JSON.stringify(body)).not.toContain("987654");
    root.remove();
  });
});
