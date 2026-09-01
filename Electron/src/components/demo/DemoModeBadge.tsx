import { FlaskConical } from "lucide-react";
import { useDemoModeEnabled } from "@/hooks/usePricingEnabled";

/**
 * Üst şeritte "DEMO" rozeti.
 *
 * ⚠️ NEDEN VAR: unutulmuş bir demo modu SESSİZ kalamaz. Bayrak yanlışlıkla
 * açık bırakılırsa (ya da bir fabrika kurulumunda açılırsa) ekranda örnek veri
 * üreten düğmeler belirir; rozet olmadan bunun sebebi hiçbir yerde yazmaz ve
 * operatör "program kendi kendine kayıt açıyor" der.
 *
 * ⚠️ İLK SATIR KAPI: `useDemoModeEnabled()` false ise HİÇBİR ŞEY çizilmez —
 * kanca `?? false` ile fail-closed, yani sunucuya ulaşılamadığında da sessizdir.
 */
export function DemoModeBadge() {
  if (!useDemoModeEnabled()) return null;
  return (
    <span
      data-demo-helper="badge"
      title="Bu kurulum DEMO modunda: ekranlarda örnek veri üreten yardımcılar görünür. Genel Ayarlar → Demo'dan kapatılır."
      className="flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400"
    >
      <FlaskConical className="h-3 w-3" />
      Demo
    </span>
  );
}
