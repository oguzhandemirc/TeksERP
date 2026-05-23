import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ADMIN_PERMISSION_LIST } from "@/types/auth";
import { navGroups, type NavItem, type NavGroup } from "./nav-config";
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

  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter(visible) }))
    .filter((g) => g.items.length > 0);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-card/40 transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-56",
      )}
    >
      <TooltipProvider delayDuration={150}>
        {collapsed ? <CollapsedNav groups={groups} /> : <ExpandedNav groups={groups} />}
      </TooltipProvider>

      <Footer collapsed={collapsed} />
    </aside>
  );
}

function CollapsedNav({ groups }: { groups: NavGroup[] }) {
  return (
    <nav className="flex flex-1 flex-col items-center overflow-y-auto py-4">
      {groups.map((group, idx) => (
        <div key={group.label} className="flex w-full flex-col items-center">
          {idx > 0 && <div className="my-2 h-px w-8 bg-border/50" />}
          <ul className="flex w-full flex-col items-center gap-1.5">
            {group.items.map((item) => (
              <CollapsedItem key={item.to} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ExpandedNav({ groups }: { groups: NavGroup[] }) {
  return (
    <nav className="flex-1 overflow-y-auto py-3">
      {groups.map((group) => (
        <div key={group.label} className="mb-4">
          <p className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {group.label}
          </p>
          <ul className="space-y-1 px-2">
            {group.items.map((item) => (
              <ExpandedItem key={item.to} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function CollapsedItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <li style={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={item.to}
            end={item.to === "/"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 8,
              transition: "background-color 150ms, color 150ms",
            }}
            className={({ isActive }) =>
              cn(
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )
            }
          >
            <Icon size={18} strokeWidth={2} aria-hidden />
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function ExpandedItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.to === "/"}
        className={({ isActive }) =>
          cn(
            "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
            isActive
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )
        }
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </NavLink>
    </li>
  );
}

function Footer({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-border/50 py-3">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground/50">EY</p>
      </div>
    );
  }
  return (
    <div className="border-t border-border/50 py-3">
      <p className="px-4 text-[10px] text-muted-foreground/50">by Etkili Yazılım</p>
    </div>
  );
}
