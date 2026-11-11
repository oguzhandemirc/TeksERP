import { ReportCard } from "@/components/insight/ReportCard";
import type { CenterGroup } from "../_v2/center-model";
import { CATEGORY_LOOK } from "./hub-meta";

interface Props {
  groups: readonly CenterGroup[];
  isFavorite: (key: string) => boolean;
  onToggleFavorite: (key: string) => void;
}

/** "Tüm raporlar": süzülmüş gruplar, her rapor kendi adresine bağlı kart (her rapor sayfadan bulunur). */
export function HubReportList({ groups, isFavorite, onToggleFavorite }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => {
        const look = CATEGORY_LOOK[g.key];
        return (
          <section key={g.key} aria-label={g.title}>
            <h3 className="mb-2 text-sm font-semibold">
              {g.title} <span className="font-normal text-muted-foreground">({g.entries.length})</span>
            </h3>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
              {g.entries.map((e) => (
                <li key={e.key}>
                  <ReportCard
                    to={`/${e.panelYolu}`}
                    title={e.baslik}
                    description={e.soru}
                    icon={look.icon}
                    tone={look.tone}
                    compact
                    favorite={{ active: isFavorite(e.key), onToggle: () => onToggleFavorite(e.key) }}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
