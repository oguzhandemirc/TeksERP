// Backend'in yol gösterici notlarını OLDUĞU GİBİ basan alt satır.
//
// ⚠️ Bu notlar süs değil: "vade uydurulmaz", "sanal mahsup deftere yazılmaz",
// "kur bulunamadı, TL karşılığı basılmadı" gibi cümleler rakamın NASIL
// okunacağını söyler. Metni burada YENİDEN YAZMA — backend değişince ikisi ayrışır.
// Görünüm v2 gövdesinin "Bu rapor ne sayar? ⓘ" alt satırıyla aynı (akışta kart değil; denetim O11/O19).
import { InfoPopover } from "@/components/ui/info-popover";

interface Props {
  title: string;
  notes: string[];
}

export function ReportNotesCard({ title, notes }: Props) {
  if (notes.length === 0) return null;
  return (
    <footer className="flex items-center gap-1 border-t pt-3 text-xs font-medium text-foreground" data-testid="report-notes">
      {title}
      <InfoPopover
        label={title}
        desc={
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        }
      />
    </footer>
  );
}
