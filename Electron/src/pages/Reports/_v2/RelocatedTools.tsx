import { Link } from "react-router-dom";
import { ArrowRight, Waypoints } from "lucide-react";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { relocatedToolsAt } from "./legacy-model";

function useRelocatedTools(host: string) {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  return relocatedToolsAt(host, { isAdmin, hasPermission, ctx });
}

/**
 * Rapor menüsünden çıkan aracın yeni yerindeki KARO bölümü (hub sayfaları). Bayrak kapalıyken
 * ya da rapor bu kişiye açık değilken `null` — hub DOM'u bugünküyle aynı kalır.
 */
export function RelocatedToolsSection({ host, title }: { host: string; title: string }) {
  const tools = useRelocatedTools(host);
  if (tools.length === 0) return null;
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline gap-2">
        <Waypoints className="h-4 w-4 self-center text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <HubGrid>
        {tools.map((t, i) => (
          <HubCard
            key={t.reportKey}
            to={t.to}
            title={t.title}
            description={t.description}
            icon={t.icon}
            index={i}
          />
        ))}
      </HubGrid>
    </section>
  );
}

/** Ekran sayfalarında (Tezgah Salonu, Leventler, Sistem Kayıtları, Etkinlik) başlık altı araç şeridi. */
export function RelocatedToolStrip({ host }: { host: string }) {
  const tools = useRelocatedTools(host);
  if (tools.length === 0) return null;
  return (
    <div
      role="navigation"
      aria-label="Bu ekranın araçları"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-2 text-sm"
    >
      <span className="text-muted-foreground">Bu ekranın aracı:</span>
      {tools.map((t) =>
        // Araç bu ekranın içindeyse (Cari Ekstre satır düğmesi) kendine bağlantı verilmez, yeri söylenir.
        t.to === host ? (
          <span key={t.reportKey} className="inline-flex items-center gap-1">
            <t.icon className="h-4 w-4 text-primary" aria-hidden />{" "}
            <span className="font-medium">{t.title}</span> — {t.description}
          </span>
        ) : (
          <Link
            key={t.reportKey}
            to={t.to}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <t.icon className="h-4 w-4" aria-hidden /> {t.title}{" "}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ),
      )}
    </div>
  );
}
