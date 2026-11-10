// KİMLİK BAŞLIĞI — barkod (QR) + müşteri kodu + durum rozetleri. Ürün/metre/kg/kalite/özellikler "Top bilgileri"
// tablosundadır (RollInfoTable, 2026-11-10 tek kaynak).
import { AlertTriangle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { rollStatusLabels } from "@/types/enums";
import type { Roll } from "../types";

function StatusBadges({ roll }: { roll: Roll }) {
  return (
    <div className="flex flex-wrap items-start gap-1">
      <StatusBadge status={roll.status} labels={rollStatusLabels} tones={rollStatusTones} />
      {roll.markedForKartela && <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300">Kartelalık</Badge>}
      {roll.labelDirty && (
        <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300" title="Veri/metraj düzeltildi; topun üstündeki fiziksel etiket eski — yeniden basılmalı.">
          <AlertTriangle className="h-3 w-3" /> Etiket güncel değil
        </Badge>
      )}
    </div>
  );
}

function BarcodeCard({ roll }: { roll: Roll }) {
  if (!roll.barcode) {
    return (
      <Card>
        <CardContent className="space-y-2 p-3 text-xs text-muted-foreground">
          <StatusBadges roll={roll} />
          <div>
            <Badge variant="outline" className="mr-2 text-[10px]">Açık Kumaş</Badge>
            Bu rulonun fiziksel barkodu yok — boyahane dönüşü açık kumaş, Kurşun/KK2'de işlenirken üretiliyor.
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-3">
        <div className="rounded bg-white p-2"><QRCodeSVG value={roll.barcode} size={96} level="M" /></div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Top Barkodu</div>
            <span className="mt-1 block break-all font-mono text-sm font-semibold" data-testid="roll-card-barcode">{roll.barcode}</span>
          </div>
          {roll.customerCode ? (
            <div data-testid="roll-customer-code">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Müşteri kodu</div>
              <span className="mt-1 block break-all font-mono text-sm font-semibold">{roll.customerCode}</span>
            </div>
          ) : null}
          <StatusBadges roll={roll} />
        </div>
      </CardContent>
    </Card>
  );
}

export function RollIdentitySection({ roll }: { roll: Roll }) {
  return <BarcodeCard roll={roll} />;
}
