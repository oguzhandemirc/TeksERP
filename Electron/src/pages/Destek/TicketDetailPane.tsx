import { useEffect, useRef, useState } from "react";
import { CircleCheck, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { cn } from "@/lib/utils";
import { readDestekError } from "./errors";
import { STATUS_CLASS, STATUS_LABEL, TYPE_LABEL, reopenDeadline } from "./labels";
import { MessageBubble, formatWhen } from "./MessageBubble";
import { ReplyBox } from "./ReplyBox";
import { useCloseTicket, useTicketDetail } from "./useTicketQueries";
import type { TicketView } from "./types";

function closedNote(t: TicketView): string | null {
  if (t.status !== "CLOSED") return null;
  const until = reopenDeadline(t.closedAt);
  if (!until) return "Bu talep kapandı. Yanıt yazarsanız yeniden açılır.";
  if (until.getTime() < Date.now()) return "Bu talep kapanalı 14 günden fazla oldu; yanıt yazmak için yeni talep açın.";
  return `Bu talep kapandı. ${formatWhen(until.toISOString())} tarihine kadar yanıt yazarsanız yeniden açılır.`;
}

function Header({ t, onClose, closing }: { t: TicketView; onClose: () => void; closing: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{t.number}</span>
          <span>· {TYPE_LABEL[t.type]}</span>
          <Badge className={cn(STATUS_CLASS[t.status])}>{STATUS_LABEL[t.status]}</Badge>
        </div>
        <h2 className="mt-1 truncate text-base font-semibold" title={t.subject}>{t.subject}</h2>
      </div>
      {t.status !== "CLOSED" && (
        <Button type="button" size="sm" variant="outline" disabled={closing} onClick={onClose}>
          <CircleCheck className="mr-1.5 h-4 w-4" /> Çözüldü, kapat
        </Button>
      )}
    </div>
  );
}

export function TicketDetailPane({ id, canTenant }: { id: string | null; canTenant: boolean }) {
  const q = useTicketDetail(id, canTenant);
  const closer = useCloseTicket(id ?? "", canTenant);
  const [confirm, setConfirm] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const count = q.data?.messages.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count, id]);

  if (!id) return <EmptyState icon={MessagesSquare} title="Bir talep seçin" description="Yazışmayı görmek için soldaki listeden bir talep seçin." />;
  if (q.isPending) return <p className="p-6 text-sm text-muted-foreground">Yükleniyor…</p>;
  if (q.isError) return <div className="p-4"><Callout tone="danger">{readDestekError(q.error).message}</Callout></div>;
  const t = q.data;
  const expired = t.status === "CLOSED" && (reopenDeadline(t.closedAt)?.getTime() ?? Infinity) < Date.now();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header t={t} closing={closer.isPending} onClose={() => setConfirm(true)} />
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <ul className="space-y-3" aria-label="Yazışma">
          {t.messages.map((m) => <MessageBubble key={m.id} m={m} />)}
        </ul>
        <div ref={endRef} />
      </div>
      {closer.error && <div className="px-4 pb-2"><Callout tone="danger">{closer.error.message}</Callout></div>}
      {expired ? (
        <p className="border-t p-3 text-xs text-muted-foreground">{closedNote(t)}</p>
      ) : (
        <ReplyBox key={t.id} ticketId={t.id} canTenant={canTenant} closedNote={closedNote(t)} />
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Talep kapatılsın mı?"
        description={`${t.number} · ${t.subject}\nSorununuz çözüldüyse talebi kapatın. Kapandıktan sonra 14 gün içinde yanıt yazarak yeniden açabilirsiniz.`}
        confirmLabel="Çözüldü, kapat"
        isPending={closer.isPending}
        onConfirm={async () => {
          await closer.close().catch(() => undefined);
          setConfirm(false);
        }}
      />
    </div>
  );
}
