import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import type { UpdateStatus } from "@shared/ipc-contract";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { ELLE_DENETIM_ASGARI_MS, GuncellemeDugmesi } from "./GuncellemeDugmesi";
import { guncellemeRozeti } from "@/lib/updater-durum";
import { elleDenetimBildirimi } from "@/lib/updater-bildirim";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
const toastSpy = toast as unknown as ReturnType<typeof vi.fn> & {
  success: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
/** Herhangi bir baloncuk çıktı mı (tür fark etmeksizin)? */
const baloncukSayisi = () =>
  toastSpy.mock.calls.length +
  toastSpy.success.mock.calls.length +
  toastSpy.info.mock.calls.length +
  toastSpy.error.mock.calls.length;

/**
 * TOPBAR "GÜNCELLEME DENETLE" DÜĞMESİ — bekçi (2026-09-04).
 *
 * ⭐ İDDİA ①: düğme durumu GÖSTERİR (kontrol ediliyor / güncel / iniyor /
 *   yeniden başlatılacak) ve metin tek kaynaktan (`@/lib/updater-durum`) gelir.
 * ⭐ İDDİA ②: hata KIRMIZI BASMAZ — `error` durumunda düğme nötr görünür ve
 *   hiçbir "destructive" sınıf taşımaz. Sürekli kırmızı bir gösterge körleşir.
 * ⭐ İDDİA ③: tık `updater:check`i ÇAĞIRIR (ikinci bir zamanlayıcı değil).
 * ⭐ İDDİA ④ (2026-09-04): elle basışta dönüş animasyonu TAM koşar — sunucu
 *   anında cevap verse bile asgari süre dolmadan ne dönüş durur ne baloncuk
 *   çıkar; bitince yumuşak bir bildirim ("Uygulama güncel") gelir.
 * ⭐ İDDİA ⑤ (2026-09-04): **OTOMATİK kontrolde baloncuk ÇIKMAZ.** 15 dakikada
 *   bir sessizce baloncuk basan bir gösterge körleşir; ayrım paylaşılan bir
 *   bayrakla değil ÇAĞRI YERİYLE kuruludur (yarış penceresi yok).
 */
const temelDurum: UpdateStatus = {
  state: "idle",
  currentVersion: "2.9.0",
  lastCheckedAt: null,
  feedUrl: "https://guncelleme.example/adnansahin/electron/",
  feedUrlOverridden: false,
  enabled: true,
};

const check = vi.fn();

/** Main process'in durum yayınını taklit eder (otomatik kontrolün tek kanalı). */
let yayinla: (s: UpdateStatus) => void = () => {};

function kur(patch: Partial<UpdateStatus>) {
  const durum: UpdateStatus = { ...temelDurum, ...patch };
  check.mockResolvedValue(durum);
  (window as unknown as { api: unknown }).api = {
    updater: {
      status: () => Promise.resolve(durum),
      check,
      install: vi.fn(),
      setFeedUrl: vi.fn(),
      onStatus: (cb: (s: UpdateStatus) => void) => {
        yayinla = cb;
        return () => {};
      },
    },
  };
  return durum;
}

/** Düğmeyi (varsa) bul — aria-label durum ekiyle değiştiği için ön ekten ara. */
const dugme = () => screen.queryByRole("button", { name: /Güncellemeyi denetle/ });

beforeEach(() => {
  check.mockReset();
  toastSpy.mockClear();
  toastSpy.success.mockClear();
  toastSpy.info.mockClear();
  toastSpy.error.mockClear();
  yayinla = () => {};
});
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
});

describe("topbar güncelleme düğmesi", () => {
  it("durumu okunur biçimde basar (tek kaynak eşlemesiyle birebir)", async () => {
    for (const state of ["checking", "up-to-date", "downloading", "ready"] as const) {
      kur({ state });
      const { unmount } = render(<GuncellemeDugmesi />);
      const beklenen = guncellemeRozeti(state);
      expect(beklenen, `${state} eşlemesi olmalı`).not.toBeNull();
      await waitFor(() =>
        expect(dugme()).toHaveAttribute("aria-label", expect.stringContaining(beklenen!.metin)),
      );
      // Başlık (title) Türkçe ve aynı cümleyi taşır.
      expect(dugme()).toHaveAttribute("title", expect.stringContaining(beklenen!.metin));
      unmount();
    }
  });

  it("⚠️ hata KIRMIZI BASMAZ — nötr görünür, durum eki yok", async () => {
    kur({ state: "error", error: "Güncelleme sunucusuna ulaşılamadı." });
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeInTheDocument());
    expect(dugme()).toHaveAttribute("aria-label", "Güncellemeyi denetle");
    expect(dugme()!.innerHTML).not.toMatch(/destructive|text-red|text-warning/);
    // Hata metni düğmeye SIZMAZ (o bilgi Sistem → Güncelleme ekranında).
    expect(dugme()!.getAttribute("title")).not.toContain("ulaşılamadı");
  });

  it("tıklanınca kontrolü tetikler", async () => {
    kur({ state: "up-to-date" });
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeEnabled());
    await userEvent.click(dugme()!);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("inerken kilitli (aynı paketi ikinci kez sormanın anlamı yok)", async () => {
    kur({ state: "downloading", percent: 42 });
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeDisabled());
    expect(dugme()).toHaveAttribute("aria-label", expect.stringContaining("%42"));
  });

  it("geliştirme modunda (enabled:false) kilitli ve sebebi yazılı", async () => {
    kur({ state: "idle", enabled: false });
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeDisabled());
    expect(dugme()).toHaveAttribute("title", expect.stringContaining("geliştirme modunda"));
  });

  it("web panelinde HİÇ çizilmez (window.api.updater yok)", () => {
    delete (window as unknown as { api?: unknown }).api;
    render(<GuncellemeDugmesi />);
    expect(dugme()).toBeNull();
  });
});

describe("durum eşlemesi (tek kaynak)", () => {
  it("error ve idle gösterilmez — kırmızı körleşmesin", () => {
    expect(guncellemeRozeti("error")).toBeNull();
    expect(guncellemeRozeti("idle")).toBeNull();
    expect(guncellemeRozeti(undefined)).toBeNull();
  });

  it("dört anlamlı durum metin + renk taşır", () => {
    expect(guncellemeRozeti("checking")?.metin).toBe("kontrol ediliyor…");
    expect(guncellemeRozeti("up-to-date")).toEqual({ metin: "güncel", sinif: "text-success" });
    expect(guncellemeRozeti("available")?.metin).toBe("güncelleme iniyor");
    expect(guncellemeRozeti("downloading")?.metin).toBe("güncelleme iniyor");
    expect(guncellemeRozeti("ready")?.metin).toBe("yeniden başlatılacak");
    for (const s of ["checking", "available", "downloading", "ready"] as const) {
      expect(guncellemeRozeti(s)!.sinif).not.toMatch(/destructive|red/);
    }
  });
});

describe("yerleşim + tek eşleme (kaynak taraması)", () => {
  const oku = (yol: string) =>
    readFileSync(resolve(process.cwd(), yol), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("düğme topbar'da mount edilmiş ve pencere düğmeleri EN SAĞDA duruyor", () => {
    const topbar = oku("src/components/layout/Topbar.tsx");
    expect(topbar).toContain("<GuncellemeDugmesi />");
    // Pencere kontrolleri hâlâ son eleman — düğme onun soluna girdi.
    expect(topbar.indexOf("<GuncellemeDugmesi />")).toBeLessThan(
      topbar.indexOf("<PencereKontrolleri />"),
    );
  });

  it("⚠️ İKİNCİ EŞLEME YOK: üç yüzey de tek kaynağı import eder", () => {
    for (const yol of [
      "src/components/SurumRozeti.tsx",
      "src/components/layout/sidebar-brand.tsx",
      "src/components/layout/GuncellemeDugmesi.tsx",
    ]) {
      const kod = oku(yol);
      expect(kod, `${yol} tek kaynağı import etmeli`).toContain("updater-durum");
      // ⚠️ ÇAPA "durum → metin/renk" kopyasının İMZASIDIR, `switch` biçimi
      // değil: sonda ilk yazımda `case "up-to-date"` arıyordu ve kopyayı üçlü
      // operatörle geri koyan negatif sondayı KAÇIRDI. Kopyanın hangi biçimde
      // yazıldığı serbest; kaçınılmaz olan, tek kaynağa ait iki değerdir —
      // `up-to-date` ayrımı ve rozet renkleri.
      expect(kod, `${yol} kendi eşlemesini yazmamalı`).not.toContain('"up-to-date"');
      expect(kod, `${yol} rozet rengini kendi seçmemeli`).not.toMatch(/text-success|text-info/);
    }
  });
});

describe("elle denetleme: tam koşan animasyon + yumuşak bildirim (2026-09-04)", () => {
  it("⭐ animasyon TAM koşar: API anında cevap verse de asgari süreden önce ne durur ne baloncuk çıkar", async () => {
    vi.useFakeTimers();
    try {
      kur({ state: "up-to-date" }); // check() ANINDA çözülür (sahadaki 50 ms'lik cevap)
      render(<GuncellemeDugmesi />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        fireEvent.click(dugme()!);
        await vi.advanceTimersByTimeAsync(0);
      });

      // Sunucu cevabı geldi; animasyon hâlâ dönüyor ve düğme kilitli.
      expect(check).toHaveBeenCalledTimes(1);
      expect(dugme()).toBeDisabled();
      expect(dugme()!.querySelector(".animate-spin"), "ikon dönüyor olmalı").not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ELLE_DENETIM_ASGARI_MS - 1);
      });
      expect(baloncukSayisi(), "asgari süre dolmadan baloncuk çıkmamalı").toBe(0);
      expect(dugme(), "asgari süre dolmadan dönüş durmamalı").toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
      expect(toastSpy.success).toHaveBeenCalledTimes(1);
      expect(toastSpy.success.mock.calls[0]![0]).toBe("Uygulama güncel");
      expect(toastSpy.success.mock.calls[0]![1]?.description).toContain("2.9.0");
      expect(dugme()).toBeEnabled();
      expect(dugme()!.querySelector(".animate-spin")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("⭐⚠️ OTOMATİK kontrolde baloncuk ÇIKMAZ (durum yayını sessizdir)", async () => {
    kur({ state: "checking" });
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeInTheDocument());

    // Main process'in 15 dakikalık kontrolü: yalnız durum yayınlar.
    for (const state of ["up-to-date", "available", "downloading", "ready", "error"] as const) {
      act(() => yayinla({ ...temelDurum, state }));
    }
    expect(check, "otomatik yayın elle denetleme çağırmaz").not.toHaveBeenCalled();
    expect(baloncukSayisi(), "otomatik kontrol HİÇ baloncuk basmamalı").toBe(0);
  });

  it("elle basışın baloncuğu, araya giren OTOMATİK yayının değil KENDİ sonucunun cümlesidir", async () => {
    // Yarış: tık sırasında main process bambaşka bir durum yayınlıyor.
    kur({ state: "up-to-date" });
    check.mockImplementation(async () => {
      act(() => yayinla({ ...temelDurum, state: "error", error: "koptu" }));
      return { ...temelDurum, state: "up-to-date" };
    });
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeEnabled());
    await userEvent.click(dugme()!);
    await waitFor(() => expect(baloncukSayisi()).toBe(1), { timeout: 3000 });
    expect(toastSpy.success).toHaveBeenCalledTimes(1);
  });

  it("hata KIRMIZI değil NÖTR baloncuk basar (toast.error KULLANILMAZ)", async () => {
    kur({ state: "error", error: "Sunucuya ulaşılamadı." });
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeEnabled());
    await userEvent.click(dugme()!);
    await waitFor(() => expect(baloncukSayisi()).toBe(1), { timeout: 3000 });
    expect(toastSpy.error, "kırmızı baloncuk körleştirir").not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledTimes(1); // düz (nötr) toast
    expect(toastSpy.mock.calls[0]![0]).toBe("Şu an denetlenemedi");
  });

  it("IPC düşerse basış cevapsız kalmaz (nötr baloncuk)", async () => {
    kur({ state: "idle" });
    check.mockRejectedValue(new Error("ipc yok"));
    render(<GuncellemeDugmesi />);
    await waitFor(() => expect(dugme()).toBeEnabled());
    await userEvent.click(dugme()!);
    await waitFor(() => expect(baloncukSayisi()).toBe(1), { timeout: 3000 });
    expect(toastSpy.mock.calls[0]![0]).toBe("Şu an denetlenemedi");
  });
});

describe("baloncuk metni (saf eşleme)", () => {
  const d = (p: Partial<UpdateStatus>): UpdateStatus => ({ ...temelDurum, ...p });

  it("güncel → başarı, iniyor/hazır → bilgi, gerisi → nötr", () => {
    expect(elleDenetimBildirimi(d({ state: "up-to-date" }))).toMatchObject({
      tur: "basari",
      baslik: "Uygulama güncel",
    });
    expect(elleDenetimBildirimi(d({ state: "downloading", newVersion: "3.0.0" }))?.tur).toBe("bilgi");
    expect(elleDenetimBildirimi(d({ state: "available" }))?.tur).toBe("bilgi");
    expect(elleDenetimBildirimi(d({ state: "ready" }))?.tur).toBe("bilgi");
    for (const state of ["error", "idle", "checking"] as const) {
      expect(elleDenetimBildirimi(d({ state }))?.tur, state).toBe("notr");
    }
    // Sonuç okunamadı (IPC düştü) da nötrdür — sessizlik DEĞİL.
    expect(elleDenetimBildirimi(null)?.tur).toBe("notr");
  });

  it("geliştirme modunda (enabled:false) hiçbir şey yazmaz", () => {
    expect(elleDenetimBildirimi(d({ state: "idle", enabled: false }))).toBeNull();
    expect(elleDenetimBildirimi(d({ state: "up-to-date", enabled: false }))).toBeNull();
  });

  it("hiçbir metin kırmızı/hata tonu taşımaz", () => {
    for (const state of ["error", "idle", "checking"] as const) {
      const b = elleDenetimBildirimi(d({ state }))!;
      expect(b.baslik + " " + (b.aciklama ?? "")).not.toMatch(/hata|başarısız|HATA/i);
    }
  });
});

describe("baloncuk YALNIZ elle basış yolunda (kaynak taraması)", () => {
  it("⚠️ `updater-bildirim` yalnız düğmeden çağrılır — hook/yayın yolundan DEĞİL", () => {
    const kok = resolve(process.cwd(), "src");
    const bulunan: string[] = [];
    const gez = (dizin: string) => {
      for (const girdi of readdirSync(dizin, { withFileTypes: true })) {
        const yol = join(dizin, girdi.name);
        if (girdi.isDirectory()) {
          gez(yol);
          continue;
        }
        if (!/\.tsx?$/.test(girdi.name)) continue;
        if (/\.test\.tsx?$/.test(girdi.name)) continue;
        if (yol.endsWith(join("lib", "updater-bildirim.ts"))) continue;
        if (readFileSync(yol, "utf-8").includes("updater-bildirim")) {
          bulunan.push(yol.slice(kok.length + 1));
        }
      }
    };
    gez(kok);
    expect(bulunan).toEqual(["components/layout/GuncellemeDugmesi.tsx"]);
  });
});
