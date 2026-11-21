// Mutabakat özeti — `warping-settlement.helper` çıktısının (kabuller ucu ve kapanış önizlemesi aynı fonksiyon)
// biçimi: hedef ↔ gelen metre, iplik başına gönderilen BRÜT · iade · sarılan · devirden · dağıtılamayan · deverecide
// kalan (+ net fire), tartı farkı. Sayı türetilmez; gönderilen ile iade/kalan ayrı sütundur (netleştirilmiş tek sayı yok).
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { transferText } from "./holding-model";
import { fmtKg, fmtM, isBeamCountOpen } from "./order-model";
import { signedKg } from "./receive-model";
import type { WarpingSettlement } from "./receive-types";
import { YarnLabel } from "./YarnLabel";

const num = "text-right tabular-nums";
const kgOrDash = (v: string) => (Number(v) === 0 ? "—" : fmtKg(v));
const pctText = (v: string | null) => (v === null ? "" : ` (${signedKg(v, (n) => formatQty(n, 2))} %)`);

function MetreStrip({ m }: { m: WarpingSettlement["metre"] }) {
  const short = Number(m.diffM) < 0;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border p-3 text-sm sm:grid-cols-4" aria-label="Metre mutabakatı">
      <div><dt className="text-xs text-muted-foreground">Hedef</dt><dd className="font-medium tabular-nums">{fmtM(m.targetM)} m · {isBeamCountOpen({ beamCount: m.planBeamCount, beamCountOpen: m.planBeamCountOpen }) ? "adet belli değil" : `${m.planBeamCount} levent`}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Gelen</dt><dd className="font-medium tabular-nums">{fmtM(m.receivedM)} m · {m.receivedBeamCount} levent{m.rejectedBeamCount ? <span className="block text-xs font-normal text-orange-700 dark:text-orange-400">reddedilen {fmtM(m.rejectedM ?? "0")} m · {m.rejectedBeamCount} levent (gelene sayılmaz)</span> : null}</dd></div>
      <div>
        <dt className="text-xs text-muted-foreground">Fark</dt>
        <dd className={cn("font-medium tabular-nums", short && "text-amber-700 dark:text-amber-400")}>{signedKg(m.diffM, fmtM)} m{pctText(m.diffPct)}</dd>
      </div>
      <div><dt className="text-xs text-muted-foreground">Durum</dt><dd>{Number(m.receivedM) === 0 ? "Henüz levent gelmedi" : short ? "Eksik geldi" : "Hedef tamam"}</dd></div>
    </dl>
  );
}

function WeighLine({ w }: { w: NonNullable<WarpingSettlement["weighing"]> }) {
  return (
    <p className="text-xs text-muted-foreground">
      Tartı ({w.weighedBeamCount} levent): net {fmtKg(w.weighedNetKg)} kg · hesap {fmtKg(w.nominalKg)} kg · fark <b className="text-foreground">{signedKg(w.diffKg)} kg</b>{pctText(w.diffPct)} — yalnız bilgi, tüketim hesaptan.
    </p>
  );
}

export function SettlementSummary({ s }: { s: WarpingSettlement }) {
  return (
    <div className="space-y-2">
      <MetreStrip m={s.metre} />
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="İplik mutabakatı">
          <TableHeader>
            <TableRow>
              <TableHead>İplik</TableHead>
              <TableHead className={num} title="Planlanan (fireli) kg">Plan kg</TableHead>
              <TableHead className={num} title="Devereciye giden (brüt, iptaller hariç)">Gönderilen</TableHead>
              <TableHead className={num}>İade</TableHead>
              <TableHead className={num} title="Başka siparişten gelen (+) / giden (−)">Aktarma</TableHead>
              <TableHead className={num} title="Dönen leventlere sarılan (tel × denye × metre)">Sarılan</TableHead>
              <TableHead className={num} title="Sarılanın başka siparişin kalanından düşen kısmı">Devirden</TableHead>
              <TableHead className={num} title="Deverecideki iplikten fazla tüketim — hiçbir sevke düşülemedi">Dağıtılamayan</TableHead>
              <TableHead className={num} title="Kullanılamaz yazılan iplik (kapanış + iade penceresi; geri alınanlar düşülmüş)">Fire</TableHead>
              <TableHead className={num} title="Bu siparişin deverecide duran ipliği">Deverecide kalan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.yarns.map((y) => (
              <TableRow key={y.yarnItemId}>
                <TableCell><YarnLabel prefix={`${y.letter} · `} name={y.name} code={y.code} /></TableCell>
                <TableCell className={num}>{fmtKg(y.planGrossKg)}</TableCell>
                <TableCell className={num}>{fmtKg(y.dispatchedKg)}</TableCell>
                <TableCell className={num}>{kgOrDash(y.returnedKg)}</TableCell>
                <TableCell className={num}>{transferText(y.transferOutKg, y.transferInKg)}</TableCell>
                <TableCell className={num}>{kgOrDash(y.woundKg)}</TableCell>
                <TableCell className={num}>{kgOrDash(y.carryOverUsedKg)}</TableCell>
                <TableCell className={cn(num, Number(y.unallocatedKg) > 0 && "font-medium text-destructive")}>{kgOrDash(y.unallocatedKg)}</TableCell>
                <TableCell className={num}>{kgOrDash(y.wasteKg ?? "0")}</TableCell>
                <TableCell className={cn(num, "font-medium")}>{fmtKg(y.atSubcontractorKg)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {s.yarns.some((y) => Number(y.unallocatedKg) > 0) && (
        <p className="text-xs text-destructive">Dağıtılamayan: leventlere sarılan hesap, deverecideki iplikten fazla — tel/denye/metre ya da eksik sevk kaydını kontrol edin.</p>
      )}
      {s.weighing && <WeighLine w={s.weighing} />}
    </div>
  );
}
