import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem, springSnappy } from "@/lib/motion";
import { useDrillTarget } from "@/components/layout/tabs/use-tab-target";

// Hub kartları için renkli ama tutarlı ton paleti. Her kart kendi tonunu
// (ikon chip + dev watermark + ok rengi) bu listeden index'e göre alır;
// istasyon renkleri + tema accent karışımı → dashboard'la aynı dil.
const HUB_TONES = [
  "text-primary",
  "text-info",
  "text-station-tambur",
  "text-success",
  "text-station-fason",
  "text-station-kk1",
  "text-warning",
  "text-station-depo",
] as const;

/** index → ton class (palet döner). */
export function hubTone(index: number): string {
  return HUB_TONES[index % HUB_TONES.length]!;
}

/** Stagger'lı responsive grid sarmalayıcı — doğrudan çocukları HubCard olmalı. */
export function HubGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {children}
    </motion.div>
  );
}

interface HubCardProps {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Açık ton class (örn "text-station-tambur"). Verilmezse index'e göre palet. */
  tone?: string;
  /** Ton paleti için sıra. */
  index?: number;
  /** Sağ üst köşeye yerleşen sürükleme tutamacı (yalnız sıralanabilir grid'lerde).
   *  Verilince köşedeki hover oku yerine bu gösterilir. */
  dragHandle?: ReactNode;
  /** Bekleyen iş sayısı (ör. yeniden bağlama talebi); 0/undefined → gösterilmez. */
  badge?: number;
  /** Sayacın ekran okuyucu metni. */
  badgeLabel?: string;
  /** Verilirse kart KAPALIDIR: soluk çizilir, tıkta bu mesaj gösterilir, gezinme olmaz. */
  offHint?: string;
  /** Kartın altında küçük durum notu (ör. "Kapalı — …"); açıklamanın aksine BASILIR. */
  note?: string;
}

/** Dashboard tarzı zengin hub kartı — gradient + tonlu ikon + watermark + hareket.
 *  Açıklama (subtitle) bilinçli olarak BASILMAZ — başlık zaten kendini anlatıyor. */
export function HubCard({ to, title, icon: Icon, tone, index = 0, dragHandle, badge, badgeLabel, offHint, note }: HubCardProps) {
  const toneClass = tone ?? hubTone(index);
  // Sol tık YERİNDE iner (hub → sayfa aynı sekmede; geri oku gerçek geçmişe basar),
  // sağ/orta tık yeni sekmede açar. Bkz. `useDrillTarget` notu.
  const target = useDrillTarget(to);
  return (
    <motion.div
      variants={staggerItem}
      whileHover={offHint ? undefined : { y: -3 }}
      transition={springSnappy}
      className="relative h-full"
    >
      <button
        type="button"
        {...(offHint ? { onClick: () => toast.info(offHint), title: offHint, "aria-disabled": true } : target)}
        className="group block h-full w-full text-left"
      >
        {/* Soluk görünüm KART üstünde: dış motion.div'in opacity'sini giriş animasyonu ezer. */}
        <Card className={cn("card-glow relative h-full overflow-hidden bg-gradient-to-br from-primary/5 to-transparent p-4", offHint && "border-dashed opacity-50 grayscale")}>
          {/* Dev ikon filigranı — sağ alt, tona boyalı, hover'da hafif büyür */}
          <Icon
            aria-hidden
            className={cn(
              "pointer-events-none absolute -bottom-4 -right-3 h-24 w-24 opacity-[0.06] transition-transform duration-300 group-hover:scale-110",
              toneClass,
            )}
          />
          <div className="relative flex items-start justify-between">
            <div
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl bg-current/10",
                toneClass,
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            {!dragHandle && !offHint && (
              <ArrowRight
                className={cn(
                  "h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100",
                  toneClass,
                )}
              />
            )}
          </div>
          <div className="relative mt-4 flex items-center gap-2">
            <div className="font-medium">{title}</div>
            {offHint ? <span className="text-[11px] text-muted-foreground">kapalı</span> : null}
            {badge ? (
              <span
                className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums"
                aria-label={badgeLabel ?? `${badge} bekleyen`}
                title={badgeLabel}
              >
                {badge}
              </span>
            ) : null}
          </div>
          {note && <p className="relative mt-1 text-xs text-muted-foreground">{note}</p>}
          {/* UX-2 K3: kapalı karo nereden açılacağını BASAR ("kapalı — Sistem → Modüller"); title/toast yalnız tekrarı. */}
          {offHint && offHint !== "kapalı" ? <p className="relative mt-1 text-xs text-muted-foreground" data-testid="hub-off-hint">{offHint}</p> : null}
        </Card>
      </button>
      {/* Sürükleme tutamacı — kart butonunun KARDEŞİ (içinde değil): iç içe
          buton/interactive sorunu olmaz, tutamaca tık karta yayılmaz. */}
      {dragHandle && <div className="absolute right-2 top-2 z-20">{dragHandle}</div>}
    </motion.div>
  );
}
