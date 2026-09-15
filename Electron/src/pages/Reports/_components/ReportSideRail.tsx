import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { reportKeyOfPath } from "@/lib/report-gate";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { reportCategoryTiles, reportCategoryTitle } from "../tile-config";

/**
 * Sağ kenar rail'i — bulunulan rapor kategorisi içinde diğer raporlara hızlı
 * geçiş için. Kategoriyi URL'den çözer (`/reports/<category>/<report>`).
 * Hub sayfasında veya tanınmayan path'te hiç render etmez.
 *
 * Yatay viewport dar olduğunda (lg altı) gizlenir → mobile/küçük ekran
 * kullanıcıları soldaki ana Sidebar'dan geçer.
 */
export function ReportSideRail() {
  const location = useLocation();
  const { isReportOpen } = useOperationsVisibilityContext();
  const parts = location.pathname.split("/").filter(Boolean);
  // beklenen: ["reports", "<category>", "<report?>"]
  if (parts[0] !== "reports" || parts.length < 3) return null;

  const category = parts[1] ?? "";
  // Kapalı rapor şeritte de yoktur — hub karosuyla aynı yüklem (K5).
  const tiles = reportCategoryTiles[category]?.filter((t) => {
    const key = reportKeyOfPath(t.to);
    return key !== null && isReportOpen(key);
  });
  if (!tiles || tiles.length === 0) return null;

  const title = reportCategoryTitle[category] ?? "Bu Kategori";

  return (
    <aside className="hidden w-[220px] shrink-0 border-l bg-card/30 lg:block">
      <div className="sticky top-0 max-h-screen overflow-y-auto p-3">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {title}
        </p>
        <ul className="space-y-1">
          {tiles.map((t) => {
            const Icon = t.icon;
            return (
              <li key={t.key}>
                <NavLink
                  to={t.to}
                  end
                  className={({ isActive }) =>
                    cn(
                      "flex items-start gap-2 rounded-md px-2 py-2 text-xs transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )
                  }
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">{t.title}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
