// Rapor menüsünden ekrana taşınan araçların BAŞLIK DÜĞMESİ biçimi ("Bu ekranın aracı" şeridi yerine).
// Akışa ayrı satır koymaz (kullanıcı 2026-11-23); araç açık değilse hiçbir şey çizmez. Kaynak liste aynı: `relocatedToolsAt`.
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { relocatedToolsAt } from "@/pages/Reports/_v2/legacy-model";

export function RelocatedToolButtons({ host }: { host: string }) {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  // Araç bu ekranın içindeyse (ör. Cari Ekstre satır düğmesi) kendine bağlantı verilmez.
  const tools = relocatedToolsAt(host, { isAdmin, hasPermission, ctx }).filter((t) => t.to !== host);
  if (tools.length === 0) return null;
  return (
    <>
      {tools.map((t) => (
        <Button key={t.reportKey} asChild variant="outline" size="sm" title={t.description}>
          <Link to={t.to}>
            <t.icon className="mr-1 h-4 w-4" aria-hidden />
            {t.title}
          </Link>
        </Button>
      ))}
    </>
  );
}
