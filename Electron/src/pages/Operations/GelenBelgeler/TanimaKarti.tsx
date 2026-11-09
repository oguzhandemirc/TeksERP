// Belge detayı "Tanıma" kartı (belge tanıt 3 aşama): ① hangi tiple tanındı (okunduğu SÜRÜM, güven) · ② belge alanı → iş emri
// karşılığı (gruplar çerçeveyle) · ③ uygulanan kurallar ve kaynağı. Blok sunucunun `tanima`sıdır; panel hiçbir şey türetmez.
import type { ReactNode } from "react";
import type { Tanima, TanimaMappingRow } from "./tanimaTypes";
import { FIELD_GROUP_LABEL, FIELD_GROUP_ORDER } from "./tanit/fieldTargets";

/** ① satırı: "Tanındı: Kömürhan Çeki Listesi · sürüm 3 · %94" / "Hazır şablon" / "Tanınmadı". */
export function recognitionText(t: Tanima): string {
  if (t.durum === "TANITILMAMIS" || !t.template) return t.durum === "SISTEM" ? "Hazır şablonla okundu" : "Tanınmadı — alanlar genel sözlükle okundu";
  const score = t.template.score != null ? ` · %${Math.round(t.template.score * 100)}` : "";
  return `${t.durum === "SISTEM" ? "Hazır şablon" : "Tanındı"}: ${t.template.name} · sürüm ${t.template.version}${score}`;
}

function Step({ no, title, children }: { no: string; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>{no}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        {children}
      </div>
    </div>
  );
}

function MappingGroups({ rows }: { rows: TanimaMappingRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">Eşlenen alan yok.</p>;
  return (
    <div className="space-y-1.5">
      {FIELD_GROUP_ORDER.map((g) => {
        const inGroup = rows.filter((r) => r.group === g);
        if (inGroup.length === 0) return null;
        return (
          <ul key={g} className="divide-y rounded-md border" aria-label={FIELD_GROUP_LABEL[g]} data-testid={`tanima-group-${g}`}>
            {inGroup.map((r) => (
              <li key={r.field} className="flex items-baseline justify-between gap-2 px-2.5 py-1 text-sm">
                <span className="min-w-0">
                  <b className="font-medium">{r.woLabel}</b>
                  {r.label !== r.woLabel && <span className="text-xs text-muted-foreground"> ← {r.label}</span>}
                </span>
                <span className={`shrink-0 tabular-nums ${r.value ? "" : "text-muted-foreground"}`}>{r.value ?? "—"}</span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

export function TanimaKarti({ tanima }: { tanima: Tanima | undefined }) {
  if (!tanima) return null;
  const known = tanima.durum !== "TANITILMAMIS" && !!tanima.template;
  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="tanima-karti">
      <h3 className="text-sm font-semibold">Tanıma</h3>
      <Step no="1" title="Belge tipi">
        <p className={`text-sm ${known ? "" : "text-amber-800 dark:text-amber-300"}`} data-testid="tanima-durum">{recognitionText(tanima)}</p>
      </Step>
      {known && (
        <Step no="2" title="Eşleme — belge alanı → iş emri">
          <MappingGroups rows={tanima.mapping} />
        </Step>
      )}
      {tanima.rules.length > 0 && (
        <Step no="3" title="Kurallar">
          <ul className="space-y-0.5 text-sm" data-testid="tanima-kurallar">
            {tanima.rules.map((r) => (
              <li key={r.key}>
                {r.text} <span className="text-xs text-muted-foreground">({r.sourceText})</span>
              </li>
            ))}
          </ul>
        </Step>
      )}
    </section>
  );
}
