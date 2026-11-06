// Çok partili belge (çok blok, 2026-11-06): blok başına parti no, sipariş, işlem, müşteri İE no, satır/beyan adet, Σ m/kg,
// sunucunun canlı uyarıları ve partiye bağlı İE'ler (sunucu zincirinden; panel türetmez). Tek partili belgede çizilmez.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNumber } from "@/lib/format";
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
      {v.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-400">• {w}</p>)}
    </section>
  );
}

export function partyFacts(p: NoteParty): string[] {
  return [
    p.batchNo ? `Parti ${p.batchNo}` : "Parti no yok",
    p.orderNo ? `Sipariş ${p.orderNo}` : null,
    p.processText ? `İşlem: ${p.processText}` : null,
    p.senderWorkOrderNo ? `Müşteri İE ${p.senderWorkOrderNo}` : null,
    `${p.lineCount} satır${p.declaredTopCount !== null ? ` / ${p.declaredTopCount} TOP` : ""}`,
    p.meters > 0 ? fmtMeters(p.meters) : "metre yok",
    p.weightKg !== null ? `${formatNumber(p.weightKg, 2)} kg` : null,
  ].filter((x): x is string => !!x);
}

function PartyItem({ p }: { p: NoteParty }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs" data-testid={`parti-${p.blockNo}`}>
      <div className="font-medium">{`${p.blockNo}. parti`}</div>
      <div className="tabular-nums">{partyFacts(p).join(" · ")}</div>
      {p.warnings.map((w) => <div key={w} className="text-amber-700 dark:text-amber-400">• {w}</div>)}
      {p.workOrders && p.workOrders.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2" data-testid={`parti-ie-${p.blockNo}`}>
          {p.workOrders.map((w) => (
            <Link key={w.id} to={`/operations/work-orders/${w.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{w.workOrderNumber}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
