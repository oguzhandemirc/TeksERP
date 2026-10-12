import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Callout, type CalloutTone } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<CalloutTone, string> = {
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

interface Props {
  id: "sunucu" | "panel";
  icon: LucideIcon;
  title: string;
  version: string | null;
  status: { label: string; tone: CalloutTone; hint?: string | null };
  /** En fazla iki düğme (onay ya da kur/yeniden başlat) veya "Yöneticiniz onaylayacak" notu. */
  actions?: ReactNode;
  /** Sorun varsa tek cümle + tek eylem. */
  problem?: { text: string; tone: CalloutTone; action?: ReactNode } | null;
  /** Satırın altındaki küçük bağlantılar (ör. "Neler yeni?"). */
  footer?: ReactNode;
}

/** Güncellemeler sayfasının bir satırı: ne kurulu, durum ne, ne yapılabilir — başka bilgi yok. */
export function UpdateRow({ id, icon: Icon, title, version, status, actions, problem, footer }: Props) {
  return (
    <div data-testid={`guncelleme-satiri-${id}`} className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-[12rem] items-center gap-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">
              Kurulu sürüm <span className="font-mono">{version ?? "—"}</span>
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div data-testid={`guncelleme-durumu-${id}`} className={cn("text-sm font-medium", TONE_TEXT[status.tone])}>
            {status.label}
          </div>
          {status.hint && <div className="text-xs text-muted-foreground">{status.hint}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {problem && (
        <Callout tone={problem.tone}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span data-testid={`guncelleme-sorunu-${id}`}>{problem.text}</span>
            {problem.action}
          </div>
        </Callout>
      )}
      {footer && <div className="text-xs">{footer}</div>}
    </div>
  );
}
