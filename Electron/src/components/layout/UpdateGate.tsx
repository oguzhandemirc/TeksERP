import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdater } from "@/hooks/useUpdater";
import { useClientPolicy } from "@/hooks/useClientPolicy";
import { isBelowMinimum } from "@/lib/version-compare";

/**
 * Kapı açıldıktan sonra kurulumun kendiliğinden başlamasına kalan süre.
 * Güncelleme ZORUNLUDUR (kullanıcı kararı) — ama anında kesmek, vardiya
 * ortasındaki operatörün yarım kalan formunu götürürdü. Geri sayım kararı
 * yumuşatmaz, yalnız "işini kaydet" penceresi açar.
 */
const GERI_SAYIM_SN = 120;

/**
 * Kurulum başlatılamadıysa (Windows izin penceresine "Hayır" denmesi en olası
 * sebep) bir sonraki denemeye kalan süre. İlk geri sayımdan uzun: aynı soruyu
 * iki dakikada bir sormak, operatörü "Hayır"a şartlandırır.
 */
const YENIDEN_DENEME_SN = 300;

/**
 * `install()` sonrası uygulamanın kapanması beklenen süre. Bu süre dolduğu
 * halde pencere hâlâ ayaktaysa kurulum BAŞLAMAMIŞ demektir.
 *
 * ⚠️ Bu bekçi olmadan kapı kalıcı olarak kilitlenirdi: `kuruldu` tek-atışlık
 * bir kilit, kurulum sessizce düşerse kapatılamayan ve hiçbir şey yapmayan bir
 * ekran kalırdı — paneli kullanılamaz hale getirerek.
 */
const KURULUM_BEKLEME_MS = 20_000;

function sureMetni(sn: number): string {
  const dk = Math.floor(sn / 60);
  const kalan = sn % 60;
  if (dk > 0) return `${dk} dk ${String(kalan).padStart(2, "0")} sn`;
  return `${kalan} saniye`;
}

/**
 * Güncelleme yüzeyi. Kapı İKİ ayrı sebeple açılabilir:
 *
 *  ① **Güncelleme indi** (`state === "ready"`) — normal akış.
 *  ② **Backend bu sürümü kabul etmiyor** (`minVersion` politikası) — güncelleme
 *     henüz inmemiş olsa bile panel kullanılamaz, çünkü sözleşme uyuşmuyor.
 *     Bu projede deploy sırası "backend ÖNCE" olduğu için o aralık gerçek.
 *
 * İnerken ince şerit gösterilir: kapı sürpriz olmasın. Sürpriz kesinti =
 * kaydedilmemiş iş kaybı + "bilgisayar kendi kendine kapandı" algısı.
 *
 * `error` durumu kapı KAPALIYKEN gösterilmez: internete çıkamayan bir makine
 * her açılışta kırmızı bir şey görürse uyarı körleşir. Hata Genel Ayarlar →
 * Bu Bilgisayar → Güncelleme'de yazılıdır. Kapı AÇIKKEN gösterilir — orada
 * operatör beklemek zorunda ve neden beklediğini bilmeli.
 */
export function UpdateGate() {
  const { status, check, install } = useUpdater();
  const policy = useClientPolicy();

  const kuruldu = useRef(false);
  const [kuruluyor, setKuruluyor] = useState(false);
  const [kurulumHatasi, setKurulumHatasi] = useState(false);
  const [kalan, setKalan] = useState(GERI_SAYIM_SN);

  const hazir = status?.state === "ready";
  const iniyor = status?.state === "downloading" || status?.state === "available";
  const politikaKilidi = isBelowMinimum(status?.currentVersion, policy?.minVersion);
  const kapiAcik = Boolean(status?.enabled) && (hazir || politikaKilidi);

  // Geri sayım YALNIZ kurulacak paket hazırken işler. Politika kilidi varken
  // paket henüz inmediyse sayacak bir şey yok — orada beklenen şey indirmedir.
  useEffect(() => {
    if (!hazir || kuruluyor) return;
    setKalan(kurulumHatasi ? YENIDEN_DENEME_SN : GERI_SAYIM_SN);
    const t = setInterval(() => setKalan((k) => (k > 0 ? k - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [hazir, kuruluyor, kurulumHatasi]);

  const kur = () => {
    if (kuruldu.current) return;
    kuruldu.current = true;
    setKuruluyor(true);
    setKurulumHatasi(false);
    install();
  };

  // Süre dolunca kendiliğinden kur.
  useEffect(() => {
    if (hazir && !kuruluyor && kalan <= 0 && !kuruldu.current) kur();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazir, kuruluyor, kalan]);

  // Kurulum başlamadıysa kilidi aç — yoksa kapı kalıcı olarak kilitlenir.
  useEffect(() => {
    if (!kuruluyor) return;
    const t = setTimeout(() => {
      kuruldu.current = false;
      setKuruluyor(false);
      setKurulumHatasi(true);
    }, KURULUM_BEKLEME_MS);
    return () => clearTimeout(t);
  }, [kuruluyor]);

  if (!kapiAcik) {
    if (!iniyor) return null;
    const yuzde = status?.percent ?? 0;
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-info/30 bg-info/10 px-4 py-1.5 text-xs">
        <Download className="h-3.5 w-3.5 shrink-0 animate-pulse text-info" />
        <span className="min-w-0 flex-1 truncate">
          <strong className="font-semibold">Yeni sürüm indiriliyor…</strong>{" "}
          <span className="text-muted-foreground">
            İndirme bitince uygulama yeniden başlatılacak — işinizi kaydedin.
          </span>
        </span>
        {status?.state === "downloading" && (
          <span className="shrink-0 font-mono tabular-nums text-info">%{yuzde}</span>
        )}
      </div>
    );
  }

  // --- Kapı açık -----------------------------------------------------------
  const paketBekleniyor = politikaKilidi && !hazir;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="guncelleme-basligi"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              paketBekleniyor ? "bg-warning/15" : "bg-info/15"
            }`}
          >
            {paketBekleniyor ? (
              <AlertTriangle className="h-5 w-5 text-warning" />
            ) : (
              <Download className="h-5 w-5 text-info" />
            )}
          </span>
          <div className="min-w-0">
            <h2 id="guncelleme-basligi" className="text-base font-semibold leading-tight">
              {paketBekleniyor ? "Bu sürüm sunucuyla uyumlu değil" : "Güncelleme kurulacak"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Kurulu sürüm {status?.currentVersion}
              {paketBekleniyor
                ? ` · sunucu en az ${policy?.minVersion} istiyor`
                : status?.newVersion
                  ? ` → ${status.newVersion} indirildi`
                  : ""}
            </p>
          </div>
        </div>

        {paketBekleniyor ? (
          <>
            <p className="mb-1 text-sm">
              {policy?.message ??
                "Sunucu güncellendi ve bu panel sürümü artık desteklenmiyor. Güncelleme kurulana kadar panel kullanılamaz."}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              {status?.state === "downloading"
                ? `Güncelleme indiriliyor… %${status.percent ?? 0}`
                : status?.state === "checking"
                  ? "Güncelleme aranıyor…"
                  : status?.state === "error"
                    ? (status.error ?? "Güncelleme sunucusuna ulaşılamadı.")
                    : "Güncelleme hazırlanıyor…"}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={() => void check()}
              disabled={status?.state === "checking" || status?.state === "downloading"}
            >
              <RefreshCw
                className={`h-4 w-4 ${status?.state === "checking" ? "animate-spin" : ""}`}
              />
              Şimdi kontrol et
            </Button>
          </>
        ) : (
          <>
            <p className="mb-1 text-sm">
              Uygulama yeniden başlatılıp güncelleme kurulacak. Windows bir kez izin soracak;
              <strong> Evet</strong> deyin.
            </p>
            {kurulumHatasi ? (
              <p className="mb-4 text-sm text-warning">
                Kurulum başlatılamadı — izin penceresinde <strong>Evet</strong> seçilmemiş
                olabilir.{" "}
                <span className="font-mono tabular-nums">{sureMetni(kalan)}</span> sonra
                yeniden denenecek.
              </p>
            ) : (
              <p className="mb-4 text-sm text-muted-foreground">
                Kaydedilmemiş bir işiniz varsa şimdi tamamlayın —{" "}
                <strong className="font-mono tabular-nums text-foreground">
                  {sureMetni(kalan)}
                </strong>{" "}
                sonra kurulum kendiliğinden başlayacak.
              </p>
            )}
            <Button type="button" className="w-full gap-2" onClick={kur} disabled={kuruluyor}>
              <RefreshCw className={`h-4 w-4 ${kuruluyor ? "animate-spin" : ""}`} />
              {kuruluyor ? "Kuruluyor…" : "Şimdi kur ve yeniden başlat"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
