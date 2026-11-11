import { SectionCard } from "@/components/ui/section-card";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";
import { formatCount, hareketZamani, metre } from "./pano-bicim";
import { HIZLI_EYLEMLER, movementTarget } from "./pano-hedefler";
import type { PanoErisim } from "./usePanoErisim";
import type { HareketTuru, PanoHareket } from "./types";

export const HAREKET_ROZETI: Record<HareketTuru, { etiket: string; ton: IconTileTone }> = {
  SIPARIS: { etiket: "Sipariş", ton: "blue" },
  SEVK: { etiket: "Sevk", ton: "green" },
  DOGRUDAN_SEVK: { etiket: "Doğrudan sevk", ton: "teal" },
  FASON_GIDEN: { etiket: "Fasona giden", ton: "orange" },
  FASON_DONEN: { etiket: "Fasondan dönen", ton: "amber" },
  MAL_KABUL: { etiket: "Mal kabul", ton: "violet" },
  GELEN_BELGE: { etiket: "Gelen belge", ton: "sky" },
};

function miktarMetni(h: PanoHareket): string {
  if (h.miktar === null) return "—";
  return h.birim === "top" ? `${formatCount(h.miktar)} top` : metre(h.miktar);
}

interface Props {
  hareketler: PanoHareket[] | undefined;
  yukleniyor: boolean;
  hata: boolean;
  onYenile: () => void;
  erisim: PanoErisim;
}

/** Son hareketler — satır tıklanınca kaydın ekranı (izin/modül kapalıysa düz satır). */
export function PanoMovementList({ hareketler, yukleniyor, hata, onYenile, erisim }: Props) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  return (
    <SectionCard title="Son hareketler" description="Sipariş, sevk, fason, mal kabul ve gelen belge" flush>
      {yukleniyor ? (
        <div className="space-y-2 px-5 pb-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-shimmer h-9 rounded-lg bg-muted" />)}</div>
      ) : hata ? (
        <BoxError onYenile={onYenile} />
      ) : !hareketler || hareketler.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Henüz hareket yok.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {hareketler.map((h) => {
            const r = HAREKET_ROZETI[h.tur];
            const target = movementTarget(h);
            const canOpen = erisim.canGo(target);
            const ic = (
              <>
                <span className={cn("tone-chip w-[5.75rem] shrink-0 truncate rounded-full px-2 py-0.5 text-center text-[10.5px] font-semibold", `tile-${r.ton}`)} title={r.etiket}>{r.etiket}</span>
                {/* Belge no üstte, cari altında: tek satırda cari ~50 px'e düşüp "Boyer…" kırpılıyordu. */}
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate font-semibold tabular-nums">{h.belgeNo}</span>
                  <span className="truncate text-xs text-muted-foreground" title={h.cari ?? undefined}>{h.cari ?? "—"}</span>
                </span>
                <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{miktarMetni(h)}</span>
                <span className="w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground">{hareketZamani(h.zaman)}</span>
              </>
            );
            const sinif = "flex w-full items-center gap-3 px-5 py-2 text-left text-sm";
            return (
              <li key={`${h.tur}:${h.hedef.id}`}>
                {canOpen ? (
                  <button type="button" onClick={() => navigateActive(target.to)} className={cn(sinif, "transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none")}>{ic}</button>
                ) : <div className={sinif}>{ic}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

export function BoxError({ onYenile }: { onYenile: () => void }) {
  return (
    <div className="px-5 py-6 text-center text-sm">
      <p className="font-medium text-destructive">Veri alınamadı.</p>
      <button type="button" onClick={onYenile} className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline">Tekrar dene</button>
    </div>
  );
}

/** Hızlı eylemler — izni ve modülü açık olanlar; hiçbiri yoksa kutu yok. */
export function PanoHizliEylemler({ erisim }: { erisim: PanoErisim }) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const gorunen = HIZLI_EYLEMLER.filter((e) => erisim.canGo(e));
  if (gorunen.length === 0) return null;
  return (
    <SectionCard title="Hızlı işlemler">
      <div className="@container">
      <div className="grid grid-cols-3 gap-x-2 gap-y-4 @[17rem]:grid-cols-4">
        {gorunen.map((e) => (
          <button key={e.key} type="button" onClick={() => navigateActive(e.to)} title={e.label}
            className="group flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-center text-[11px] font-medium leading-tight text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <IconTile icon={e.icon} tone={e.tone} size="lg" className="transition-transform group-hover:-translate-y-0.5" />
            <span className="line-clamp-2 break-words">{e.kisa ?? e.label}</span>
          </button>
        ))}
      </div>
      </div>
    </SectionCard>
  );
}
