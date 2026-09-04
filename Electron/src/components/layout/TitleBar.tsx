import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * Uygulamanın KENDİ başlık çubuğu (Windows/Linux).
 *
 * NEDEN: pencere `frame: false` ile açılır (`electron/main.ts`), yani işletim
 * sisteminin gri şeridi ve düğmeleri YOKTUR. Üst şerit de uygulamaya aittir.
 *
 * ⚠️ macOS'TA ÇİZİLMEZ. Orada pencere `titleBarStyle: "hiddenInset"` ile açılır:
 * trafik ışıklarını sistem çizer ve kullanıcılar yerlerini kas hafızasıyla bilir.
 * Kendi düğmelerimizi koymak platform sözleşmesini bozar ve sistem düğmelerinin
 * ÜSTÜNE binerdi.
 *
 * ⚠️ TARAYICIDA DA ÇİZİLMEZ (`IS_ELECTRON`): web paneli bir sekmede koşar,
 * "kapat" düğmesi orada anlamsızdır ve `window.api` yoktur.
 *
 * ⚠️ SÜRÜKLEME BÖLGESİ GEOMETRİDİR, z-index DEĞİL (bkz.
 * `src/test/app-drag-region.test.ts`). Şerit yatayda tam genişlik (`inset-x-0`)
 * ama YÜKSEKLİĞİ SINIRLI olmak zorunda; `h-full`/`inset-0` verilirse portal'lanan
 * modallar tıklamayı pencere-taşımaya kaptırır ve sebepsiz ölürler. Düğmeler
 * `app-no-drag` taşır, yoksa tıklanamazlar.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(navigator.userAgent.includes("Macintosh"));
    let aktif = true;
    const oku = (): void => {
      const p = window.api?.window?.isMaximized?.();
      if (p) void p.then((v) => aktif && setMaximized(v)).catch(() => {});
    };
    oku();
    // Pencere klavyeyle (Win+Yukarı) ya da çift tıkla da büyütülebilir; düğme
    // ikonu bunlarda da doğru kalsın diye boyut değişimini dinliyoruz.
    window.addEventListener("resize", oku);
    return () => {
      aktif = false;
      window.removeEventListener("resize", oku);
    };
  }, []);

  if (!IS_ELECTRON || mac) return null;

  const dugme =
    "app-no-drag inline-flex h-8 w-11 items-center justify-center text-muted-foreground " +
    "transition hover:bg-muted hover:text-foreground";

  return (
    <div
      data-titlebar
      className="app-drag fixed inset-x-0 top-0 z-[100] flex h-8 select-none items-center justify-between border-b border-border bg-background"
    >
      <span className="pl-3 text-xs font-medium tracking-wide text-muted-foreground">
        TeksERP
      </span>

      <div className="flex items-stretch">
        <button
          type="button"
          aria-label="Simge durumuna küçült"
          className={dugme}
          onClick={() => window.api?.window?.minimize?.()}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Önceki boyut" : "Tam ekran"}
          className={dugme}
          onClick={() => {
            window.api?.window?.maximize?.();
            setMaximized((v) => !v);
          }}
        >
          {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          type="button"
          aria-label="Kapat"
          // Kapatma AYRI renklenir: yanlış tıklanması en pahalı düğme budur.
          className={`${dugme} hover:bg-destructive hover:text-destructive-foreground`}
          onClick={() => window.api?.window?.close?.()}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
