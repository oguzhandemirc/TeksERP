import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem, springSnappy } from "@/lib/motion";

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
}

/** Dashboard tarzı zengin hub kartı — gradient + tonlu ikon + watermark + hareket. */
export function HubCard({ to, title, description, icon: Icon, tone, index = 0 }: HubCardProps) {
  const toneClass = tone ?? hubTone(index);
  return (
    <motion.div variants={staggerItem} whileHover={{ y: -3 }} transition={springSnappy}>
      <Link to={to} className="group block h-full">
        <Card className="card-glow relative h-full overflow-hidden bg-gradient-to-br from-primary/5 to-transparent p-4">
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
            <ArrowRight
              className={cn(
                "h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100",
                toneClass,
              )}
            />
          </div>
          <div className="relative mt-4">
            <div className="font-medium">{title}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}
