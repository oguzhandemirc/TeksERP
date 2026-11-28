// Levent kabulü diyaloğunun parçaları: levent satır editörü + sunucu önizlemesi (metre, iplik başına tüketim,
// devirden kullanılan, etkilenen her sevk kalemi, tartı). Önizlemedeki her sayı sunucudan; burada yalnız biçim.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtKg, fmtM, isBeamCountOpen } from "./order-model";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { emptyBeamDraft, MAX_RECEIVE_BEAMS, receiveYarnRows, signedKg, type ReceiveBeamDraft, type ReceiveBodyDraft, type ReceiveWeighing } from "./receive-model";
import { ReceiveBodyCell } from "./ReceiveBodyCell";
import { OverrunNote, type OverrunCtx } from "./OverrunNote";
import type { ReworkCandidate } from "./rejection-model";
import type { WarpingReceivePreview } from "./receive-types";
import { YarnLabel } from "./YarnLabel";

const num = "text-right tabular-nums";
type Field = Exclude<keyof ReceiveBeamDraft, "body">;

const NO_REWORK = "none";

/** C2: satırı reddedilen bir sarımın yeniden sarımı olarak bağlar; aday yoksa sütun hiç çizilmez. */
function ReworkSelect({ i, value, reworks, onChange }: { i: number; value: string; reworks: ReworkCandidate[]; onChange: (v: string) => void }) {
  return (
    <Select value={value || NO_REWORK} onValueChange={(v) => onChange(v === NO_REWORK ? "" : v)}>
      <SelectTrigger className="h-8" aria-label={`${i + 1}. levent yeniden sarım`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_REWORK}>Yeni sarım</SelectItem>
        {reworks.map((r) => <SelectItem key={r.beamId} value={r.beamId}>{r.beamNo} yerine ({r.docNo})</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Ayarların tabloya etkisi: tartı OFF → brüt/dara sütunu yok; gövde modu OFF → gövde no METNİ (bugünkü), açıkken okutma hücresi. */
export interface ReceiveTableOptions { weighing?: ReceiveWeighing; bodyMode?: "OFF" | "OPTIONAL" | "REQUIRED"; subcontractorId?: string | null; minRows?: number }

export function ReceiveBeamsTable({ drafts, onChange, reworks = [], options = {} }: { drafts: ReceiveBeamDraft[]; onChange: (d: ReceiveBeamDraft[]) => void; reworks?: ReworkCandidate[]; options?: ReceiveTableOptions }) {
  const { weighing = "OPTIONAL", bodyMode = "OFF", subcontractorId = null, minRows = 1 } = options;
  const weigh = weighing !== "OFF";
  const bodies = bodyMode !== "OFF";
  const set = (i: number, k: Field, v: string) => onChange(drafts.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const setBody = (i: number, v: ReceiveBodyDraft | null) => onChange(drafts.map((d, j) => (j === i ? { ...d, body: v } : d)));
  const cell = (i: number, k: Field, label: string, decimal = true) => (
    <Input aria-label={`${i + 1}. levent ${label}`} className={cn("h-8", decimal && "text-right")} inputMode={decimal ? "decimal" : undefined}
      maxLength={decimal ? 12 : 32} value={drafts[i]?.[k] ?? ""} onChange={(e) => set(i, k, e.target.value)} />
  );
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              {bodies
                ? <TableHead className="min-w-56" title="Gövdenin QR'ını okutun ya da no yazıp Enter'a basın; tanımsız gövde yerinde tanımlanır">Gövde{bodyMode === "REQUIRED" ? " *" : ""}</TableHead>
                : <TableHead className="min-w-28" title="Leventin üzerindeki numara (isteğe bağlı)">Gövde no</TableHead>}
              <TableHead className="w-32 text-right">Metre</TableHead>
              {weigh && <TableHead className="w-28 text-right" title={weighing === "REQUIRED" ? "Tartı zorunlu — tüketimi değiştirmez" : "İsteğe bağlı tartı — tüketimi değiştirmez"}>Brüt kg{weighing === "REQUIRED" ? " *" : ""}</TableHead>}
              {weigh && <TableHead className="w-28 text-right" title="Boş levent ağırlığı (isteğe bağlı)">Dara kg</TableHead>}
              {reworks.length > 0 && <TableHead className="w-48" title="Reddedilen bir sarımın yerine gelen levent">Yeniden sarım</TableHead>}
              <TableHead className="w-10"><span className="sr-only">Sil</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.map((_, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  {bodies
                    ? <ReceiveBodyCell row={i + 1} value={drafts[i]?.body} subcontractorId={subcontractorId} onChange={(v) => setBody(i, v)} />
                    : cell(i, "physicalBeamNo", "gövde no", false)}
                </TableCell>
                <TableCell>{cell(i, "lengthM", "metre")}</TableCell>
                {weigh && <TableCell>{cell(i, "grossKg", "brüt kg")}</TableCell>}
                {weigh && <TableCell>{cell(i, "tareKg", "dara kg")}</TableCell>}
                {reworks.length > 0 && <TableCell><ReworkSelect i={i} value={drafts[i]?.reworkOfBeamId ?? ""} reworks={reworks} onChange={(v) => set(i, "reworkOfBeamId", v)} /></TableCell>}
                <TableCell>
                  <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`${i + 1}. leventi sil`} disabled={drafts.length <= minRows}
                    onClick={() => onChange(drafts.filter((_row, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button size="sm" variant="outline" disabled={drafts.length >= MAX_RECEIVE_BEAMS} onClick={() => onChange([...drafts, emptyBeamDraft(drafts.at(-1)?.lengthM ?? "")])}>
        <Plus className="mr-1 h-4 w-4" /> Levent ekle
      </Button>
    </div>
  );
}

function MetreLine({ p, overrun }: { p: WarpingReceivePreview; overrun?: OverrunCtx }) {
  const m = p.before.metre;
  const diff = Number(p.after.diffM);
  return (
    <p>
      Hedef <b>{fmtM(m.targetM)} m</b> ({isBeamCountOpen({ beamCount: m.planBeamCount, beamCountOpen: m.planBeamCountOpen }) ? "adet belli değil" : `${m.planBeamCount} levent`}) · şimdiye kadar {fmtM(m.receivedM)} m · bu kabul <b>{fmtM(p.incoming.lengthM)} m</b> ({p.incoming.beamCount} levent)
      {" → "}gelen <b>{fmtM(p.after.receivedM)} m</b>, fark <span className={cn(diff < 0 && "text-amber-700 dark:text-amber-400", diff > 0 && "font-medium text-sky-800 dark:text-sky-300")}>{signedKg(p.after.diffM, fmtM)} m</span>
      {/* Hedef üstü sarım serbest (fabrika 11-28): etiketlenir, ücret etkisi gösterilir, kabul engellenmez. */}
      <OverrunNote diffM={p.after.diffM} ctx={overrun} className="ml-2 inline-block" />
    </p>
  );
}

function YarnTable({ p }: { p: WarpingReceivePreview }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="İplik başına tüketim">
        <TableHeader>
          <TableRow>
            <TableHead>İplik</TableHead>
            <TableHead className={num} title="Bu kabulün leventlerine sarılan (tel × denye × metre)">Bu kabulde sarılan</TableHead>
            <TableHead className={num} title="Başka (kapanmış) siparişin deverecide kalan ipliğinden düşen kısım">Devirden kullanılan</TableHead>
            <TableHead className={num} title="Deverecideki iplikten fazla tüketim — hiçbir sevke düşülemedi">Dağıtılamayan (sonra)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {receiveYarnRows(p).map((y) => (
            <TableRow key={y.yarnItemId}>
              <TableCell><YarnLabel name={y.name} code={y.code} /></TableCell>
              <TableCell className={num}>{fmtKg(y.woundKg)}</TableCell>
              <TableCell className={num}>{y.carryOverKg > 0 ? fmtKg(y.carryOverKg) : "—"}</TableCell>
              <TableCell className={cn(num, Number(y.unallocatedAfterKg) > 0 && "font-medium text-destructive")}>{Number(y.unallocatedAfterKg) > 0 ? fmtKg(y.unallocatedAfterKg) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AllocationList({ p }: { p: WarpingReceivePreview }) {
  if (p.allocations.length === 0) return null;
  const name = new Map(p.before.yarns.map((y) => [y.yarnItemId, y.name]));
  return (
    <ul className="space-y-0.5 rounded-md border p-3 text-xs text-muted-foreground" aria-label="Etkilenen sevk kalemleri">
      {p.allocations.map((a, i) => (
        <li key={i}>
          {a.beamIndex + 1}. levent · {name.get(a.yarnItemId) ?? "iplik"} — {fmtKg(a.kg)} kg {a.dispatchNo} ({a.lotNo ? `lot ${a.lotNo}` : "lotsuz"}) sevkinden düşer
          {a.carryOver && <b className="text-foreground"> · devir: {a.holderOrderNo ?? "başka sipariş"}</b>}
        </li>
      ))}
    </ul>
  );
}

function WeighTable({ p }: { p: WarpingReceivePreview }) {
  if (!p.beams.some((b) => b.weighedNetKg !== null)) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="Tartı">
        <TableHeader>
          <TableRow>
            <TableHead>Levent</TableHead>
            <TableHead className={num}>Metre</TableHead>
            <TableHead className={num} title="Tel × denye × metre">Hesap kg</TableHead>
            <TableHead className={num} title="Brüt − dara">Tartı net kg</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.beams.map((b) => (
            <TableRow key={b.index}>
              <TableCell>{b.index + 1}.</TableCell>
              <TableCell className={num}>{fmtM(b.lengthM)}</TableCell>
              <TableCell className={num}>{fmtKg(b.nominalKg)}</TableCell>
              <TableCell className={num}>{b.weighedNetKg === null ? "—" : fmtKg(b.weighedNetKg)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReceivePreviewView({ p, overrun }: { p: WarpingReceivePreview; overrun?: OverrunCtx }) {
  return (
    <div className="space-y-2" aria-label="Kabul önizlemesi">
      <MetreLine p={p} overrun={overrun} />
      <YarnTable p={p} />
      {p.beams.some((b) => b.reworkOf) && (
        <ul className="space-y-0.5 rounded-md border p-3 text-xs" aria-label="Yeniden sarım bağları">
          {p.beams.filter((b) => b.reworkOf).map((b) => <li key={b.index}>{b.index + 1}. levent → reddedilen <b>{b.reworkOf?.beamNo}</b> yerine ({b.reworkOf?.rejectionDocNo})</li>)}
        </ul>
      )}
      {p.beams.some((b) => b.body) && (
        <p className="text-xs text-muted-foreground" aria-label="Gövde bağları">
          Gövdeler: {p.beams.filter((b) => b.body).map((b) => `${b.index + 1}. ${b.body?.bodyNo ?? "seri no"}${b.body?.isNew ? " (yeni tanım)" : ""}`).join(" · ")}
        </p>
      )}
      <AllocationList p={p} />
      <WeighTable p={p} />
      {p.warnings.length > 0 && (
        <Callout tone="warning" title="Kontrol edin">
          <ul className="list-disc space-y-0.5 pl-4" aria-label="Uyarılar">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Callout>
      )}
      <p className="text-xs text-muted-foreground">Tüketim tel × denye × metreden hesaplanır; tartı yalnız bilgi olarak saklanır.</p>
    </div>
  );
}
