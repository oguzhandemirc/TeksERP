import { AlertCircle } from "lucide-react";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { RaporGrafik } from "./grafik/RaporGrafik";
import type { RaporSunumu } from "./sunum";
import { HeadlineCard } from "./HeadlineCard";
import { NarrativeBox } from "./NarrativeBox";
import { PeriodCompareTable } from "./PeriodCompareTable";
import { SmallMultiples } from "./SmallMultiples";
import { ReportTable, type ReportRowLink } from "./ReportTable";

/** Gövdedeki anlatı kartının başlığı (ekran); belge kendi başlığını basar. */
export const HIGHLIGHTS_TITLE = "Öne çıkanlar";

interface Props {
  presentation: RaporSunumu;
  /** Verinin sunucudan alındığı an (ms). */
  fetchedAt: number;
  /** Tablo satırından geçiş (yalnız kendi sayfası olan raporlar verir). */
  rowLink?: ReportRowLink;
}

/**
 * Şablonun gövdesi — tam genişlik: sayı kartları şeridi | Öne çıkanlar → uyarılar → küçük çoklular →
 * dönem kıyası → grafik + tablo ızgarası (geniş kapta iki sütun) → tanımlar + veri satırı.
 */
export function ReportBody({ presentation: p, fetchedAt, rowLink }: Props) {
  return (
    <div className="@container flex flex-col gap-4">
      <div className="grid gap-4 @5xl:grid-cols-12">
        <div className="@5xl:col-span-8">
          <HeadlineCard headline={p.anaSayi} sideFigures={p.yanSayilar} comparisonLabel={p.kiyasDonemi?.etiket} />
        </div>
        <div className="@5xl:col-span-4">
          <NarrativeBox sentences={p.anlati} title={HIGHLIGHTS_TITLE} />
        </div>
      </div>
      {p.uyarilar.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning-soft-foreground">
          {p.uyarilar.map((u) => (
            <li key={u} className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{u}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.varyant?.hucreler?.length ? <SmallMultiples block={p.varyant} comparisonLabel={p.kiyasDonemi?.etiket} /> : null}
      {p.donemler?.length ? <PeriodCompareTable periods={p.donemler} /> : null}
      <div className={p.grafik && p.tablo ? "grid items-start gap-4 @5xl:grid-cols-2" : "grid gap-4"}>
        {p.grafik ? (
          <section className="min-w-0 rounded-xl border border-card-border bg-card p-4 shadow-card" aria-label="Grafik">
            <RaporGrafik blok={p.grafik} baslik={p.baslik} />
          </section>
        ) : null}
        {p.tablo ? <ReportTable table={p.tablo} rowLink={rowLink} /> : null}
      </div>
      <footer className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground">
        {p.tanimlar.length > 0 ? (
          <details>
            <summary className="cursor-pointer font-medium text-foreground">Bu rapor ne sayar?</summary>
            <dl className="mt-2 space-y-1.5">
              {p.tanimlar.map((t) => (
                <div key={t.ad}>
                  <dt className="font-medium text-foreground">{t.ad}</dt>
                  <dd>{t.aciklama}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        <p>
          Dönem: {p.donem.etiket}
          {p.kiyasDonemi ? ` · Kıyas: ${p.kiyasDonemi.etiket}` : ""} · Veri: {fmtFactoryDateTime(new Date(fetchedAt))}{" "}
          <span className="rounded bg-success-soft px-1.5 py-0.5 font-medium text-success-soft-foreground">canlı</span>
        </p>
      </footer>
    </div>
  );
}
