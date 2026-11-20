// Sipariş sayfası "Reddedilen leventler" bölümü — `GET /api/warping-beam-rejections?filter[warpingOrderId]`: ret
// belgeleri (yeniden eskiye; iptaller soluk), sarım başına yeniden sarım bağı. Satır → belge (basım + iptal).
// Ret yoksa bölüm HİÇ çizilmez (çoğu siparişte ret olmaz; boş başlık gürültüdür).
import { useState } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { BeamRejectionDocDialog } from "./BeamRejectionDocDialog";
import { fmtM } from "./order-model";
import { useWarpingRejections } from "./rejection-service";
import type { WarpingBeamRejection } from "./rejection-types";

const num = "text-right tabular-nums";

function BeamsCell({ d }: { d: WarpingBeamRejection }) {
  return (
    <ul className="space-y-0.5">
      {d.items.map((i) => (
        <li key={i.beamId} className={cn(i.reversed && "line-through decoration-muted-foreground/40")}>
          <span className="font-medium">{i.beamNo}</span>
          {i.bodyNo && <span className="text-muted-foreground"> · gövde {i.bodyNo}</span>}
          {i.rework ? <span className="text-emerald-700 dark:text-emerald-400"> → yeniden sarım {i.rework.beamNo}</span>
            : d.mode === "REWORK" && d.status === "ACTIVE" && !i.reversed && <span className="text-muted-foreground"> · yeniden sarım bekleniyor</span>}
        </li>
      ))}
    </ul>
  );
}

function RejectionRow({ d, onOpen }: { d: WarpingBeamRejection; onOpen: () => void }) {
  const dead = d.status === "CANCELLED";
  return (
    <TableRow className={cn("align-top text-sm", dead && "text-muted-foreground")}>
      <TableCell className="whitespace-nowrap">
        <span className="font-medium">{d.docNo}</span>
        {dead ? <Badge variant="outline" className="ml-2 font-normal">İptal</Badge> : null}
        <div className="text-xs text-muted-foreground">{fmtFactoryDateTime(d.rejectedAt)}</div>
      </TableCell>
      <TableCell>{d.reason.text}{d.photos.length > 0 && <span className="text-xs text-muted-foreground"> · {d.photos.length} foto</span>}</TableCell>
      <TableCell>{d.mode === "REWORK" ? "Yeniden sarılsın" : "İptal, iplik deverecide"}</TableCell>
      <TableCell className="text-xs"><BeamsCell d={d} /></TableCell>
      <TableCell className={num}>{fmtM(d.totals.lengthM)}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onOpen} aria-label={`${d.docNo} belgesini aç`} title="Belgeyi aç (yazdır / iptal)">
          <FileText className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function BeamRejectionsSection({ orderId }: { orderId: string }) {
  const q = useWarpingRejections(orderId);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = q.data?.data ?? [];
  if (q.isError) return <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>;
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Reddedilen leventler">
      <h2 className="text-base font-semibold">Reddedilen leventler</h2>
      <p className="text-xs text-muted-foreground">Devereciye geri gönderilen kusurlu sarımlar. Reddedilen sarım faturalanmaz; ipliği deverecinin bakiyesine döner.</p>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Ret belgeleri">
          <TableHeader>
            <TableRow>
              <TableHead>Belge</TableHead>
              <TableHead>Sebep</TableHead>
              <TableHead>Karar</TableHead>
              <TableHead>Sarımlar</TableHead>
              <TableHead className={num}>Metre</TableHead>
              <TableHead><span className="sr-only">İşlem</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map((d) => <RejectionRow key={d.id} d={d} onOpen={() => setOpenId(d.id)} />)}</TableBody>
        </Table>
      </div>
      {openId && <BeamRejectionDocDialog docId={openId} initial={rows.find((r) => r.id === openId)} onClose={() => setOpenId(null)} />}
    </section>
  );
}
