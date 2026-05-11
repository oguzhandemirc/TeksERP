import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ADMIN_PERMISSION_LIST } from "@/types/auth";
import { navGroups, type NavItem } from "./nav-config";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface Props {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: Props) {
  const { isAdmin, hasPermission, hasAnyPermission } = useRoleAccess();

  const visible = (item: NavItem) => {
    if (item.adminOnly && !isAdmin && !hasAnyPermission(ADMIN_PERMISSION_LIST)) return false;
    if (item.permission && !hasPermission(item.permission)) return false;
    return true;
  };

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-card/40 transition-[width] duration-150",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <TooltipProvider delayDuration={150}>
        <nav className="flex-1 overflow-y-auto p-2">
          {navGroups.map((group) => {
            const items = group.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-3">
                {!collapsed && (
                  <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                )}
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <SidebarLink key={item.to} item={item} collapsed={collapsed} />
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </TooltipProvider>

      <div className="border-t p-2 text-[10px] text-muted-foreground">
        {!collapsed ? (
          <span>by Etkili Yazılım</span>
        ) : (
          <span className="flex justify-center">EY</span>
        )}
      </div>
    </aside>
  );
}

interface LinkProps {
  item: NavItem;
  collapsed: boolean;
}

function SidebarLink({ item, collapsed }: LinkProps) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          collapsed && "justify-center px-0",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );

  if (!collapsed) return <li>{link}</li>;
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
