import type { ReactNode } from "react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { useAuthStore } from "@/store/auth";
import { FadeInUp } from "@/components/motion";

/** Dashboard üstündeki karşılama şeridi — tarih + selam + canlı gösterge + işlemler.
 *  Marka accent gradient'i ve blur blob ile; accent değişince yeniden renklenir. */
export function DashboardHero({ actions }: { actions?: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const today = format(new Date(), "d MMMM yyyy · EEEE", { locale: tr });

  return (
    <FadeInUp>
      <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/12 via-card to-card p-5">
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {today}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              Hoş geldin, {user?.username ?? ""} 👋
            </h2>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="live-dot" /> Üretim panosu canlı — güncel durum aşağıda.
            </p>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
    </FadeInUp>
  );
}
