import { type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
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
    // TabHost sayfayı `absolute inset-0` sarar: `min-h-0` olmadan kap içeriğe
    // göre büyür ve BAŞLIK dahil tüm panel kayar. PageShell/PageBody bunu
    // kapatır — tek kaydırıcı gövdedir, başlık sabit kalır.
    <PageShell>
      <PageHeader title={title} description={description} />
      <PageBody className="p-6">
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
      </PageBody>
    </PageShell>
  );
}
