import { AlertCircle } from "lucide-react";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { RaporGrafik } from "./grafik/RaporGrafik";
import type { RaporSunumu } from "./sunum";
import { HeadlineCard } from "./HeadlineCard";
import { NarrativeBox } from "./NarrativeBox";
import { PeriodCompareTable } from "./PeriodCompareTable";
import { SmallMultiples } from "./SmallMultiples";
import { ReportTable, type ReportRowLink } from "./ReportTable";

interface Props {
  presentation: RaporSunumu;
  /** Verinin sunucudan alındığı an (ms). */
  fetchedAt: number;
  /** Tablo satırından geçiş (yalnız kendi sayfası olan raporlar verir). */
  rowLink?: ReportRowLink;
}

/** Şablonun gövdesi (plan §4.1): ana sayı | Ne görüyoruz? → uyarılar → küçük çoklular → dönem kıyası → grafik → tablo → tanımlar + veri satırı. */
export function ReportBody({ presentation: p, fetchedAt, rowLink }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <HeadlineCard headline={p.anaSayi} sideFigures={p.yanSayilar} comparisonLabel={p.kiyasDonemi?.etiket} />
        </div>
        <div className="md:col-span-3">
          <NarrativeBox sentences={p.anlati} />
        </div>
      </div>
      {p.uyarilar.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          {p.uyarilar.map((u) => (
            <li key={u} className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{u}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.varyant?.hucreler?.length ? <SmallMultiples block={p.varyant} comparisonLabel={p.kiyasDonemi?.etiket} /> : null}
      {p.donemler?.length ? <PeriodCompareTable periods={p.donemler} /> : null}
      {p.grafik ? (
        <section className="rounded-lg border p-4" aria-label="Grafik">
          <RaporGrafik blok={p.grafik} baslik={p.baslik} />
        </section>
      ) : null}
      {p.tablo ? <ReportTable table={p.tablo} rowLink={rowLink} /> : null}
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
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">canlı</span>
        </p>
      </footer>
    </div>
  );
}
