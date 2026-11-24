// Döküm (plan §5): satırlar + Ham → Mamul → Sağlam → Genel gider → STANDART zinciri. HER sayı sunucu alanıdır;
// toplam satırlardan TOPLANMAZ (bekçi: cost-no-client-math + CostBreakdown.test).
import { cn } from "@/lib/utils";
import type { CostLineOut, CostResultOut } from "./cost-types";
import { fmtDec, fmtDecFull, fmtQtyDec, fmtQtyDecFull } from "./format";
import { missingText, warningText } from "./labels";
import { missingTarget } from "./missing-targets";
import { Link } from "react-router-dom";
import { PresentationNote, presentationAmount } from "./PresentationNote";

export function CostBreakdown({ sonuc, eksikler, uyarilar }: { sonuc: CostResultOut | null; eksikler: string[]; uyarilar: string[] }) {
  return (
    <div className="space-y-3">
      <CostIssues eksikler={eksikler} uyarilar={uyarilar} />
      {sonuc && <PresentationNote p={sonuc} />}
      {sonuc ? <ResultTable s={sonuc} /> : !eksikler.length && (
        <p className="text-sm text-muted-foreground">Maliyet hesaplanamadı — sonuç tahminle doldurulmaz.</p>
      )}
    </div>
  );
}

// M10: eksikler TEK kartta (başlık + madde listesi); ayrı kesik kutu aynı şeyi yinelemez.
export function CostIssues({ eksikler, uyarilar }: { eksikler: string[]; uyarilar: string[] }) {
  if (!eksikler.length && !uyarilar.length) return null;
  return (
    <div className="space-y-2 text-sm">
      {eksikler.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-destructive">
          <p className="font-semibold">Eksikler giderilmeden maliyet hesaplanmaz — sonuç tahminle doldurulmaz.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {eksikler.map((c) => {
              // Eksiğin giderildiği ekrana tek tık (M10): yol metinde anlatılmakla kalmaz.
              const t = missingTarget(c);
              return (
                <li key={c} data-code={c}>
                  {missingText(c)}
                  {t?.kind === "link" && (
                    <Link className="ml-1.5 whitespace-nowrap font-medium underline-offset-4 hover:underline" to={t.to}>
                      {t.cta ?? t.label} →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {uyarilar.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-300">
          <p className="font-semibold">Uyarılar</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {uyarilar.map((c) => <li key={c} data-code={c}>{warningText(c)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ResultTable({ s }: { s: CostResultOut }) {
  const chain: Array<[string, string | null, boolean?]> = [
    ["Ham metre maliyeti", s.hamTlM],
    ["Mamul (terbiye + çekme)", s.mamulTlM],
    ["Sağlam (kalite firesi)", s.saglamTlM],
    ["Genel gider", s.genelGiderTlM],
    ["STANDART METRE MALİYETİ", s.standartTlM, true],
  ];
  const cur = s.sunumDovizi;
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full min-w-[30rem] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr><th className="px-3 py-2">Kalem</th><th className="px-3 py-2 text-right">Miktar</th><th className="px-3 py-2 text-right">Birim fiyat (TL)</th><th className="px-3 py-2 text-right">TL/m</th>{cur && <th className="px-3 py-2 text-right">{cur}/m</th>}</tr>
        </thead>
        <tbody>
          {s.satirlar.map((l) => <LineRow key={l.sira} l={l} withCurrency={!!cur} />)}
          {chain.filter(([, v]) => v !== null).map(([label, v, strong]) => (
            <tr key={label} className={cn("border-t", strong ? "bg-primary/5 text-base font-semibold" : "bg-muted/20 font-medium")}>
              <td className="px-3 py-2" colSpan={3}>{label}</td>
              <td className="px-3 py-2 text-right tabular-nums" title={v ? `${fmtDecFull(v)} TL/m` : undefined} data-testid={strong ? "cost-total" : undefined}>
                {v === null ? "—" : `${fmtDec(v)}${strong ? " TL/m" : ""}`}
              </td>
              {cur && (
                <td className="px-3 py-2 text-right tabular-nums" data-testid={strong ? "cost-total-fx" : undefined}>
                  {strong ? presentationAmount(s, s.standartDovizM) : ""}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
        Çözgü {fmtQtyDecFull(s.cozguKgM, 6)} kg/m · Atkı {fmtQtyDecFull(s.atkiKgM, 6)} kg/m · Tezgah {fmtQtyDec(s.tezgahMSaat)} m/sa
      </p>
    </div>
  );
}

function LineRow({ l, withCurrency }: { l: CostLineOut; withCurrency: boolean }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-1.5">{l.etiket}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{l.miktar === null ? "—" : `${fmtQtyDecFull(l.miktar, 6)} ${l.birim ?? ""}`}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtDecFull(l.birimFiyatTl)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums" title={`${fmtDecFull(l.tutarTlM)} TL/m`}>{fmtDec(l.tutarTlM)}</td>
      {withCurrency && <td className="px-3 py-1.5 text-right tabular-nums">{fmtDec(l.tutarDoviz, 4)}</td>}
    </tr>
  );
}
