import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * Pencere düğmeleri (küçült / büyült / kapat) — Windows ve Linux.
 *
 * ⚠️ AYRI BİR BAŞLIK ÇUBUĞU DEĞİLDİR, BİLEREK. İlk yazımda 32px'lik kendi
 * şeridimiz vardı; kullanıcı kararı "başlıksız olsun, macOS gibi" oldu. Bir
 * şerit koymak ekranın üstünden 32px götürüyor ve uygulamanın kendi başlığının
 * (`Topbar`, h-12) hemen üstünde İKİNCİ bir çubuk gibi duruyordu.
 *
 * Bu yüzden düğmeler uygulamanın ZATEN VAR OLAN başlıklarının içine gömülür:
 *   · `Topbar`      — uygulama içi (zaten `app-drag`, yani sürükleme şeridi o)
 *   · `LoginPage`   — giriş ekranının sağ üst düğme kümesi
 *   · `BossShell`   — patron ekranının kendi başlığı
 * İçerik ekranın en üstüne kadar gelir; işletim sisteminden görünen hiçbir şey
 * kalmaz.
 *
 * ⚠️ macOS'TA ÇİZİLMEZ: orada pencere `titleBarStyle: "hiddenInset"` ile açılır
 * ve trafik ışıklarını sistem çizer. Kendi düğmelerimiz onların ikizi olurdu.
 *
 * ⚠️ TARAYICIDA ÇİZİLMEZ (`IS_ELECTRON`): web panelinde "kapat" anlamsızdır ve
 * `window.api` yoktur.
 *
 * ⚠️ `app-no-drag` ZORUNLU: bu düğmeler bir sürükleme şeridinin (`Topbar`,
 * `LoginHero`in üst şeridi) İÇİNDE duruyor. Beyan edilmezse tıklama DOM'a hiç
 * ulaşmadan pencere-taşımaya gider — hata yok, log yok (2026-08-28 saha
 * arızasının aynısı; bekçi: `src/test/app-drag-region.test.ts`).
 */
export function PencereKontrolleri() {
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
    // Pencere klavyeyle (Win+Yukarı) ya da başlığa çift tıklayarak da büyür;
    // ikon bu yollarda da doğru kalsın diye boyut değişimi dinlenir.
    window.addEventListener("resize", oku);
    return () => {
      aktif = false;
      window.removeEventListener("resize", oku);
    };
  }, []);

  if (!IS_ELECTRON || mac) return null;

  const dugme =
    "inline-flex h-8 w-9 items-center justify-center rounded-md text-muted-foreground " +
    "transition hover:bg-accent hover:text-foreground";

  return (
    <div className="app-no-drag ml-1 flex items-center">
      <button
        type="button"
        aria-label="Simge durumuna küçült"
        title="Simge durumuna küçült"
        className={dugme}
        onClick={() => window.api?.window?.minimize?.()}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Önceki boyut" : "Tam ekran"}
        title={maximized ? "Önceki boyut" : "Tam ekran"}
        className={dugme}
        onClick={() => {
          window.api?.window?.maximize?.();
          setMaximized((v) => !v);
        }}
      >
        {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Kapat"
        title="Kapat"
        // Kapatma AYRI renklenir: yanlış tıklanması en pahalı düğme budur.
        className={`${dugme} hover:bg-destructive hover:text-destructive-foreground`}
        onClick={() => window.api?.window?.close?.()}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
