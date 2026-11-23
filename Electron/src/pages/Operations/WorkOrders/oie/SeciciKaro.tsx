// İş emri oluştur seçicilerinin (terbiye K6 · dokuma) ortak satır + karo görünümü. HubCard görünümü;
// fark: gezinme `state` taşır (HubCard yalnız adres alır) ve karo isteğe bağlı ikincil eylem (düzenle) taşır.
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { HubGrid } from "@/components/hub/HubCard";
import { cn } from "@/lib/utils";
import { springSnappy, staggerItem } from "@/lib/motion";

export function PickerRow({ title, icon: Icon, testId, children }: { title: string; icon: LucideIcon; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId}>
      <div className="mb-3 flex items-baseline gap-2">
        <Icon className="h-4 w-4 self-center text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <HubGrid className="2xl:grid-cols-4">{children}</HubGrid>
    </section>
  );
}

export interface SeciciKaroProps {
  icon: LucideIcon;
  tone: string;
  title: string;
  hint: string;
  testId: string;
  dashed?: boolean;
  onClick: () => void;
  /** Kartın sağ üstünde, ok yerine (ör. şablonu düzenle); tıklaması kartın gezinmesini tetiklemez. */
  aside?: ReactNode;
}

export function SeciciKaro({ icon: Icon, tone, title, hint, testId, dashed, onClick, aside }: SeciciKaroProps) {
  return (
    <motion.div variants={staggerItem} whileHover={{ y: -3 }} transition={springSnappy} className="relative h-full">
      <button type="button" onClick={onClick} data-testid={testId} className="group block h-full w-full text-left">
        <Card className={cn("card-glow relative h-full overflow-hidden bg-gradient-to-br from-primary/5 to-transparent p-4", dashed && "border-dashed bg-none")}>
          <div className="relative flex items-start justify-between">
            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-current/10", tone)}>
              <Icon className="h-5 w-5" />
            </div>
            {!aside && (
              <ArrowRight className={cn("h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100", tone)} />
            )}
          </div>
          <div className="relative mt-4 font-medium">{title}</div>
          <p className="relative mt-1 text-xs text-muted-foreground">{hint}</p>
        </Card>
      </button>
      {aside && <div className="absolute right-3 top-3">{aside}</div>}
    </motion.div>
  );
}
