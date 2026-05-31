import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFavorites } from "@/hooks/useFavorites";
import { findBreadcrumbParent, findCommandEntry } from "./command-entries";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const entry = findCommandEntry(pathname);
  const parent = findBreadcrumbParent(pathname);
  const { isFavorite, toggleFavorite } = useFavorites();
  const fav = isFavorite(pathname);

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b bg-gradient-to-r from-primary/[0.07] via-transparent to-transparent px-6 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-stretch gap-3">
        <span className="my-0.5 w-1 shrink-0 rounded-full bg-primary/70" aria-hidden />
        <div className="min-w-0">
          {parent && (
            <button
              type="button"
              onClick={() => navigate(parent.to)}
              className="mb-0.5 flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {parent.label}
              <ChevronRight className="h-3 w-3 opacity-60" />
            </button>
          )}
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {(entry || actions) && (
        <div className="flex items-center gap-2">
          {entry && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleFavorite(pathname)}
              aria-label={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
              title={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
            >
              <Star
                className={cn("h-4 w-4", fav ? "fill-primary text-primary" : "text-muted-foreground")}
              />
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
