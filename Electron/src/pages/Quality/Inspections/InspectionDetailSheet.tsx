// Muayene detayı (sağ çekmece): künye, hata tablosu, hesap dökümü, kural snapshot'ı, revizyon zinciri.
// Düzelt ve iptal DURUM GEÇİŞİDİR: eski revizyon silinmez, zincirde görünür kalır.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, PencilLine } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { apiErrorText } from "@/lib/api-error";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { inspectionService, type InspectionDetail } from "./service";
import { PHASE_LABEL, SIZE_LABEL, STATE_LABEL, WIDTH_SOURCE_LABEL, inspectionState, numText } from "./inspectionRules";
import { InspectionReviseDialog } from "./InspectionReviseDialog";
import { InspectionVoidDialog } from "./InspectionVoidDialog";

interface Props { id: string; onClose: () => void; onOpen: (id: string) => void }

export function InspectionDetailSheet({ id, onClose, onOpen }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"revise" | "void" | null>(null);
  const q = useQuery({ queryKey: ["quality-inspections", "detail", id], queryFn: () => inspectionService.get(id) });
  const d = q.data;
  const refresh = (nextId?: string) => { void qc.invalidateQueries({ queryKey: ["quality-inspections"] }); if (nextId) onOpen(nextId); };
  const active = d ? inspectionState(d) === "ACTIVE" : false;
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Muayene {d ? <span className="font-mono">{d.roll.barcode ?? "—"}</span> : null}</SheetTitle>
          <SheetDescription>4 puan muayenesi — kayıt silinmez; düzeltme yeni revizyon yazar, iptal gerekçeyle saklanır.</SheetDescription>
        </SheetHeader>
        {q.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
          : q.isError ? <p className="mt-4 text-sm text-destructive">{apiErrorText(q.error, "Muayene okunamadı.")}</p>
          : d && (
            <div className="mt-4 space-y-4 text-sm">
              {active && (
                <PermissionGate permission="inspection:correct">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setMode("revise")}><PencilLine className="mr-1 h-4 w-4" />Düzelt</Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setMode("void")}><Ban className="mr-1 h-4 w-4" />İptal et</Button>
                  </div>
                </PermissionGate>
              )}
              <Identity d={d} />
              <Defects d={d} />
              <Breakdown d={d} />
              <Snapshot d={d} />
              <History d={d} onOpen={onOpen} />
            </div>
          )}
        {d && mode === "revise" && <InspectionReviseDialog detail={d} onOpenChange={(v) => !v && setMode(null)} onDone={(newId) => { setMode(null); refresh(newId); }} />}
        {d && mode === "void" && <InspectionVoidDialog id={d.id} onOpenChange={(v) => !v && setMode(null)} onDone={() => { setMode(null); refresh(); }} />}
      </SheetContent>
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (<><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></>);
}
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-md border p-3"><h3 className="mb-2 font-medium">{title}</h3>{children}</section>
);

function Identity({ d }: { d: InspectionDetail }) {
  const st = inspectionState(d);
  return (
    <Section title="Künye">
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1">
        <Row k="Durum" v={<Badge variant={st === "ACTIVE" ? "outline" : st === "VOIDED" ? "destructive" : "secondary"}>{STATE_LABEL[st]} · revizyon {d.revision}</Badge>} />
        <Row k="Kumaş" v={d.roll.item ? `${d.roll.item.code} · ${d.roll.item.name}` : "—"} />
        <Row k="Aşama" v={PHASE_LABEL[d.phase]} />
        <Row k="Muayene" v={`${fmtFactoryDateTime(d.inspectedAt)} · ${d.inspectedBy?.fullName ?? "—"}${d.station ? ` · ${d.station.name}` : ""}`} />
        <Row k="Uzunluk" v={`${numText(d.inspectedLengthM)} m`} />
        <Row k="En" v={`${numText(d.widthCm)} cm · ${WIDTH_SOURCE_LABEL[d.widthSource]}`} />
        <Row k="Derece" v={<>{d.suggestedGradeCode ?? "—"} <span className="text-muted-foreground">(top: {d.roll.qualityGrade ?? "boş"})</span>{d.gradeMismatch && <Badge variant="destructive" className="ml-1">Uyumsuz</Badge>}</>} />
        {d.note && <Row k="Not" v={d.note} />}
        {d.reviseReason && <Row k="Düzeltme gerekçesi" v={d.reviseReason} />}
        {d.voidedAt && <Row k="İptal" v={`${fmtFactoryDateTime(d.voidedAt)} · ${d.voidedBy?.fullName ?? "—"} · ${d.voidReason ?? ""}`} />}
      </dl>
    </Section>
  );
}

function Defects({ d }: { d: InspectionDetail }) {
  return (
    <Section title={`Hatalar (${d.rollErrors.length})`}>
      {d.rollErrors.length === 0 ? <p className="text-muted-foreground">Hata girilmedi.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-xs" data-testid="inspection-defects">
            <thead className="text-muted-foreground"><tr><th className="py-1 text-left">Tür</th><th className="text-left">Boyut</th><th className="text-right">Puan</th><th className="text-right">Metre</th><th className="pl-3 text-left">Kişi · saat</th></tr></thead>
            <tbody>
              {d.rollErrors.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-1">{e.errorType ?? "—"}</td>
                  <td>{e.sizeClass ? SIZE_LABEL[e.sizeClass] : "Sabit puan"}</td>
                  <td className="text-right tabular-nums">{e.points ?? "—"}</td>
                  <td className="text-right tabular-nums">{numText(e.startMeter)}</td>
                  <td className="pl-3 text-muted-foreground">{e.detectedBy?.fullName ?? "—"} · {fmtFactoryDateTime(e.detectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Breakdown({ d }: { d: InspectionDetail }) {
  const b = d.breakdown;
  return (
    <Section title="Hesap dökümü">
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1">
        <Row k="Ham puan" v={b.rawPoints} />
        <Row k="Tavan sonrası" v={b.cappedPoints} />
        <Row k="Alan" v={b.areaM2 == null ? "— (en bilinmiyor)" : `${numText(b.areaM2)} m²`} />
        <Row k="Puan / 100 m²" v={<span className="font-semibold">{numText(d.pointsPer100M2)}</span>} />
        <Row k="Formül" v={<span className="font-mono text-xs">{b.formula}</span>} />
      </dl>
    </Section>
  );
}

function Snapshot({ d }: { d: InspectionDetail }) {
  const s = d.ruleSnapshot;
  return (
    <Section title={`Kural seti${d.ruleSet ? ` · ${d.ruleSet.name}` : " · fabrika varsayılanı"}`}>
      <p className="mb-1 text-xs text-muted-foreground">Muayene anındaki kopya — kural sonradan değişse de bu muayene bununla hesaplandı.</p>
      {!s || s.bands.length === 0 ? <p className="text-muted-foreground">Derece bandı yok.</p> : (
        <ul className="space-y-0.5">
          {s.bands.map((b) => (
            <li key={b.sortOrder} className="flex justify-between gap-2"><span>{b.label}{b.accepted ? "" : " · ret"}</span><span className="tabular-nums text-muted-foreground">{b.maxScore == null ? "üst sınır yok" : `≤ ${numText(b.maxScore)}`}</span></li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function History({ d, onOpen }: { d: InspectionDetail; onOpen: (id: string) => void }) {
  return (
    <Section title="Revizyon zinciri">
      <ol className="space-y-1" data-testid="inspection-history">
        {d.history.map((h) => {
          const st = inspectionState(h);
          return (
            <li key={h.id}>
              <button type="button" disabled={h.id === d.id} onClick={() => onOpen(h.id)}
                className={cn("flex w-full flex-wrap items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted/40", h.id === d.id && "bg-muted/60")}>
                <span className="font-mono text-xs">r{h.revision}</span>
                <Badge variant={st === "ACTIVE" ? "outline" : st === "VOIDED" ? "destructive" : "secondary"}>{STATE_LABEL[st]}</Badge>
                <span className="tabular-nums">{h.totalPoints} puan · {numText(h.pointsPer100M2)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{fmtFactoryDateTime(h.createdAt)}</span>
                {(h.reviseReason || h.voidReason) && <span className="w-full text-xs text-muted-foreground">{h.voidReason ?? h.reviseReason}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
