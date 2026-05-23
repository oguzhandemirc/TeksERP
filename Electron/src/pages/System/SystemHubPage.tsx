import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { systemTiles, systemTileSections, type SystemTile } from "./tile-config";

export function SystemHubPage() {
  const { isAdmin } = useRoleAccess();
  const visibleTiles = systemTiles.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Sistem" description="Aktivite, ayarlar ve sistem kayıtları." />
      <div className="space-y-8 p-6">
        {systemTileSections.map((section) => {
          const tiles = visibleTiles.filter((t) => t.group === section.group);
          if (tiles.length === 0) return null;
          return (
            <section key={section.group}>
              <div className="mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground/80">
                  {section.description}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tiles.map((tile) => (
                  <TileCard key={tile.key} tile={tile} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TileCard({ tile }: { tile: SystemTile }) {
  return (
    <Link to={tile.to} className="group">
      <Card className="h-full p-4 transition-colors hover:border-foreground/20 hover:bg-accent/30">
        <div className="flex items-start justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
            <tile.icon className="h-4 w-4" />
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="mt-4">
          <div className="font-medium">{tile.title}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{tile.description}</p>
        </div>
      </Card>
    </Link>
  );
}
