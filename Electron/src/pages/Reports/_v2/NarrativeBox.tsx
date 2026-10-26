import { ANLATI_EKRAN_SAYISI, type AnlatiCumlesi } from "./sunum";

export const NARRATIVE_TITLE = "Ne görüyoruz?";

export const NARRATIVE_EMPTY = "Bu dönem için söylenecek bir şey bulunmadı.";

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
    <section className="h-full rounded-lg border bg-muted/30 p-4" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{NARRATIVE_EMPTY}</p>
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
