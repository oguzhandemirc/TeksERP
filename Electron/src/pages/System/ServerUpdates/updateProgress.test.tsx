import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderWithProviders } from "@/test/render";
import type { UpdateHistoryItem, UpdateStatus } from "@/types/server-update";
import { estimateSeconds, nextProgress, phaseOfStep, type ProgressState } from "./updateProgress";

const status = vi.fn();
vi.mock("@/services/serverUpdateService", () => ({ serverUpdateService: { status: () => status(), approve: vi.fn() } }));
const perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("@/hooks/useLicenseStatus", () => ({ useLicenseStatus: () => ({ kademe: "NORMAL", lisansNo: "L-1" }) }));
const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));
const { UpdateProgressWindow } = await import("./UpdateProgressWindow");
const { ServerUpdateSection } = await import("./ServerUpdateSection");

const base = (p: Partial<UpdateStatus> = {}): UpdateStatus => ({
  kuruluSurum: "2.12.0",
  kanal: "demofabrika",
  politika: { kip: "ONAYLI", pencere: null, hedefSurum: null, kaynak: "KIRA" },
  donuk: false,
  sonrakiPencere: null,
  indirmeBelirteci: true,
  guncelleyici: { durum: "CALISIYOR", surum: "0.1.0" },
  bekleyen: { surum: "2.13.0", karar: "KUR", neden: null, zorunlu: false, ozet: "Not metni", aralik: null, pgGuncellemesi: false },
  son: null,
  yerel: { durum: "HAZIR", surum: "2.13.0", kuruluSurum: "2.12.0", urun: null, adim: null, hataKodu: null, mesaj: null, ilerleme: null, planlanan: null, zaman: null, sonAyrinti: null },
  gecmis: [],
  karar: null,
  canlilik: { sonCanlilik: "2026-10-06T10:00:00.000Z", esikSn: 180, gecikmeSn: 5, yanitVermiyor: false },
  onay: null,
  eylemler: { hemen: false, pencere: false, geriAl: false, hedefSurum: null, neden: null },
  ...p,
});
const uygulaniyor = (adim: string | null, p: Partial<UpdateStatus> = {}): UpdateStatus =>
  base({ yerel: { ...base().yerel!, durum: "UYGULANIYOR", urun: "backend", adim }, ...p });
const son = (sonuc: "BASARILI" | "GERI_DONDU" | "BASARISIZ", hedefSurum = "2.13.0") => ({ kayitId: "k", hedefSurum, kaynakSurum: "2.12.0", sonuc, kod: null, baslangic: "2026-10-06T10:00:00.000Z", bitis: "2026-10-06T10:03:00.000Z", veriGeriYuklendi: false });
function mount(ui: ReactElement): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return qc;
}
const run: ProgressState = { kind: "running", version: "2.13.0", adim: "YEDEK", startedAt: 1000, unreachable: false };

describe("canlı güncelleme — durum makinesi (saf)", () => {
  it("adım → aşama; geri alma işaretlenir; tanınmayan adım aşamasız", () => {
    expect(phaseOfStep("YEDEK")).toEqual({ phase: "YEDEK", rollback: false });
    expect(phaseOfStep("GOC").phase).toBe("VERITABANI");
    expect(phaseOfStep("DOGRULAMA").phase).toBe("DENEME");
    expect(phaseOfStep("GERI_DON:GECIS")).toEqual({ phase: "VERITABANI", rollback: true });
    expect(phaseOfStep("YENI_ADIM").phase).toBeNull();
    expect(phaseOfStep(null).phase).toBeNull();
  });
  it("UYGULANIYOR → çalışıyor (başlangıç zamanı aynı sürümde korunur)", () => {
    const a = nextProgress({ kind: "idle" }, { status: uygulaniyor("YEDEK"), unreachable: false, now: 1000 });
    expect(a).toMatchObject({ kind: "running", version: "2.13.0", adim: "YEDEK", startedAt: 1000 });
    expect(nextProgress(a, { status: uygulaniyor("GOC"), unreachable: false, now: 9000 })).toMatchObject({ adim: "GOC", startedAt: 1000 });
  });
  it("negatif: boştayken HAZIR/BEKLIYOR → pencere AÇILMAZ; indirme (backend açık) pencere açmaz", () => {
    expect(nextProgress({ kind: "idle" }, { status: base(), unreachable: false, now: 1 })).toEqual({ kind: "idle" });
    const indiriliyor = base({ yerel: { ...base().yerel!, durum: "INDIRILIYOR" } });
    expect(nextProgress({ kind: "idle" }, { status: indiriliyor, unreachable: false, now: 1 })).toEqual({ kind: "idle" });
  });
  it("sunucu kapanınca (ulaşılamaz) pencere AÇIK kalır; okunamayan ama 'ulaşılamaz' olmayan tur durumu değiştirmez", () => {
    expect(nextProgress(run, { status: undefined, unreachable: true, now: 5 })).toMatchObject({ kind: "running", unreachable: true });
    expect(nextProgress(run, { status: undefined, unreachable: false, now: 5 })).toBe(run);
  });
  it("sonuç: son BASARILI → başarılı · GERI_DONDU → geri alındı · HATA → başarısız · son yoksa kurulu sürümden", () => {
    const o = (s: UpdateStatus) => (nextProgress(run, { status: s, unreachable: false, now: 9 }) as { outcome: string }).outcome;
    expect(o(base({ kuruluSurum: "2.13.0", son: son("BASARILI") }))).toBe("BASARILI");
    expect(o(base({ son: son("GERI_DONDU") }))).toBe("GERI_DONDU");
    expect(o(base({ yerel: { ...base().yerel!, durum: "HATA" } }))).toBe("BASARISIZ");
    expect(o(base({ kuruluSurum: "2.13.0" }))).toBe("BASARILI");
    expect(o(base())).toBe("GERI_DONDU");
    // başka sürümün eski sonucu bu işlemi BAŞARILI yapmaz
    expect(o(base({ son: son("BASARILI", "2.11.0") }))).toBe("GERI_DONDU");
  });
  it("süre tahmini: başarılı backend denemelerinin ortancası; PG/başarısız sayılmaz; veri yoksa null", () => {
    const h = (sn: number, extra: Partial<UpdateHistoryItem> = {}): UpdateHistoryItem => ({ ...son("BASARILI"), baslangic: "2026-10-06T10:00:00.000Z", bitis: new Date(Date.parse("2026-10-06T10:00:00.000Z") + sn * 1000).toISOString(), urun: "backend", ayrintiKodu: null, pgSurum: null, onayId: null, ...extra });
    expect(estimateSeconds([h(100), h(200), h(300)])).toBe(200);
    expect(estimateSeconds([h(100, { urun: "pg" }), h(999, { sonuc: "GERI_DONDU" })])).toBeNull();
    expect(estimateSeconds([])).toBeNull();
  });
});

describe("canlı güncelleme — pencere", () => {
  beforeEach(() => {
    status.mockReset();
    Object.values(toastApi).forEach((f) => f.mockReset());
    perms.length = 0;
  });

  it("uygulanırken kendiliğinden açılır (aşamalar işaretli), bitince kapanır ve 'X sürümüne güncellendi' bildirir", async () => {
    perms.push("license:view");
    status.mockResolvedValue(uygulaniyor("GOC"));
    const queryClient = mount(<UpdateProgressWindow />);
    const win = await screen.findByTestId("guncelleme-ilerleme");
    expect(win.textContent).toContain("Sunucu 2.13.0 sürümüne güncelleniyor");
    expect(win.querySelector('[data-state="active"]')?.textContent).toBe("Veritabanı");
    expect(win.querySelectorAll('[data-state="done"]').length).toBe(2);
    status.mockResolvedValue(base({ kuruluSurum: "2.13.0", son: son("BASARILI") }));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["server-update"] });
    });
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith("Sunucu 2.13.0 sürümüne güncellendi"));
    await waitFor(() => expect(screen.queryByTestId("guncelleme-ilerleme")).toBeNull());
  });

  it("negatif: güncelleme yokken pencere YOK; izinsiz kullanıcıda istek atılmaz", async () => {
    perms.push("license:view");
    status.mockResolvedValue(base());
    renderWithProviders(<UpdateProgressWindow />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId("guncelleme-ilerleme")).toBeNull();
    status.mockClear();
    perms.length = 0;
    renderWithProviders(<UpdateProgressWindow />);
    await new Promise((r) => setTimeout(r, 30));
    expect(status).not.toHaveBeenCalled();
  });
});

describe("sunucu durumu — hizmet ve güncelleme bölümü", () => {
  beforeEach(() => {
    status.mockReset();
    perms.length = 0;
  });
  it("hizmetler + bekleyen sürüm notu; izinsizde hiç çizilmez; eski backend'de (uç yok) sessiz", async () => {
    perms.push("license:view");
    status.mockResolvedValue(base({ bekleyen: { ...base().bekleyen!, karar: "ONAY_BEKLIYOR" } }));
    renderWithProviders(<ServerUpdateSection db="UP" />);
    expect(await screen.findByText("Çalışıyor · 2.12.0")).toBeTruthy();
    expect(screen.getByText("Bağlı")).toBeTruthy();
    expect(screen.getByText("Normal · L-1")).toBeTruthy();
    expect(screen.getByText("Not metni")).toBeTruthy();
  });
  it("negatif: izin yok → bölüm yok; uç 404 → bölüm yok", async () => {
    renderWithProviders(<ServerUpdateSection db="UP" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("sunucu-guncelleme-bolumu")).toBeNull();
    perms.push("license:view");
    status.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404 } }));
    renderWithProviders(<ServerUpdateSection db="UP" />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId("sunucu-guncelleme-bolumu")).toBeNull();
  });
});
