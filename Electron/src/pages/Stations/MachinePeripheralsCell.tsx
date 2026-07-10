import { Link } from "react-router-dom";
import { Printer, Scale, Ruler, Zap, FlaskConical, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  peripheralKindLabels,
  connectionTypeLabels,
  type PeripheralDevice,
  type PeripheralKind,
} from "@/pages/PeripheralDevices/types";

const KIND_ICON: Record<PeripheralKind, LucideIcon> = {
  LABEL_PRINTER: Printer,
  SCALE: Scale,
  METER: Ruler,
  SIGNAL_SOURCE: Zap,
};

/** Bir makineye bağlı cihazların (metre/yazıcı/tartı) makine satırı altında
 *  genişletilen kompakt listesi. Salt görünüm — düzenleme merkezi Cihaz Kaydı'nda
 *  (Tanımlar → Donanım); alttaki bağlantı oraya götürür. */
export function MachinePeripheralsCell({ peripherals }: { peripherals: PeripheralDevice[] }) {
  if (peripherals.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-1 text-xs text-muted-foreground">
        <FlaskConical className="h-3.5 w-3.5" />
        Bu makineye bağlı cihaz yok.
        <Link to="/definitions/peripherals" className="font-medium text-primary hover:underline">
          Cihaz Kaydı'ndan ekle
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 py-1">
      {peripherals.map((p) => {
        const Icon = KIND_ICON[p.kind] ?? FlaskConical;
        // Yazıcıda dil, giriş cihazında adres/bağlantı en ayırt edici bilgi.
        const detail =
          p.kind === "LABEL_PRINTER"
            ? (p.languageOverride ?? "dil: genel")
            : (p.address || connectionTypeLabels[p.connectionType]);
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">{p.name}</span>
            <Badge variant="secondary" className="font-normal">
              {peripheralKindLabels[p.kind]}
            </Badge>
            <span className="text-muted-foreground">{detail}</span>
            {p.simulate && (
              <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
                simülasyon
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}
