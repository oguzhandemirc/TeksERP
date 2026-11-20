import { formatFactory } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { AttachmentPreview } from "./AttachmentPreview";
import type { TicketMessage } from "./types";

export function formatWhen(iso: string): string {
  return formatFactory(iso, "dd.MM.yyyy HH:mm", "");
}

/** Yazışma satırı: müşteri SAĞDA, destek ekibi SOLDA, sistem kaydı ORTADA küçük. */
export function MessageBubble({ m }: { m: TicketMessage }) {
  if (m.kind === "SYSTEM") {
    return (
      <li className="flex justify-center" data-kind="SYSTEM">
        <span className="rounded-badge bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">
          {m.body} · {formatWhen(m.createdAt)}
        </span>
      </li>
    );
  }
  const mine = m.kind === "CUSTOMER";
  return (
    <li className={cn("flex", mine ? "justify-end" : "justify-start")} data-kind={m.kind}>
      <div
        className={cn(
          "max-w-[78%] space-y-2 rounded-lg border px-3 py-2 shadow-sm",
          mine ? "rounded-br-sm border-primary/25 bg-primary/10" : "rounded-bl-sm bg-card",
        )}
      >
        <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{m.authorName ?? (mine ? "Siz" : "Destek ekibi")}</span>
          {!mine && <span className="rounded bg-muted px-1">Destek ekibi</span>}
          <span>{formatWhen(m.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
        {m.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((a) => (
              <AttachmentPreview key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
