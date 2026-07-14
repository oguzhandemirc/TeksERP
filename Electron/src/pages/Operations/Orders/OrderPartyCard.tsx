import { Building2, MapPin, Hash } from "lucide-react";
import type { Order } from "./types";

interface Props {
  customer?: Order["customer"];
  branch?: Order["branch"];
}

/**
 * Sipariş detay panelinin üst kimlik kartı: müşteri (şirket) adı + kodu,
 * altında şube adı ve şube kodu etiketli alanlar. Şube yoksa yalnız müşteri.
 */
export function OrderPartyCard({ customer, branch }: Props) {
  const location = branch
    ? [branch.district, branch.city].filter(Boolean).join(" / ")
    : "";

  return (
    <div className="overflow-hidden rounded-lg border bg-gradient-to-br from-muted/50 to-background shadow-sm">
      {/* Müşteri (şirket) */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Müşteri
          </div>
          <div className="truncate text-base font-semibold leading-tight text-foreground">
            {customer?.name ?? "—"}
          </div>
        </div>
        {customer?.code && (
          <span className="shrink-0 self-start rounded-md border bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
            {customer.code}
          </span>
        )}
      </div>

      {/* Şube + Şube Kodu — aralarında ince ayraç için gap-px + bg-border */}
      {branch && (
        <div className="grid grid-cols-2 gap-px border-t bg-border">
          <div className="bg-background px-4 py-2.5">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3 w-3" /> Şube
            </div>
            <div className="mt-0.5 truncate text-sm font-medium text-foreground">
              {branch.name}
            </div>
            {location && (
              <div className="truncate text-xs text-muted-foreground">{location}</div>
            )}
          </div>
          <div className="bg-background px-4 py-2.5">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Hash className="h-3 w-3" /> Şube Kodu
            </div>
            <div className="mt-0.5 truncate font-mono text-sm font-medium text-foreground">
              {branch.code ?? <span className="text-muted-foreground">—</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
