// Sipariş sayfası "Dönen leventler" bölümü — `GET /:id/receipts`: mutabakat (hedef ↔ gelen metre, iplik başına
// sarılan/devir/dağıtılamayan/deverecide kalan, tartı) + kabuller (eskiden yeniye; levent satırları). Kabul geri
// alma önizlemelidir; LIFO ve kapanış engelini sunucu söyler. "Levent kabulü" OPEN/IN_PROGRESS + `warping-order:write`.
// Devere ek C2: hazır sarım satırında "Devereciye geri gönder" (ret belgesi), reddedilende "Reddedildi" rozeti,
// yeniden sarımda reddedilenin no'su; ret sonrası belge basım için açılır.
import { Fragment, useState } from "react";
import { PackageCheck, Undo2, Undo } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { WARP_BEAM_STATUS_META } from "@/pages/Operations/WarpBeams/types";
import { BeamRejectDialog } from "./BeamRejectDialog";
import { BeamRejectionDocDialog } from "./BeamRejectionDocDialog";
import { yarnNamesOf } from "./holding-model";
import { fmtKg, fmtM } from "./order-model";
import { ReceiptCancelDialog } from "./ReceiptCancelDialog";
import { ReceiveDocDialog } from "./ReceiveDocDialog";
import { warpingReceiveDocPath } from "./receive-doc-service";
import { signedKg } from "./receive-model";
import { useWarpingReceipts } from "./receive-service";
import { activeRejectionByBeam, rejectableBeams } from "./rejection-model";
import { useWarpingRejections } from "./rejection-service";
import { SettlementSummary } from "./SettlementSummary";
import type { WarpingOrder } from "./types";
import type { WarpingReceipt, WarpingReceiptBeam } from "./receive-types";
import type { WarpingBeamRejection } from "./rejection-types";

const num = "text-right tabular-nums";
const kgOr = (v: string | null) => (v === null ? "—" : fmtKg(v));

interface BeamCtx {
  canReject: boolean;
  rejection: Map<string, WarpingBeamRejection>;
  beamNoById: Map<string, string>;
  onReject: (beamId: string) => void;
}

function BeamTags({ b, ctx }: { b: WarpingReceiptBeam; ctx: BeamCtx }) {
  const doc = ctx.rejection.get(b.id);
  const reworkOf = b.reworkOfBeamId ? ctx.beamNoById.get(b.reworkOfBeamId) ?? "reddedilen sarım" : null;
  return (
    <>
      {b.status === "REJECTED" && !b.cancelled && (
        <Badge className={cn("ml-2 font-normal", WARP_BEAM_STATUS_META.REJECTED.badgeClass)} title={doc ? `Ret belgesi ${doc.docNo}` : undefined}>
          Reddedildi{doc ? ` · ${doc.docNo}` : ""}
        </Badge>
      )}
      {reworkOf && <span className="ml-2 text-emerald-700 dark:text-emerald-400">yeniden sarım ← {reworkOf}</span>}
    </>
  );
}

function BeamRow({ b, ctx }: { b: WarpingReceiptBeam; ctx: BeamCtx }) {
  const rejectable = ctx.canReject && !b.cancelled && b.status === "READY";
  return (
    <TableRow className={cn("text-xs", b.cancelled && "text-muted-foreground line-through decoration-muted-foreground/40")}>
      <TableCell className="pl-8">
        {b.beamNo}{b.physicalBeamNo && <span className="text-muted-foreground"> · gövde {b.physicalBeamNo}</span>}
        <BeamTags b={b} ctx={ctx} />
      </TableCell>
      <TableCell className={num}>{b.lengthM === null ? "—" : fmtM(b.lengthM)}</TableCell>
      <TableCell className={num}>{kgOr(b.nominalKg)}</TableCell>
      <TableCell className={num}>{b.grossKg === null ? "—" : `${fmtKg(b.grossKg)}${b.tareKg !== null ? ` / ${fmtKg(b.tareKg)}` : ""}`}</TableCell>
      <TableCell className={num}>{kgOr(b.weighedNetKg)}</TableCell>
      <TableCell className={num}>{b.weighDiffKg === null ? "—" : signedKg(b.weighDiffKg)}</TableCell>
      <TableCell className="whitespace-nowrap text-right">
        {rejectable && (
          <PermissionGate permission="warping-order:write">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-orange-700 dark:text-orange-400" onClick={() => ctx.onReject(b.id)} aria-label={`${b.beamNo} devereciye geri gönder`} title="Kusurlu — devereciye geri gönder (ret belgesi)">
              <Undo className="mr-1 h-3.5 w-3.5" /> Geri gönder
            </Button>
          </PermissionGate>
        )}
      </TableCell>
    </TableRow>
  );
}

function ReceiptHead({ r, canUndo, onUndo }: { r: WarpingReceipt; canUndo: boolean; onUndo: () => void }) {
  const dead = r.liveBeamCount === 0;
  const openTarget = useOpenTarget();
  const doc = r.receiveDoc ?? null;
  return (
    <TableRow className={cn("bg-muted/30", dead && "text-muted-foreground")}>
      <TableCell>
        <span className="font-medium">{r.deliveryNoteNo ? `İrsaliye ${r.deliveryNoteNo}` : "İrsaliyesiz kabul"}</span>{" "}
        <span className="text-xs text-muted-foreground">· {r.liveBeamCount} levent{r.beamCount !== r.liveBeamCount ? ` (${r.beamCount - r.liveBeamCount} iptal)` : ""} ·</span>{" "}
        <span className="text-xs text-muted-foreground">{fmtFactoryDateTime(r.receivedAt)}</span>
        {doc && (
          <button type="button" onClick={(e) => openTarget(warpingReceiveDocPath(doc.id), e)} className="ml-2 text-xs text-primary underline-offset-2 hover:underline" title="Dönüş kabul belgesini aç">
            {doc.docNo}
          </button>
        )}
        {dead && <Badge variant="outline" className="ml-2 font-normal">Geri alındı</Badge>}
      </TableCell>
      <TableCell className={cn(num, "font-medium")}>{fmtM(r.lengthM)}</TableCell>
      <TableCell colSpan={4} />
      <TableCell className="whitespace-nowrap text-right">
        {canUndo && !dead && (
          <PermissionGate permission="warpbeam:cancel">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={onUndo} aria-label="Kabulü geri al" title="Kabulü geri al (yalnız en yeni kabul geri alınabilir)">
              <Undo2 className="h-4 w-4" />
            </Button>
          </PermissionGate>
        )}
      </TableCell>
    </TableRow>
  );
}

function ReceiptTable({ rows, canUndo, onUndo, ctx }: { rows: WarpingReceipt[]; canUndo: boolean; onUndo: (r: WarpingReceipt) => void; ctx: BeamCtx }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <Table aria-label="Levent kabulleri">
        <TableHeader>
          <TableRow>
            <TableHead>Kabul · levent</TableHead>
            <TableHead className={num}>Metre</TableHead>
            <TableHead className={num} title="Tel × denye × metre">Hesap kg</TableHead>
            <TableHead className={num} title="Girildiyse brüt / dara">Tartı brüt / dara</TableHead>
            <TableHead className={num}>Tartı net</TableHead>
            <TableHead className={num} title="Tartı net − hesap (yalnız bilgi)">Tartı farkı</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <Fragment key={r.receiptKey}>
              <ReceiptHead r={r} canUndo={canUndo} onUndo={() => onUndo(r)} />
              {r.beams.map((b) => <BeamRow key={b.id} b={b} ctx={ctx} />)}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type Open = { kind: "receive" } | { kind: "undo"; r: WarpingReceipt } | { kind: "reject"; beamId: string } | { kind: "doc"; doc: WarpingBeamRejection } | null;

export function ReceiptsSection({ order }: { order: WarpingOrder }) {
  const q = useWarpingReceipts(order.id);
  const rj = useWarpingRejections(order.id);
  const [open, setOpen] = useState<Open>(null);
  const receivable = order.status === "OPEN" || order.status === "IN_PROGRESS";
  const rows = q.data?.receipts ?? [];
  const docs = rj.data?.data ?? [];
  const ctx: BeamCtx = {
    canReject: receivable,
    rejection: activeRejectionByBeam(docs),
    beamNoById: new Map([...rows.flatMap((r) => r.beams.map((b) => [b.id, b.beamNo] as const)), ...docs.flatMap((d) => d.items.map((i) => [i.beamId, i.beamNo] as const))]),
    onReject: (beamId) => setOpen({ kind: "reject", beamId }),
  };
  return (
    <section className="space-y-2" aria-label="Dönen leventler">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Dönen leventler ve mutabakat</h2>
        {receivable && (
          <PermissionGate permission="warping-order:write">
            <Button size="sm" onClick={() => setOpen({ kind: "receive" })}><PackageCheck className="mr-1 h-4 w-4" /> Levent kabulü</Button>
          </PermissionGate>
        )}
      </div>
      {q.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
      {q.data && <SettlementSummary s={q.data.settlement} />}
      {q.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">Henüz levent dönmedi.{receivable ? " Devereci leventleri getirince “Levent kabulü” ile girin." : ""}</p>}
      {rows.length > 0 && <ReceiptTable rows={rows} canUndo={order.status !== "CANCELLED"} onUndo={(r) => setOpen({ kind: "undo", r })} ctx={ctx} />}
      {open?.kind === "receive" && <ReceiveDocDialog fixedOrder={order} onClose={() => setOpen(null)} />}
      {open?.kind === "undo" && <ReceiptCancelDialog orderId={order.id} receipt={open.r} names={yarnNamesOf(order)} onClose={() => setOpen(null)} />}
      {open?.kind === "reject" && (
        <BeamRejectDialog order={order} options={rejectableBeams(rows)} initialBeamId={open.beamId} onClose={() => setOpen(null)} onCreated={(doc) => setOpen({ kind: "doc", doc })} />
      )}
      {open?.kind === "doc" && <BeamRejectionDocDialog docId={open.doc.id} initial={open.doc} autoPrint onClose={() => setOpen(null)} />}
    </section>
  );
}
