// Maliyet sayfalarının ortak yükleme/hata durumu: kapalı modül (403 MODULE_DISABLED) "kapalı — <ayar yolu>"
// der; diğer hata "kayıt yok" gibi okunmasın diye ayrı kutu + tekrar dene.
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { isModuleDisabled } from "./errors";
import { MALIYET_CLOSED_TITLE, maliyetSettingPath, maliyetSettingTrail } from "./cost-flag";

export function CostModuleClosed() {
  return (
    <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-6 text-center text-sm">
      <p className="font-medium">{MALIYET_CLOSED_TITLE}</p>
      <p className="mt-1 text-muted-foreground">
        Açmak için: <Link className="underline" to={maliyetSettingPath()}>{maliyetSettingTrail()}</Link> → "Maliyet & Teklif".
      </p>
    </div>
  );
}

export function CostQueryError({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  if (isModuleDisabled(error)) return <CostModuleClosed />;
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
      <p className="font-medium text-destructive">{what} yüklenemedi.</p>
      <p className="mt-1 text-muted-foreground">Bu bir "kayıt yok" cevabı değildir — istek sunucuya ulaşamadı ya da reddedildi.</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Tekrar dene</Button>
    </div>
  );
}
