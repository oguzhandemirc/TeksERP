// Sapma tablosu — liste standardı: ListBody içinde kenardan kenara (dar ekranda ListBody yatay kayar). "Onayla" yalnız OFFICE kipli bekleyen satırda.
import { formatFactory } from "@/lib/factory-time";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { MODE_LABEL, STATUS_HINT, STATUS_LABEL, STATUS_TONE_CLASS, canOfficeAck, fmtDiff, fmtMeters, sourceBadge, thresholdText } from "./deviation-labels";
import type { MeterDeviationRow } from "./types";

interface Props {
  rows: MeterDeviationRow[];
  onAck: (row: MeterDeviationRow) => void;
}

function inText(r: MeterDeviationRow): string {
  return r.basis === "MEASURED_IN" && r.measuredIn != null ? `${fmtMeters(r.measuredIn)} (ölçülen)` : `${fmtMeters(r.declaredIn)} (bildirilen)`;
}

function Signature({ r }: { r: MeterDeviationRow }) {
  if (!r.ack) return <span className="text-muted-foreground">—</span>;
  return (
    <span title={r.ack.reasonText ?? undefined}>
      {MODE_LABEL[r.ack.mode]}
      {r.ack.approvedByName ? ` · ${r.ack.approvedByName}` : ""}
      {r.ack.reasonCode || r.ack.reasonText ? <span className="block text-xs text-muted-foreground">{r.ack.reasonCode ?? r.ack.reasonText}</span> : null}
    </span>
  );
}

export function DeviationTable({ rows, onAck }: Props) {
  return (
    <table className="w-full min-w-[960px] text-sm">
      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="p-3 text-left">Zaman</th>
          <th className="p-3 text-left">Top</th>
          <th className="p-3 text-left">Makine</th>
          <th className="p-3 text-left">Müşteri</th>
          <th className="p-3 text-right">Giriş</th>
          <th className="p-3 text-right">Çıkış</th>
          <th className="p-3 text-right">Fark</th>
          <th className="p-3 text-left">Eşik · kip</th>
          <th className="p-3 text-left">Kaynak</th>
          <th className="p-3 text-left">Durum</th>
          <th className="p-3 text-left">İmza</th>
          <th className="p-3" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const src = sourceBadge(r.source);
          return (
            <tr key={r.readingId} className="border-t align-top" data-testid="deviation-row">
              <td className="whitespace-nowrap p-3">{formatFactory(r.createdAt, "dd.MM.yyyy HH:mm")}</td>
              <td className="p-3">
                <span className="font-mono">{r.barcode ?? "—"}</span>
                {r.workOrderNumber ? <span className="block text-xs text-muted-foreground">{r.workOrderNumber}</span> : null}
              </td>
              <td className="p-3">{r.machineName ?? "—"}</td>
              <td className="p-3">{r.customerName ?? "—"}</td>
              <td className="whitespace-nowrap p-3 text-right tabular-nums">{inText(r)}</td>
              <td className="whitespace-nowrap p-3 text-right tabular-nums">{fmtMeters(r.outMeters)}</td>
              <td className="whitespace-nowrap p-3 text-right font-medium tabular-nums">{fmtDiff(r.diffMeters)}</td>
              <td className="p-3">
                {thresholdText(r)}
                <span className="block text-xs text-muted-foreground">{MODE_LABEL[r.approvalMode]}</span>
              </td>
              <td className="p-3">
                <span className={`rounded px-2 py-0.5 text-xs ${src.className}`} title={src.hint}>
                  {src.label}
                </span>
              </td>
              <td className="p-3">
                <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${STATUS_TONE_CLASS[r.status]}`} title={STATUS_HINT[r.status]}>
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="p-3">
                <Signature r={r} />
              </td>
              <td className="p-3 text-right">
                {canOfficeAck(r) ? (
                  <PermissionGate permission="kursun:meter-approve">
                    <Button size="sm" onClick={() => onAck(r)}>
                      Onayla
                    </Button>
                  </PermissionGate>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
