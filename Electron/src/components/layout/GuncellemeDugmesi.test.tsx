import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UpdateStatus } from "@shared/ipc-contract";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GuncellemeDugmesi } from "./GuncellemeDugmesi";
import { guncellemeRozeti } from "@/lib/updater-durum";

/**
 * TOPBAR "GÜNCELLEME DENETLE" DÜĞMESİ — bekçi (2026-09-04).
 *
 * ⭐ İDDİA ①: düğme durumu GÖSTERİR (kontrol ediliyor / güncel / iniyor /
 *   yeniden başlatılacak) ve metin tek kaynaktan (`@/lib/updater-durum`) gelir.
 * ⭐ İDDİA ②: hata KIRMIZI BASMAZ — `error` durumunda düğme nötr görünür ve
 *   hiçbir "destructive" sınıf taşımaz. Sürekli kırmızı bir gösterge körleşir.
 * ⭐ İDDİA ③: tık `updater:check`i ÇAĞIRIR (ikinci bir zamanlayıcı değil).
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

function kur(patch: Partial<UpdateStatus>) {
  const durum: UpdateStatus = { ...temelDurum, ...patch };
  check.mockResolvedValue(durum);
  (window as unknown as { api: unknown }).api = {
    updater: {
      status: () => Promise.resolve(durum),
      check,
      install: vi.fn(),
      setFeedUrl: vi.fn(),
      onStatus: () => () => {},
    },
  };
}

/** Düğmeyi (varsa) bul — aria-label durum ekiyle değiştiği için ön ekten ara. */
const dugme = () => screen.queryByRole("button", { name: /Güncellemeyi denetle/ });

beforeEach(() => check.mockReset());
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
