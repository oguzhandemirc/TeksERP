import { ReportCard } from "@/components/insight/ReportCard";
import { SPOTLIGHT_CLASS } from "@/components/insight/SpotlightGroup";
import { cn } from "@/lib/utils";
import type { SpotlightRegionProps } from "@/components/insight/useSpotlight";
import type { CenterGroup } from "../_v2/center-model";
import { CATEGORY_LOOK } from "./hub-meta";

interface Props {
  groups: readonly CenterGroup[];
  isFavorite: (key: string) => boolean;
  onToggleFavorite: (key: string) => void;
  /** Kategori bölümü spot ışığı kökü (Rapor Merkezi kart tıklaması). */
  regionProps?: (key: string) => SpotlightRegionProps;
}

/** "Tüm raporlar": süzülmüş gruplar, her rapor kendi adresine bağlı kart (her rapor sayfadan bulunur). */
export function HubReportList({ groups, isFavorite, onToggleFavorite, regionProps }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => {
        const look = CATEGORY_LOOK[g.key];
        return (
          <section key={g.key} aria-label={g.title} {...regionProps?.(g.key)} className={cn("-m-2 p-2", SPOTLIGHT_CLASS)}>
            <h3 data-spotlight-heading className="mb-2 text-sm font-semibold outline-none">
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
