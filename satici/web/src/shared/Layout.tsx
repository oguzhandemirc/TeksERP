// Kabuk: sol menü (yalnız izni olan öğeler; ERİŞİM oturumunda hassas izinli öğe yok) + üst bilgi (kullanıcı, çıkış).
// İçerik <Outlet/>.
import { NavLink, Outlet } from "react-router-dom";
import { ROLE_LABEL, label } from "./labels";
import type { PortalPermission } from "./permissions";
import { canUse } from "./permissions";
import { useListener, useSession, useUser } from "./session";
import { Button } from "./ui";

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly permission: PortalPermission;
}

export function Layout({ product, nav }: { product: string; nav: readonly NavItem[] }) {
  const user = useUser();
  const listener = useListener();
  const { logout } = useSession();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">{product}</div>
        <nav aria-label="Ana menü">
          {nav
            .filter((n) => canUse(user.rol, n.permission, listener))
            .map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                {n.label}
              </NavLink>
            ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="muted">
            {user.adSoyad} · {label(ROLE_LABEL, user.rol)}
          </span>
          <span className="topbar-actions">
            <NavLink to="/hesabim" className="nav-link">
              Hesabım
            </NavLink>
            <Button variant="ghost" onClick={() => void logout()}>
              Çıkış
            </Button>
          </span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
