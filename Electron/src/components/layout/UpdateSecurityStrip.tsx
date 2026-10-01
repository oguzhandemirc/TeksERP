import { ShieldAlert } from "lucide-react";
import { useUpdater } from "@/hooks/useUpdater";
import { UpdateDownloadStrip } from "./UpdateGate";

/** Oturum kabuğunun güncelleme şeritleri: indirme (UpdateGate) + imza reddi (aşağıda). Kurulum tetiği değil. */
export function UpdateStrips() {
  return (
    <>
      <UpdateDownloadStrip />
      <UpdateSecurityStrip />
    </>
  );
}

/**
 * Güncelleme GÜVENLİK reddi şeridi — imzalı künyesi doğrulanamadığı için kurulmayan sürüm.
 *
 * İndirme şeridinin (`UpdateDownloadStrip`) "hata gösterme" kuralının BİLİNÇLİ istisnasıdır: o kural internete
 * çıkamayan makinede her açılışta kırmızı görmeyi (körleşmeyi) önler; imza reddi ise ağ arızası değil, yayın
 * zincirinde bir sorunun (ele geçmiş sunucu ya da yanlış yayın) işaretidir ve fark edilmelidir. Panel çalışmaya
 * devam eder; şerit yalnız bilgi verir. Ayrıntı: Genel Ayarlar → Bu Bilgisayar → Güncelleme.
 */
export function UpdateSecurityStrip() {
  const { status } = useUpdater();
  const red = status?.imzaReddi;
  if (!red) return null;
  return (
    <div
      role="alert"
      data-testid="guncelleme-imza-reddi"
      className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-foreground"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-semibold">Güncelleme güvenlik denetiminden geçmedi ve KURULMADI</strong>
        {red.surum ? ` (sürüm ${red.surum})` : ""}
        <span className="text-muted-foreground"> — panel bu sürümle çalışmaya devam ediyor; bilgi işlem sorumlusuna bildirin.</span>
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{red.kod}</span>
    </div>
  );
}
