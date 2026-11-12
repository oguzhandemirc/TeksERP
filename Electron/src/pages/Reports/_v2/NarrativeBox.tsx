import { AlertTriangle, GitCompareArrows, Info, Lightbulb, PieChart, Sparkles, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { ANLATI_EKRAN_SAYISI, type AnlatiCumlesi } from "./sunum";

export const NARRATIVE_TITLE = "Ne görüyoruz?";

export const NARRATIVE_EMPTY = "Bu dönem için söylenecek bir şey bulunmadı.";

/** Anlatı kuralı → simge + ton (yalnız görsel; cümle sunucudan aynen). Bilinmeyen kural ampul. */
const RULE_LOOK: Readonly<Record<string, readonly [LucideIcon, IconTileTone]>> = {
  anaSayiKiyas: [TrendingUp, "violet"],
  egilim: [TrendingUp, "blue"],
  degisimKaynagi: [TrendingUp, "blue"],
  sessizlesen: [TrendingDown, "rose"],
  enBuyukPay: [PieChart, "teal"],
  yogunlasma: [PieChart, "teal"],
  korelasyon: [GitCompareArrows, "violet"],
  esikAsimi: [AlertTriangle, "orange"],
  aykiri: [AlertTriangle, "orange"],
  "kursun.hedefSapma": [AlertTriangle, "orange"],
  "iplik.eksik": [AlertTriangle, "orange"],
  "hedefDeger.enCok": [AlertTriangle, "amber"],
  olculemedi: [Info, "sky"],
  veriYok: [Info, "sky"],
  kapsamNotu: [Info, "sky"],
  orneklemUyarisi: [Info, "sky"],
  suzgecKesti: [Info, "sky"],
  "kursun.gramajBilinmiyor": [Info, "sky"],
};

export function ruleLook(kural: string): readonly [LucideIcon, IconTileTone] {
  return RULE_LOOK[kural] ?? [Lightbulb, "amber"];
}

interface Props {
  sentences: AnlatiCumlesi[];
  /** Özel rapor bloğu: sunucu zaten bloğun `enFazla`sıyla kesti; başlık bloğun adı olabilir. */
  limit?: number;
  title?: string;
}

/** Sunucunun anlatısını AYNEN basar (önem sırası sunucuda); istemci cümle kurmaz, yalnız ilk N'i keser. */
export function NarrativeBox({ sentences, limit = ANLATI_EKRAN_SAYISI, title = NARRATIVE_TITLE }: Props) {
  const shown = sentences.slice(0, limit);
  return (
    <section className="h-full rounded-xl border border-card-border bg-card p-4 shadow-card" aria-label={title}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        {title}
      </h2>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{NARRATIVE_EMPTY}</p>
      ) : (
        <ul className="mt-3 space-y-2.5 text-sm leading-snug">
          {shown.map((s, i) => {
            const [icon, tone] = ruleLook(s.kural);
            return (
              <li key={`${i}-${s.kural}`} className="flex items-start gap-2.5">
                <IconTile icon={icon} tone={tone} size="sm" />
                <span className="pt-1">{s.metin}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
