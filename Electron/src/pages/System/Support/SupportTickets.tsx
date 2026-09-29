import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFormat } from "@/lib/format";
import { supportService } from "@/services/supportService";
import { SUPPORT_STATUS_LABEL, supportStatusTone, type SupportTicket } from "./types";

export const SUPPORT_LIST_KEY = ["destek", "liste"] as const;
const formatDateTime = (iso: string | null): string => safeFormat(iso, "dd.MM.yyyy HH:mm");

/** Talep satırının ikinci satırı: numara, açılış, gönderim durumu (hata yalnız KOD olarak). */
export function ticketMeta(t: SupportTicket): string {
  const parts = [t.ticketNo ?? "Numara bekleniyor", formatDateTime(t.createdAt), t.createdBy.fullName];
  if (t.status === "GONDERILMEDI" && t.lastErrorCode) parts.push(`son deneme: ${t.lastErrorCode}`);
  return parts.join(" · ");
}

export function SupportTicketList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const q = useQuery({ queryKey: SUPPORT_LIST_KEY, queryFn: () => supportService.list(), refetchInterval: 60_000 });
  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Talepler</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {q.isLoading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : null}
        {!q.isLoading && rows.length === 0 ? <p className="text-sm text-muted-foreground">Henüz talep yok.</p> : null}
        {rows.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`w-full rounded border px-3 py-2 text-left hover:bg-muted ${selectedId === t.id ? "border-primary" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{t.subject}</span>
              <Badge variant={supportStatusTone(t.status)}>{SUPPORT_STATUS_LABEL[t.status]}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {ticketMeta(t)}
              {t._count && t._count.replies > 0 ? ` · ${t._count.replies} yanıt` : ""}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export function SupportTicketDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["destek", "ayrinti", id], queryFn: () => supportService.detail(id), refetchInterval: 60_000 });
  const t = q.data;
  if (!t) return <p className="text-sm text-muted-foreground">{q.isLoading ? "Yükleniyor…" : "Talep okunamadı."}</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>{t.ticketNo ? `${t.ticketNo} · ${t.subject}` : t.subject}</span>
          <Badge variant={supportStatusTone(t.status)}>{SUPPORT_STATUS_LABEL[t.status]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap text-sm">{t.description}</p>
        <p className="text-xs text-muted-foreground">{ticketMeta(t)}</p>
        {t.status === "GONDERILMEDI" ? (
          <p className="text-xs text-muted-foreground">Satıcıya henüz ulaşılamadı; bir sonraki lisans yoklamasında yeniden gönderilecek.</p>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Satıcı yanıtları</h3>
          {(t.replies ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Henüz yanıt yok.</p> : null}
          {(t.replies ?? []).map((r) => (
            <div key={r.id} className="rounded border bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">{formatDateTime(r.repliedAt)}</div>
              <p className="whitespace-pre-wrap text-sm">{r.body}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
