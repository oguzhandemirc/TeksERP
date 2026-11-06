// Çok partili belge (çok blok, 2026-11-06): blok başına parti no, sipariş, işlem, müşteri İE no, satır/beyan adet, Σ m/kg,
// sunucunun canlı uyarıları ve partiye bağlı İE'ler (sunucu zincirinden; panel türetmez). Tek partili belgede çizilmez.
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNumber } from "@/lib/format";
import { TERIM } from "@/lib/terim";
import { fmtMeters } from "./partiMetre";
import { getNoteParties, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { NoteParty } from "./partiesTypes";

export function PartiesCard({ noteId }: { noteId: string }) {
  const q = useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "partiler", noteId], queryFn: () => getNoteParties(noteId), retry: false });
  const v = q.data;
  if (!v?.multi || v.parties.length < 2) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="partiler-karti">
      <h3 className="text-sm font-semibold">{`Bu belgede ${v.parties.length} parti var`}</h3>
      {v.parties.map((p) => <PartyItem key={p.blockNo} p={p} />)}
      {v.warnings.map((w) => (
        <p key={w} className={`flex items-start gap-1 text-xs ${WARN_TEXT}`}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {w}
        </p>
      ))}
    </section>
  );
}

export interface PartyFact {
  text: string;
  /** Eksik bilgi (metre yok) — uyarı tonunda çizilir. */
  warn?: boolean;
}

/** Künye parçaları (parti no hariç — o başlıkta). Her parça ayrı kutu: dar ekranda kelime ortasından kırılmaz. */
export function partyFactItems(p: NoteParty): PartyFact[] {
  const items: (PartyFact | null)[] = [
    p.orderNo ? { text: `Sipariş ${p.orderNo}` } : null,
    p.processText ? { text: `İşlem: ${p.processText}` } : null,
    p.senderWorkOrderNo ? { text: `Müşteri İE ${p.senderWorkOrderNo}` } : null,
    { text: `${p.lineCount} satır${p.declaredTopCount !== null ? ` / ${p.declaredTopCount} TOP` : ""}` },
    p.meters > 0 ? { text: fmtMeters(p.meters) } : { text: "metre yok", warn: true },
    p.weightKg !== null ? { text: `${formatNumber(p.weightKg, 2)} kg` } : null,
  ];
  return items.filter((x): x is PartyFact => !!x);
}

export function partyFacts(p: NoteParty): string[] {
  return [p.batchNo ? `Parti ${p.batchNo}` : "Parti no yok", ...partyFactItems(p).map((f) => f.text)];
}

const WARN_TEXT = "text-amber-800 dark:text-amber-300";

function PartyItem({ p }: { p: NoteParty }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid={`parti-${p.blockNo}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{`${p.blockNo}. parti`}</span>
        {p.batchNo ? (
          <span className="font-mono font-semibold tabular-nums" title="Parti no">{p.batchNo}</span>
        ) : (
          <span className={`rounded bg-amber-100 px-1.5 text-xs font-medium dark:bg-amber-950 ${WARN_TEXT}`}>Parti no yok</span>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Parti künyesi">
        {partyFactItems(p).map((f) => (
          <li
            key={f.text}
            className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs tabular-nums ${f.warn ? `border-amber-300 bg-amber-50 dark:bg-amber-950 ${WARN_TEXT}` : "bg-background"}`}
          >
            {f.text}
          </li>
        ))}
      </ul>
      {p.warnings.map((w) => (
        <div key={w} className={`flex items-start gap-1 text-xs ${WARN_TEXT}`}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {w}
        </div>
      ))}
      {p.workOrders && p.workOrders.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs" data-testid={`parti-ie-${p.blockNo}`}>
          <span className="text-muted-foreground">{`${TERIM.terbiyeIsEmri.tekil}:`}</span>
          {p.workOrders.map((w) => (
            <Link key={w.id} to={`/operations/work-orders/${w.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{w.workOrderNumber}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
