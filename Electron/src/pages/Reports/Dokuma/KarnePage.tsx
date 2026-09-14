// =============================================================================
// KARNE LİSTESİ VE MÜHÜR — vardiya × tezgah; anlık/mühürlü; düzelt · mühürle · mühür aç
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DetailTable, ReportPageLayout } from "../_components";
import { WarningsBlock, useFactoryRange } from "./DokumaShared";
import { KarneDialogs } from "./KarneDialogHost";
import { buildKarneColumns } from "./KarneTable";
import { dokumaReportsApi, type SealLedgerRow, type ShiftStatRow } from "./service";

export type KarneDialogState =
  | { kind: "correct"; target: ShiftStatRow }
  | { kind: "seal"; target: ShiftStatRow }
  | { kind: "unseal"; target: ShiftStatRow }
  | { kind: "ledger"; target: ShiftStatRow }
  | null;

function LedgerDialog({ target, onClose }: { target: ShiftStatRow; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["reports", "dokuma", "seals", target.statId],
    queryFn: () => dokumaReportsApi.seals(target.statId!),
    enabled: target.statId !== null,
  });
  const rows: SealLedgerRow[] = data?.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Mühür defteri — {target.machine.name} · {target.shiftInstance.shiftDefinition.name}</DialogTitle></DialogHeader>
        <ul className="space-y-1 text-xs">
          {rows.length === 0 && <li className="text-muted-foreground">Henüz mühür satırı yok.</li>}
          {rows.map((r) => (
            <li key={r.id} className="rounded border px-2 py-1">
              <b>{r.action}</b> · kuşak {r.sealGeneration} · {new Date(r.createdAt).toLocaleString("tr-TR")} · POT {r.potSec} sn · APT {r.aptSec} sn · atkı {r.unitsActual}
              {r.reason ? <> · gerekçe: {r.reason}</> : null}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function KarnePage() {
  const range = useFactoryRange(7);
  const [dialog, setDialog] = useState<KarneDialogState>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "dokuma", "karne", range.from, range.to],
    queryFn: () => dokumaReportsApi.shiftStats({ from: range.from, to: range.to }),
    enabled: range.ready,
    staleTime: 15_000,
  });
  const rows = useMemo(() => data?.data ?? [], [data]);
  const columns = useMemo(
    () => buildKarneColumns({
      onCorrect: (target) => setDialog({ kind: "correct", target }),
      onSeal: (target) => setDialog({ kind: "seal", target }),
      onUnseal: (target) => setDialog({ kind: "unseal", target }),
      onLedger: (target) => setDialog({ kind: "ledger", target }),
    }),
    [],
  );
  const allWarnings = useMemo(() => [...new Set(rows.flatMap((r) => r.warnings))].slice(0, 8), [rows]);

  return (
    <ReportPageLayout
      title="Karne Listesi ve Mühür"
      description="Mühürsüz satır anlık hesaplanır; mühürlü satır resmî rakamdır. Vardiya bitiminden 60 dk sonra kapanış işi karneyi yazar; amir düzeltip mühürler."
      defaultDays={7}
    >
      <WarningsBlock warnings={allWarnings} />
      <DetailTable<ShiftStatRow> title={`Vardiya × tezgah${data ? ` (${data.meta.total}; anlık ${data.meta.live}, mühürlü ${data.meta.sealed})` : ""}`} data={rows} columns={columns} isLoading={isLoading} />
      {dialog?.kind === "ledger" && <LedgerDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind !== "ledger" && <KarneDialogs dialog={dialog} onClose={() => setDialog(null)} />}
    </ReportPageLayout>
  );
}
