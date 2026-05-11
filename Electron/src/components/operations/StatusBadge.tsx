import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-foreground/10 text-foreground border-transparent",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-transparent",
  success: "bg-green-500/15 text-green-600 dark:text-green-400 border-transparent",
  warning: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-transparent",
  danger: "bg-red-500/15 text-red-600 dark:text-red-400 border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
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
  PARTIAL_SHIPPED: "info",
  COMPLETED: "success",
  CANCELLED: "muted",
} as const satisfies Record<string, Tone>;

export const workOrderStatusTones = {
  PLANNED: "muted",
  IN_PROGRESS: "info",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "muted",
} as const satisfies Record<string, Tone>;

export const rollStatusTones = {
  STOCK: "info",
  IN_PRODUCTION: "info",
  PRODUCED: "info",
  READY_FOR_SHIP: "success",
  SHIPPED: "neutral",
  SCRAP: "danger",
  CANCELLED: "muted",
  AT_SUBCONTRACTOR: "warning",
  A1_STOCK: "warning",
  RETURNED_FROM_SUBCONTRACTOR: "muted",
  WAREHOUSE: "info",
  TAMBUR_CONSUMED: "muted",
} as const satisfies Record<string, Tone>;

export const shipmentStatusTones = {
  PREPARING: "warning",
  SHIPPED: "success",
  CANCELLED: "muted",
} as const satisfies Record<string, Tone>;

export const packagingQueueTones = {
  WAITING: "warning",
  TAKEN: "info",
  DONE: "success",
  CANCELLED: "muted",
} as const satisfies Record<string, Tone>;

export const shippingQueueTones = {
  WAITING: "warning",
  TAKEN: "info",
  DONE: "success",
  CANCELLED: "muted",
} as const satisfies Record<string, Tone>;

export const stepStatusTones = {
  PENDING: "muted",
  ACTIVE: "info",
  COMPLETED: "success",
  SKIPPED: "muted",
} as const satisfies Record<string, Tone>;
