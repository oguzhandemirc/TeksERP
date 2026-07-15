import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * v3 "Kurumsal Tasarım" bölüm başlığı: kısa dik ray + uppercase harf-aralıklı
 * başlık + sağda opsiyonel sayaç. `active` → ray accent renginde (mal orada).
 */
export function V3Section({
  id,
  title,
  count,
  active,
  children,
}: {
  id?: string;
  title: string;
  count?: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className={cn("sec-head", active && "run")}>
        <span className="rail" />
        <h2>{title}</h2>
        {count != null && (
          <>
            <span className="spacer" />
            <span className="count">{count}</span>
          </>
        )}
      </div>
      {children}
    </section>
  );
}
