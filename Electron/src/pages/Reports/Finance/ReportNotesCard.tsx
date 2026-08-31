// Backend'in yol gösterici notlarını OLDUĞU GİBİ basan kart.
//
// ⚠️ Bu notlar süs değil: "vade uydurulmaz", "sanal mahsup deftere yazılmaz",
// "kur bulunamadı, TL karşılığı basılmadı" gibi cümleler rakamın NASIL
// okunacağını söyler. Yutulursa rakam yanlış okunur ve ekran bunu hiçbir yerde
// itiraf etmez. Metni burada YENİDEN YAZMA — backend değişince ikisi ayrışır.
import { Card } from "@/components/ui/card";

interface Props {
  title: string;
  notes: string[];
}

export function ReportNotesCard({ title, notes }: Props) {
  if (notes.length === 0) return null;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Card>
  );
}
