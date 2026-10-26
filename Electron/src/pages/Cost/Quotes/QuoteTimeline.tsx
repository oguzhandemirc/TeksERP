// Zaman çizelgesi: geçiş damgaları teklif kaydının KENDİ kolonlarından (audit'ten okunmaz — ayak izidir);
// "kim" detay yanıtının `aktorler` haritasından. Revizyon zinciri (önceki/yeni sürüm) bağlantıdır.
import { Link } from "react-router-dom";
import { formatFactory } from "@/lib/factory-time";
import { QUOTE_STATUS_LABEL } from "./labels";
import type { QuoteDetail } from "./quote-types";

interface Ev { key: string; label: string; at: string; by: string | null; note?: string | null }

export function timelineEvents(q: QuoteDetail, actors: Record<string, string>): Ev[] {
  const who = (id: string | null) => (id ? (actors[id] ?? null) : null);
  const evs: Array<Ev | null> = [
    { key: "created", label: q.revisionNo > 1 ? `Revizyon R${q.revisionNo} açıldı` : "Taslak oluşturuldu", at: q.createdAt, by: who(q.createdById) },
    q.sentAt ? { key: "sent", label: "Gönderildi", at: q.sentAt, by: who(q.sentById) } : null,
    q.acceptedAt ? { key: "accepted", label: "Kabul edildi", at: q.acceptedAt, by: who(q.acceptedById) } : null,
    q.rejectedAt ? { key: "rejected", label: "Reddedildi", at: q.rejectedAt, by: who(q.rejectedById), note: q.rejectReason } : null,
    q.cancelledAt ? { key: "cancelled", label: "İptal edildi", at: q.cancelledAt, by: who(q.cancelledById), note: q.cancelReason } : null,
    q.convertedAt ? { key: "converted", label: "Siparişe dönüştü", at: q.convertedAt, by: who(q.convertedById) } : null,
    q.supersededAt ? { key: "superseded", label: "Yerine yeni revizyon geldi", at: q.supersededAt, by: null } : null,
  ];
  return evs.filter((e): e is Ev => e !== null).sort((a, b) => a.at.localeCompare(b.at));
}

export function QuoteTimeline({ q, actors }: { q: QuoteDetail; actors: Record<string, string> }) {
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label="Zaman çizelgesi">
      <h2 className="text-sm font-semibold">Zaman çizelgesi</h2>
      <ol className="space-y-1.5">
        {timelineEvents(q, actors).map((e) => (
          <li key={e.key} className="text-sm" data-testid={`tl-${e.key}`}>
            <span className="font-medium">{e.label}</span>
            <span className="text-muted-foreground"> · {formatFactory(e.at, "dd.MM.yyyy HH:mm")}{e.by ? ` · ${e.by}` : ""}</span>
            {e.note && <p className="text-xs text-muted-foreground">Sebep: {e.note}</p>}
          </li>
        ))}
      </ol>
      {(q.revisionOf || q.revisedTo || q.convertedOrder) && (
        <div className="flex flex-wrap gap-3 border-t pt-2 text-sm">
          {q.revisionOf && <Link className="underline" to={`/cost/quotes/${q.revisionOf.id}`}>← Önceki sürüm R{q.revisionOf.revisionNo} ({QUOTE_STATUS_LABEL[q.revisionOf.status]})</Link>}
          {q.revisedTo && <Link className="underline" to={`/cost/quotes/${q.revisedTo.id}`} data-testid="revised-to">Yeni sürüm R{q.revisedTo.revisionNo} ({QUOTE_STATUS_LABEL[q.revisedTo.status]}) →</Link>}
          {q.convertedOrder && (
            <Link className="font-medium text-success underline" to={`/operations/orders?focus=${q.convertedOrder.id}`} data-testid="order-link">
              Sipariş {q.convertedOrder.orderNumber ?? ""} →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
