import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted" | "progress";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-transparent",
  info: "bg-info-soft text-info-soft-foreground border-transparent",
  success: "bg-success-soft text-success-soft-foreground border-transparent",
  warning: "bg-warning-soft text-warning-soft-foreground border-transparent",
  danger: "bg-destructive-soft text-destructive-soft-foreground border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
  // "Yolda / kısmen tamamlandı" ara durumu (ör. Kısmi Sevk); mavi(info) ve amber(warning) dolu
  // olduğundan ayrık kalması için mor simge karesi tonu (pastel zemin + doygun yazı).
  progress: "icon-tile tile-violet border-transparent",
};

interface Props {
  status: string;
  labels?: Record<string, string>;
  tones?: Record<string, Tone>;
  defaultTone?: Tone;
  className?: string;
}

export function StatusBadge({ status, labels, tones, defaultTone = "neutral", className }: Props) {
  const text = labels?.[status] ?? status;
  const tone = tones?.[status] ?? defaultTone;
  return <Badge className={cn(toneClasses[tone], className)}>{text}</Badge>;
}

// Konfig export'lar — sayfalar import edip kullanır
export const orderStatusTones = {
  PENDING: "warning",
  APPROVED: "info",
  PARTIAL_SHIPPED: "progress",
  COMPLETED: "success",
  CANCELLED: "muted",
} as const satisfies Record<string, Tone>;

export const workOrderStatusTones = {
  PLANNED: "muted",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
  // SUPERSEDED (Devredildi): iptal DEĞİL — kırmızı(danger) yerine nötr; malzeme
  // yeni iş emrine taşındı, "emekli" bir durum. Etiket ayrımı yeterli.
  SUPERSEDED: "muted",
} as const satisfies Record<string, Tone>;

export const rollStatusTones = {
  STOCK: "info",
  IN_PRODUCTION: "info",
  SCRAP: "danger",
  CANCELLED: "muted",
  AT_SUBCONTRACTOR: "warning",
  A1_STOCK: "warning",
  RETURNED_FROM_SUBCONTRACTOR: "muted",
  WAREHOUSE: "info",
  SHIPPED: "success",
  TAMBUR_CONSUMED: "muted",
  SUBCONTRACTOR_CONSUMED: "muted",
  AT_KARTELA: "warning",
  KARTELA_CONSUMED: "muted",
} as const satisfies Record<string, Tone>;

export const stepStatusTones = {
  PENDING: "muted",
  ACTIVE: "info",
  COMPLETED: "success",
  SKIPPED: "muted",
} as const satisfies Record<string, Tone>;
