// Ajanda kutusu — ay takvimi (gün başına iş sayısı noktası) + seçili günün planlı işleri + tarihsiz planlı sevkiyatlar.
// Gecikme vurgusu bilerek YOK (tekstilde termin/gecikme kutusu istenmedi).
import { CalendarDays, ChevronLeft, ChevronRight, Factory, PackageCheck, Truck, Waves, type LucideIcon } from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { TERIM } from "@/lib/terim";
import { factoryDayKey, fmtDayKey } from "@/lib/factory-time";
import type { AgendaBox } from "./box-types";
import { formatCount, metre } from "./pano-bicim";
import { BOX_TARGETS, type PanoTarget } from "./pano-hedefler";
import { PanoCard } from "./PanoBoxFrame";
import { RowLink, useGo } from "./pano-ui";
import type { AgendaParams } from "./usePanoBoxData";
import type { PanoErisim } from "./usePanoErisim";

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "2026-11" ± n ay (takvim aritmetiği; dilimden bağımsız). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Ayın ilk gününden önceki boş hücre sayısı (Pazartesi başlangıçlı). */
function leadingBlanks(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

function MonthGrid({ d, onPick }: { d: AgendaBox; onPick: (p: AgendaParams) => void }) {
  const today = factoryDayKey();
  const [y, m] = d.ay.split("-").map(Number) as [number, number];
  return (
    <div className="w-full @[34rem]:w-60 @[34rem]:shrink-0">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">{MONTHS[m - 1]} {y}</p>
        <div className="flex gap-1">
          <NavButton label="Önceki ay" icon={ChevronLeft} onClick={() => { const ay = shiftMonth(d.ay, -1); onPick({ ay, gun: `${ay}-01` }); }} />
          <NavButton label="Sonraki ay" icon={ChevronRight} onClick={() => { const ay = shiftMonth(d.ay, 1); onPick({ ay, gun: `${ay}-01` }); }} />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
        {WEEKDAYS.map((w) => <span key={w} className="py-1 font-medium text-muted-foreground">{w}</span>)}
        {Array.from({ length: leadingBlanks(d.ay) }, (_, i) => <span key={`b${i}`} />)}
        {d.ayGunleri.map((g) => {
          const selected = g.gun === d.gun;
          return (
            <button key={g.gun} type="button" onClick={() => onPick({ ay: d.ay, gun: g.gun })} aria-pressed={selected}
              aria-label={`${fmtDayKey(g.gun)}${g.toplam > 0 ? `, ${g.toplam} planlı iş` : ""}`}
              className={cn("relative flex h-8 flex-col items-center justify-center rounded-lg tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted",
                !selected && g.gun === today && "font-bold text-primary ring-1 ring-primary/40")}>
              {Number(g.gun.slice(8))}
              {g.toplam > 0 && <span className={cn("absolute bottom-0.5 h-1 w-1 rounded-full", selected ? "bg-primary-foreground" : "bg-primary")} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-card-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

interface Item { id: string; title: string; sub: string | null; amount: string | null; target: PanoTarget }
interface Section { key: string; label: string; icon: LucideIcon; tone: IconTileTone; total: number; items: Item[] }

function daySections(d: AgendaBox): Section[] {
  const out: Section[] = [];
  const { alisTeslim, isEmriBaslangic, dokumaBaslangic } = d.isler;
  if (alisTeslim) out.push({ key: "alis", label: "Alış teslimi", icon: PackageCheck, tone: "teal", total: alisTeslim.toplam,
    items: alisTeslim.kalemler.map((r) => ({ id: r.id, title: r.no, sub: r.taraf, amount: null, target: BOX_TARGETS.alis })) });
  if (isEmriBaslangic) out.push({ key: "isEmri", label: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} başlangıcı`, icon: Factory, tone: "orange", total: isEmriBaslangic.toplam,
    items: isEmriBaslangic.kalemler.map((r) => ({ id: r.id, title: r.no, sub: null, amount: r.hedefMetre !== null ? metre(r.hedefMetre) : null,
      target: { to: `/operations/work-orders/${encodeURIComponent(r.id)}`, izin: ["workorder:read"] } })) });
  if (dokumaBaslangic) out.push({ key: "dokuma", label: "Dokuma başlangıcı", icon: Waves, tone: "violet", total: dokumaBaslangic.toplam,
    items: dokumaBaslangic.kalemler.map((r) => ({ id: r.id, title: r.no, sub: r.kumas, amount: r.planlananMetre !== null ? metre(r.planlananMetre) : null, target: BOX_TARGETS.dokuma })) });
  return out;
}

function SectionList({ s, erisim }: { s: Section; erisim: PanoErisim }) {
  const go = useGo(erisim);
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <IconTile icon={s.icon} tone={s.tone} size="sm" />{s.label}<span className="tabular-nums">· {formatCount(s.total)}</span>
      </p>
      <div className="-mx-2">
        {s.items.map((it) => (
          <RowLink key={it.id} onClick={go(it.target)} className="py-1.5">
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-medium tabular-nums">{it.title}</span>
              {it.sub && <span className="truncate text-xs text-muted-foreground" title={it.sub}>{it.sub}</span>}
            </span>
            {it.amount && <span className="shrink-0 text-xs font-semibold tabular-nums">{it.amount}</span>}
          </RowLink>
        ))}
        {s.total > s.items.length && <p className="px-2 text-xs text-muted-foreground">+{formatCount(s.total - s.items.length)} kayıt daha</p>}
      </div>
    </div>
  );
}

export function PanoAgenda({ d, erisim, onPick, loading }: { d: AgendaBox; erisim: PanoErisim; onPick: (p: AgendaParams) => void; loading?: boolean }) {
  const go = useGo(erisim);
  const sections = daySections(d).filter((s) => s.total > 0);
  const ship = d.planliSevkiyat;
  return (
    <PanoCard title="Ajanda" description={`${fmtDayKey(d.gun)} planı`}
      action={<button type="button" onClick={() => onPick({})} className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted">Bugün</button>}>
      <div className="@container">
        <div className="flex flex-col gap-5 @[34rem]:flex-row">
          <MonthGrid d={d} onPick={onPick} />
          <div className={cn("min-w-0 flex-1 space-y-3 transition-opacity", loading && "opacity-60")} aria-busy={loading || undefined}>
            {sections.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" aria-hidden />Bu gün için planlı iş yok</p>
            ) : sections.map((s) => <SectionList key={s.key} s={s} erisim={erisim} />)}
            {ship && ship.toplam > 0 && (
              <div className="border-t border-border/60 pt-2">
                <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <IconTile icon={Truck} tone="green" size="sm" />Planlı sevkiyat (tarihsiz)<span className="tabular-nums">· {formatCount(ship.toplam)}</span>
                </p>
                <div className="-mx-2">
                  {ship.kalemler.slice(0, 4).map((s) => (
                    <RowLink key={s.id} onClick={go({ to: `/operations/shipments/${encodeURIComponent(s.id)}`, izin: ["shipping:read"] })} className="py-1.5">
                      <span className="shrink-0 font-medium tabular-nums">{s.no}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={s.musteri}>{s.musteri}</span>
                    </RowLink>
                  ))}
                </div>
              </div>
            )}
            {d.kesildi && <p className="text-xs text-muted-foreground">Ay görünümü kısaltıldı (çok sayıda plan kalemi).</p>}
          </div>
        </div>
      </div>
    </PanoCard>
  );
}
