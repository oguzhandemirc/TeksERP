import { Link } from "react-router-dom";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";

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
      <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.key} to={tile.to} className="group">
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
        ))}
      </div>
    </div>
  );
}
