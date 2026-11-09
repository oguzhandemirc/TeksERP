// KİMLİK — barkod (QR) + durum rozetleri, ürün/renk/en, metre (ilk/kalan), kg, kalite, biçim/kat/özellikler.
import { AlertTriangle, Package } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnimatedProgress } from "@/components/motion";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { rollStatusLabels } from "@/types/enums";
import type { Roll } from "../types";
import { CardRow, CardSection } from "./CardSection";

const num = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false });

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
  const props = roll.properties ?? [];
  return (
    <>
      <BarcodeCard roll={roll} />
      <CardSection title="Kimlik" icon={Package} testId="roll-card-identity">
        <CardRow label="Kumaş" testId="roll-identity-item">{roll.item?.name}</CardRow>
        <CardRow label="Renk">
          {roll.color && (
            <span className="flex items-center gap-1.5">
              {roll.color.hex && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: roll.color.hex }} />}
              {roll.color.name}
            </span>
          )}
        </CardRow>
        <CardRow label="Metre" testId="roll-identity-qty">
          <span className="text-base font-semibold tabular-nums">{num(roll.currentQty)} m</span>
          {roll.currentQty !== roll.initialQty && <span className="ml-2 text-muted-foreground">ilk {num(roll.initialQty)} m</span>}
          {roll.initialQty > 0 && <AnimatedProgress value={(roll.currentQty / roll.initialQty) * 100} className="mt-1 h-1" />}
        </CardRow>
        <CardRow label="En">{roll.width != null ? `${roll.width} cm` : null}</CardRow>
        <CardRow label="Ağırlık">{roll.weightKg != null ? `${num(roll.weightKg)} kg` : null}</CardRow>
        <CardRow label="Kalite">{roll.qualityGrade}</CardRow>
        <CardRow label="Biçim"><Badge variant="muted" className="text-[10px]">{roll.form === "ACIK" ? "Açık Kumaş" : "Top"}</Badge></CardRow>
        <CardRow label="Kat">{roll.foldType}</CardRow>
        <CardRow label="Özellikler">
          {props.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {/* SEÇİM tipli özellikte DEĞER de basılır ("Gramaj: 50 gr"). */}
              {props.map((p) => <Badge key={p.propertyId} variant="muted" className="text-[10px]">{p.value ? `${p.property.name}: ${p.value.name}` : p.property.name}</Badge>)}
            </span>
          )}
        </CardRow>
      </CardSection>
    </>
  );
}
