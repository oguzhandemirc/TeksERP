import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted" | "progress";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-foreground/10 text-foreground border-transparent",
  info: "bg-info/15 text-info border-transparent",
  success: "bg-success/15 text-success border-transparent",
  warning: "bg-warning/15 text-warning border-transparent",
  danger: "bg-destructive/15 text-destructive border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
  // Mor — "yolda / kısmen tamamlandı" ara durumu (ör. Kısmi Sevk); mavi(info) ve
  // amber(warning) dolu olduğundan ayrık kalması için station-process token'ı.
  progress: "bg-station-process/15 text-station-process border-transparent",
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
  TAMBUR_CONSUMED: "muted",
  AT_KARTELA: "warning",
  KARTELA_CONSUMED: "muted",
} as const satisfies Record<string, Tone>;

export const stepStatusTones = {
  PENDING: "muted",
  ACTIVE: "info",
  COMPLETED: "success",
  SKIPPED: "muted",
} as const satisfies Record<string, Tone>;
