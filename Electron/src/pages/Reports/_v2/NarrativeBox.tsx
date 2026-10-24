import { ANLATI_EKRAN_SAYISI, type AnlatiCumlesi } from "./sunum";

export const NARRATIVE_TITLE = "Ne görüyoruz?";

interface Props {
  sentences: AnlatiCumlesi[];
}

/** Sunucunun anlatısını AYNEN basar (önem sırası sunucuda); istemci cümle kurmaz, yalnız ilk N'i keser. */
export function NarrativeBox({ sentences }: Props) {
  const shown = sentences.slice(0, ANLATI_EKRAN_SAYISI);
  return (
    <section className="h-full rounded-lg border bg-muted/30 p-4" aria-label={NARRATIVE_TITLE}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{NARRATIVE_TITLE}</h2>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Bu dönem için söylenecek bir şey bulunmadı.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-[15px] leading-relaxed">
          {shown.map((s, i) => (
            <li key={`${i}-${s.kural}`} className="flex gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{s.metin}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
