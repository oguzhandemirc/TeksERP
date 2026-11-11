import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";
import { formatCount, kg, metre, para } from "./pano-bicim";
import { BOX_TARGETS, type PanoTarget } from "./pano-hedefler";
import type { PanoErisim } from "./usePanoErisim";
import type { PanoSummary, PanoUrun } from "./types";

interface SummaryRowProps {
  etiket: ReactNode;
  deger: ReactNode;
  ek?: ReactNode;
  hedef?: PanoTarget;
  erisim: PanoErisim;
  vurgu?: "warning" | "destructive";
}

/** Özet satırı: etiket · hizalı rakam; hedef açılabiliyorsa tıklanır (açılamıyorsa düz metin). */
function SummaryRow({ etiket, deger, ek, hedef, erisim, vurgu }: SummaryRowProps) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const git = hedef && erisim.canGo(hedef) ? () => navigateActive(hedef.to) : undefined;
  const ic = (
    <>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{etiket}</span>
      <span className={cn("font-semibold tabular-nums", vurgu === "warning" && "text-warning", vurgu === "destructive" && "text-destructive")}>{deger}</span>
      {ek && <span className="min-w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground">{ek}</span>}
      {git && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  const sinif = "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm";
  return git ? (
    <button type="button" onClick={git} className={cn(sinif, "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{ic}</button>
  ) : (
    <div className={sinif}>{ic}</div>
  );
}

const RowList = ({ children }: { children: ReactNode }) => <div className="-mx-2 divide-y divide-border/60">{children}</div>;

/** Bekleyen işler — her satır kendi kapısıyla; üçü de null ise kutu yok. */
export function PanoBekleyen({ b, erisim }: { b: PanoSummary["bekleyen"]; erisim: PanoErisim }) {
  if (!b.onayBekleyenBelge && !b.sevkeHazir && b.uretimeGonderilmemisSiparis === null) return null;
  return (
    <SectionCard title="Bekleyen işler">
      <RowList>
        {b.onayBekleyenBelge && (
          <SummaryRow etiket="Onay bekleyen gelen belge" deger={formatCount(b.onayBekleyenBelge.toplam)} ek={b.onayBekleyenBelge.kismi > 0 ? `${formatCount(b.onayBekleyenBelge.kismi)} kısmi` : undefined}
            hedef={BOX_TARGETS.onayBekleyenBelge} erisim={erisim} vurgu={b.onayBekleyenBelge.toplam > 0 ? "warning" : undefined} />
        )}
        {b.sevkeHazir && (
          <SummaryRow etiket="Sevke hazır sevkiyat" deger={formatCount(b.sevkeHazir.sevkiyat)} ek={metre(b.sevkeHazir.metre)} hedef={BOX_TARGETS.sevkeHazir} erisim={erisim} />
        )}
        {b.uretimeGonderilmemisSiparis !== null && (
          <SummaryRow etiket="Üretime gönderilmemiş sipariş" deger={formatCount(b.uretimeGonderilmemisSiparis)} hedef={BOX_TARGETS.uretimeGonderilmemis} erisim={erisim}
            vurgu={b.uretimeGonderilmemisSiparis > 0 ? "warning" : undefined} />
        )}
      </RowList>
    </SectionCard>
  );
}

/** En çok üretilen / sevk edilen — iki liste sekmeyle; ikisi de null ise kutu yok. */
export function PanoEnCok({ enCok, erisim }: { enCok: PanoSummary["enCok"]; erisim: PanoErisim }) {
  const sekmeler = [
    ...(enCok.uretilen ? [{ key: "uretilen", etiket: "Üretilen", liste: enCok.uretilen }] : []),
    ...(enCok.sevkEdilen ? [{ key: "sevk", etiket: "Sevk edilen", liste: enCok.sevkEdilen }] : []),
  ];
  const [secili, setSecili] = useState(0);
  if (sekmeler.length === 0) return null;
  const aktif = sekmeler[Math.min(secili, sekmeler.length - 1)]!;
  return (
    <SectionCard
      title="En çok"
      action={sekmeler.length > 1 ? (
        <div role="tablist" className="flex rounded-lg bg-muted p-0.5 text-xs">
          {sekmeler.map((s, i) => (
            <button key={s.key} type="button" role="tab" aria-selected={s === aktif} onClick={() => setSecili(i)}
              className={cn("rounded-md px-2 py-1 font-medium", s === aktif ? "bg-card shadow-sm" : "text-muted-foreground")}>{s.etiket}</button>
          ))}
        </div>
      ) : <span className="text-xs text-muted-foreground">{aktif.etiket}</span>}
    >
      {aktif.liste.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Bu dönemde kayıt yok.</p> : (
        <RowList>
          {aktif.liste.map((u: PanoUrun, i) => (
            <SummaryRow key={u.itemId} erisim={erisim}
              etiket={<><span className="mr-2 inline-block w-4 text-right tabular-nums">{i + 1}</span><span className="text-foreground">{u.ad}</span> <span className="text-xs">{u.kod}</span></>}
              deger={metre(u.metre)}
              hedef={{ ...BOX_TARGETS.urun, to: `${BOX_TARGETS.urun.to}?search=${encodeURIComponent(u.kod)}` }} />
          ))}
        </RowList>
      )}
    </SectionCard>
  );
}

export function PanoTezgah({ t, erisim }: { t: NonNullable<PanoSummary["tezgah"]>; erisim: PanoErisim }) {
  return (
    <SectionCard title="Tezgâh salonu" description={t.suAnYuzde !== null ? `Şu an çalışan %${formatCount(t.suAnYuzde)}` : undefined}>
      <RowList>
        <SummaryRow etiket="Çalışan" deger={`${formatCount(t.calisan)} / ${formatCount(t.toplam)}`} hedef={BOX_TARGETS.tezgah} erisim={erisim} />
        <SummaryRow etiket="Duran" deger={formatCount(t.duran)} vurgu={t.duran > 0 ? "destructive" : undefined} erisim={erisim} />
        {t.issiz !== null && <SummaryRow etiket="İşsiz" deger={formatCount(t.issiz)} erisim={erisim} />}
        <SummaryRow etiket="İzlenmeyen" deger={formatCount(t.izlenmeyen)} erisim={erisim} />
      </RowList>
    </SectionCard>
  );
}

export function PanoStok({ s, erisim }: { s: NonNullable<PanoSummary["stokOzeti"]>; erisim: PanoErisim }) {
  return (
    <SectionCard title="Stok">
      <RowList>
        <SummaryRow etiket="Mamul" deger={metre(s.mamul.metre)} ek={`${formatCount(s.mamul.top)} top`} hedef={BOX_TARGETS.stokOzeti} erisim={erisim} />
        <SummaryRow etiket="Ham" deger={metre(s.ham.metre)} ek={`${formatCount(s.ham.top)} top`} erisim={erisim} />
        <SummaryRow etiket="Yarı mamul" deger={metre(s.yariMamul.metre)} ek={`${formatCount(s.yariMamul.top)} top`} erisim={erisim} />
        {s.iplikKg !== null && <SummaryRow etiket="İplik" deger={kg(s.iplikKg)} erisim={erisim} />}
      </RowList>
    </SectionCard>
  );
}

/** Fason özeti; emanet (müşteri malı) aynı kutuda ayrı satır — bizim stoka karışmaz. */
export function PanoFason({ f, emanet, erisim }: { f: PanoSummary["fasonOzeti"]; emanet: PanoSummary["emanet"]; erisim: PanoErisim }) {
  if (!f && !emanet) return null;
  return (
    <SectionCard title="Fason ve emanet">
      <RowList>
        {f && <SummaryRow etiket="Fasonda" deger={metre(f.disaridakiMetre)} ek={`${formatCount(f.disaridakiTop)} top`} hedef={BOX_TARGETS.fasonOzeti} erisim={erisim} />}
        {f && <SummaryRow etiket="Fasoncu" deger={formatCount(f.fasoncuSayisi)} erisim={erisim} />}
        {emanet && <SummaryRow etiket="Emanet (müşteri malı)" deger={metre(emanet.metre)} ek={`${formatCount(emanet.top)} top`} erisim={erisim} />}
      </RowList>
    </SectionCard>
  );
}

/** Alacak — para birimi başına satır; birimler TOPLANMAZ. */
export function PanoAlacak({ f, erisim }: { f: NonNullable<PanoSummary["finans"]>; erisim: PanoErisim }) {
  return (
    <SectionCard title="Alacaklar" description="Açık · vadesi geçmiş">
      {f.alacaklar.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Açık alacak yok.</p> : (
        <RowList>
          {f.alacaklar.map((a) => (
            <SummaryRow key={a.paraBirimi} etiket={a.paraBirimi} deger={para(a.acikAlacak, a.paraBirimi)}
              ek={a.vadesiGecmis > 0 ? <span className="text-destructive">{para(a.vadesiGecmis, a.paraBirimi)}</span> : "—"}
              hedef={BOX_TARGETS.alacak} erisim={erisim} />
          ))}
        </RowList>
      )}
    </SectionCard>
  );
}
