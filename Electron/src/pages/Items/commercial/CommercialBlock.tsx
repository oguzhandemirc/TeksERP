// "Ticari" sekmesinin ortak bölüm çerçevesi: başlık + ⓘ + sağda "… ekranında aç" (yeni sekmede; ürün penceresi kalır).
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { openScreenTab } from "./itemCommercial";

interface Props {
  title: string;
  info: string;
  openLabel: string;
  openPath: string;
  children: ReactNode;
}

export function CommercialBlock({ title, info, openLabel, openPath, children }: Props) {
  return (
    <section className="space-y-2 rounded-md border p-4" aria-label={title}>
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <InfoPopover label={title} desc={info} />
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-xs" onClick={() => openScreenTab(openPath)}>
          <ExternalLink className="h-3.5 w-3.5" /> {openLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}

/** Bölüm içi durum satırı (yükleniyor / boş). */
export function MutedLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
