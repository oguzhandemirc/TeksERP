import { type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export interface HubTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
}

interface Props {
  title: string;
  description?: string;
  tiles: HubTile[];
}

/** Domain alt-rapor hub'ı — tile grid layout, izin filtresi parent'ta yapılır. */
export function ReportHubGrid({ title, description, tiles }: Props) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} description={description} />
      <div className="p-6">
        <HubGrid>
          {tiles.map((tile, i) => (
            <HubCard
              key={tile.key}
              to={tile.to}
              title={tile.title}
              description={tile.description}
              icon={tile.icon}
              index={i}
            />
          ))}
        </HubGrid>
      </div>
    </div>
  );
}
