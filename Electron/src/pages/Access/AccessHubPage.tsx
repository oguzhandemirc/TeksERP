import { PageHeader } from "@/components/layout/PageHeader";
import { accessTiles } from "./tile-config";
import { HubCard, HubGrid } from "@/components/hub/HubCard";

export function AccessHubPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Yetkilendirme"
        description="Kullanıcı ve yetki yönetimi."
      />
      <div className="p-6">
        <HubGrid>
          {accessTiles.map((tile, i) => (
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
