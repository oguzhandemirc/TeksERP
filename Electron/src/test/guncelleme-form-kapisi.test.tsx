import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { UpdateStatus } from "@shared/ipc-contract";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { resetOpenFormRegistryForTest } from "@/lib/acik-form";

/**
 * GÜNCELLEME AÇIK FORMU BEKLER (kullanıcı kararı 2026-10-12) — A1–A5.
 * Hazır paket, oturumda açık/yazılmış form varken geri sayım başlatmaz; form kapanınca başlar; formsuz ekranda
 * hemen başlar; "Sonra" kurulumu programın kapanışına bırakır; elle kurulum düğmeleri form varken önce uyarır.
 */

vi.mock("@/hooks/useClientPolicy", () => ({ useClientPolicy: () => null }));

const { UpdateGate, UpdateDownloadStrip } = await import("@/components/layout/UpdateGate");
const { PanelRow } = await import("@/pages/System/Updates/PanelRow");

const install = vi.fn();
const defer = vi.fn();
/** Ana süreç durumu bütün dinleyicilere yayımlar (şerit + kapı ayrı abonedir). */
const dinleyenler = new Set<(s: UpdateStatus) => void>();
const yayinla = (s: UpdateStatus) => dinleyenler.forEach((cb) => cb(s));

function updater(ek: Partial<UpdateStatus> = {}) {
  const durum: UpdateStatus = {
    state: "ready",
    currentVersion: "1.6.4",
    newVersion: "1.6.5",
    lastCheckedAt: null,
    feedUrl: "https://guncelleme.example/f/electron/",
    feedUrlOverridden: false,
    enabled: true,
    ...ek,
  };
  defer.mockImplementation(() => yayinla({ ...durum, ertelendi: true }));
  (window as unknown as { api: unknown }).api = {
    updater: {
      status: () => Promise.resolve(durum),
      check: vi.fn(),
      install,
      defer,
      setFeedUrl: vi.fn(),
      onStatus: (cb: (s: UpdateStatus) => void) => {
        dinleyenler.add(cb);
        return () => dinleyenler.delete(cb);
      },
    },
  };
}

/** Kabuk benzeri: şerit + bir ekran (form diyaloğu açılıp kapanabilir) + kapı. */
function Kabuk({ ilkAcik }: { ilkAcik: boolean }) {
  const [acik, setAcik] = useState(ilkAcik);
  return (
    <>
      <UpdateDownloadStrip />
      <button type="button" onClick={() => setAcik(false)}>
        formu kapat
      </button>
      <Dialog open={acik}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Yeni müşteri</DialogTitle>
          <input aria-label="Unvan" />
        </DialogContent>
      </Dialog>
      <UpdateGate girisEkrani={false} />
    </>
  );
}

const bosalt = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const ilerle = async (sn: number) => {
  for (let i = 0; i < sn; i++) await act(async () => void vi.advanceTimersByTime(1000));
};
const kapi = () => screen.queryByRole("alertdialog", { name: /Güncelleme kurulacak/ });

beforeEach(() => {
  vi.useFakeTimers();
  install.mockReset();
  defer.mockReset();
  dinleyenler.clear();
  resetOpenFormRegistryForTest();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { api?: unknown }).api;
});

describe("güncelleme kapısı — açık form", () => {
  it("A1 ⭐ açık form varken paket hazır → kapı yok, geri sayım yok, şerit 'açık formunuz kapanınca'", async () => {
    updater();
    render(<Kabuk ilkAcik />);
    await bosalt();
    expect(kapi()).toBeNull();
    expect(screen.getByText("Güncelleme hazır — açık formunuz kapanınca kurulacak")).toBeTruthy();
    await ilerle(300);
    expect(kapi()).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it("A1b sayım sürerken sayfa formuna yazılırsa sayım durur", async () => {
    updater();
    render(
      <>
        <form>
          <input aria-label="Miktar" />
        </form>
        <UpdateGate girisEkrani={false} />
      </>,
    );
    await bosalt();
    expect(kapi()).not.toBeNull();
    await ilerle(30);
    fireEvent.input(screen.getByLabelText("Miktar"), { target: { value: "7" } });
    await ilerle(1);
    expect(kapi()).toBeNull();
    await ilerle(200);
    expect(install).not.toHaveBeenCalled();
  });

  it("A2 ⭐ form kapanınca geri sayım baştan başlar ve süre dolunca kurar", async () => {
    updater();
    render(<Kabuk ilkAcik />);
    await bosalt();
    await ilerle(200);
    fireEvent.click(screen.getByRole("button", { name: "formu kapat", hidden: true }));
    await ilerle(1);
    expect(kapi()).not.toBeNull();
    expect(screen.queryByText(/açık formunuz kapanınca/)).toBeNull();
    await ilerle(110);
    expect(install).not.toHaveBeenCalled(); // tam 120 sn: bekleme süresi sayılmaz
    await ilerle(15);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("A3 form yok → kapı hemen açılır, 120 sn sonra kurar (hareketsizlik şartı yok)", async () => {
    updater();
    render(<Kabuk ilkAcik={false} />);
    await bosalt();
    expect(kapi()).not.toBeNull();
    await ilerle(121);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("A4 ⭐ 'Sonra' → defer çağrılır, kapı kapanır, şerit 'program kapanırken', geri sayım yok", async () => {
    updater();
    render(<Kabuk ilkAcik={false} />);
    await bosalt();
    fireEvent.click(screen.getByRole("button", { name: /Sonra/ }));
    await bosalt();
    expect(defer).toHaveBeenCalledTimes(1);
    expect(kapi()).toBeNull();
    expect(screen.getByText("Güncelleme hazır — program kapanırken kurulacak")).toBeTruthy();
    await ilerle(300);
    expect(install).not.toHaveBeenCalled();
  });

  it("A4b giriş ekranında 'Sonra' yok (yarım iş yok, kısa sayım kurar)", async () => {
    updater();
    render(<UpdateGate girisEkrani />);
    await bosalt();
    expect(kapi()).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Sonra/ })).toBeNull();
  });
});

describe("A5 elle kurulum — açık form varken önce uyarır", () => {
  it("⭐ 'Yeniden başlat' form varken onay ister; Vazgeç kurmaz, 'Yine de kur' kurar", async () => {
    updater();
    render(
      <>
        <form>
          <input aria-label="Miktar" />
        </form>
        <PanelRow />
      </>,
    );
    await bosalt();
    fireEvent.input(screen.getByLabelText("Miktar"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Yeniden başlat" }));
    await bosalt();
    expect(screen.getByText("Açık formunuz var")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await bosalt();
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden başlat" }));
    await bosalt();
    fireEvent.click(screen.getByRole("button", { name: "Yine de kur" }));
    await bosalt();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("form yoksa 'Yeniden başlat' doğrudan kurar", async () => {
    updater();
    render(<PanelRow />);
    await bosalt();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden başlat" }));
    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Açık formunuz var")).toBeNull();
  });

  it("şeridin 'Şimdi kur'u aynı kapıdan geçer (açık diyalog → onay)", async () => {
    updater();
    render(<Kabuk ilkAcik />);
    await bosalt();
    fireEvent.click(screen.getByRole("button", { name: "Şimdi kur", hidden: true }));
    await bosalt();
    expect(screen.getByText("Açık formunuz var")).toBeTruthy();
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yine de kur" }));
    await bosalt();
    expect(install).toHaveBeenCalledTimes(1);
  });
});
