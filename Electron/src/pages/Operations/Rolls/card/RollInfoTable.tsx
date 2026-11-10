// TOP BİLGİLERİ (kullanıcı 2026-11-10: "asıl olması gereken bunlar yok") — kartın en üstünde asıl bilgiler TEK
// tabloda; boş değer "—" (kg "tartılmadı"). Alt bölümler bu satırları tekrarlamaz; tablo tek kaynaktır.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { safeFormat } from "@/lib/format";
import { rollStageLabels, rollStatusLabels } from "@/types/enums";
import { customerBatchOf } from "../columns";
import type { Roll } from "../types";
import { WEIGHT_SOURCE_LABELS, num, printedValueRows, splitRollProperties } from "./rollInfoData";

const EMPTY = "—";

function Row({ label, testId, children }: { label: string; testId?: string; children?: ReactNode }) {
  const empty = children === null || children === undefined || children === false || children === "";
  return (
    <tr className="border-b last:border-0 align-top">
      <th scope="row" className="w-40 py-1 pr-3 text-left text-xs font-normal text-muted-foreground">{label}</th>
      <td className="py-1 text-xs" data-testid={testId}>{empty ? <span className="text-muted-foreground">{EMPTY}</span> : children}</td>
    </tr>
  );
}

const join = (...parts: Array<string | null | undefined>) => parts.filter((p) => p && p.trim()).join(" · ");

function LastPrintRow({ roll }: { roll: Roll }) {
  const [open, setOpen] = useState(false);
  const snap = roll.lastLabelSnapshot ?? null;
  const values = printedValueRows(snap);
  if (!roll.labelPrintedAt) return <Row label="Son etiket basımı" testId="roll-info-last-print" />;
  return (
    <Row label="Son etiket basımı" testId="roll-info-last-print">
      {join(safeFormat(roll.labelPrintedAt, "dd.MM.yyyy HH:mm"), snap?.operatorName)}
      {values.length > 0 && (
        <button type="button" data-testid="roll-info-printed-toggle" className="ml-2 inline-flex items-center text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} basılan değerler
        </button>
      )}
      {open && (
        <ul className="mt-1 space-y-0.5 rounded border bg-muted/30 px-2 py-1" data-testid="roll-info-printed-values">
          {values.map(([k, v]) => (
            <li key={k}><span className="text-muted-foreground">{k}:</span> {v}</li>
          ))}
        </ul>
      )}
    </Row>
  );
}

interface Props {
  roll: Roll;
  /** Emanet kapalı kurulumda sahipsiz top "—" (bugünkü görünüm: "Bizim mal" yalnız emanet açıkken). */
  emanetEnabled: boolean;
  /** Ana top barkodu tıklanınca o topun kartı açılır. */
  onOpenRoll?: (rollId: string) => void;
}

export function RollInfoTable({ roll, emanetEnabled, onOpenRoll }: Props) {
  const { valued, flags } = splitRollProperties(roll.properties);
  const parent = roll.parent ?? null;
  const owner = roll.ownerCustomer ?? null;
  const labelCustomer = roll.labelCustomer ?? null;
  const consignee = roll.labelConsignee ?? null;
  const who = roll.createdBy?.fullName ?? roll.createdBy?.username ?? null;
  const parentQty = parent?.initialQty != null && parent.currentQty != null ? `ilk ${num(parent.initialQty)} m / kalan ${num(parent.currentQty)} m` : null;

  return (
    <Card data-testid="roll-card-info">
      <CardContent className="p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" /> Top bilgileri
        </div>
        <table className="w-full border-collapse">
          <tbody>
            <Row label="Barkod" testId="roll-info-barcode">{roll.barcode ? <span className="font-mono font-semibold">{roll.barcode}</span> : null}</Row>
            <Row label="Metre (ilk / kalan)" testId="roll-info-qty">
              <span className="tabular-nums">{num(roll.initialQty)} m / <span className="font-semibold">{num(roll.currentQty)} m</span></span>
            </Row>
            <Row label="Kalite" testId="roll-info-quality">{roll.qualityGrade}</Row>
            {/* İşlem özellikleri veri güdümlü: değerli olan kendi satırında, işaretler tek satırda. */}
            {valued.map((p) => <Row key={p.key} label={p.label} testId="roll-info-property">{p.value}</Row>)}
            {flags.length > 0 && <Row label="İşlemler" testId="roll-info-flags">{flags.join(" · ")}</Row>}
            <Row label="Kat / biçim" testId="roll-info-fold">{join(roll.foldType, roll.form === "ACIK" ? "Açık kumaş" : "Top")}</Row>
            <Row label="Aşama" testId="roll-info-stage">{roll.stage ? rollStageLabels[roll.stage] : null}</Row>
            <Row label="Durum / depo" testId="roll-info-status">{join(rollStatusLabels[roll.status] ?? roll.status, roll.warehouse?.name)}</Row>
            <Row label="Ana top" testId="roll-info-parent">
              {parent?.barcode ? (
                <>
                  {onOpenRoll ? (
                    <button type="button" data-testid="roll-info-parent-link" className="font-mono text-primary underline-offset-2 hover:underline" onClick={() => onOpenRoll(parent.id)}>
                      {parent.barcode}
                    </button>
                  ) : <span className="font-mono">{parent.barcode}</span>}
                  {parentQty && <span className="ml-2 text-muted-foreground">{parentQty}</span>}
                </>
              ) : null}
            </Row>
            <Row label="Kesildiği / girdiği yer" testId="roll-info-origin">
              {join(roll.entryStation?.name, roll.createdMachine?.name, who, safeFormat(roll.createdAt, "dd.MM.yyyy HH:mm", ""))}
            </Row>
            <Row label="Malın sahibi" testId="roll-info-owner">
              {owner ? (
                <span data-testid="roll-owner-consigned" className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {owner.name} (emanet)
                </span>
              ) : emanetEnabled ? <span data-testid="roll-owner-own">Bizim mal</span> : null}
            </Row>
            <Row label="Etiket kimin için" testId="roll-info-label-for">
              {labelCustomer || consignee
                ? join(labelCustomer?.name ?? owner?.name, consignee ? `alıcı: ${consignee.name}` : "malın sahibi")
                : null}
            </Row>
            <Row label="Bizim parti" testId="roll-info-batch">{roll.batch?.batchNumber ? <span className="font-mono">{roll.batch.batchNumber}</span> : null}</Row>
            <Row label="Etiketteki kumaş adı" testId="roll-info-label-item">{roll.labelItemName}</Row>
            <Row label="Etiketteki renk" testId="roll-info-label-color">{roll.labelColorName}</Row>
            <Row label="Etiketteki parti no" testId="roll-info-label-batch">{customerBatchOf(roll)}</Row>
            <Row label="Kg" testId="roll-info-weight">
              {roll.weightKg != null
                ? join(`${num(roll.weightKg)} kg`, roll.weightSource ? WEIGHT_SOURCE_LABELS[roll.weightSource] : null)
                : <span className="text-muted-foreground">{EMPTY} tartılmadı</span>}
            </Row>
            <Row label="En" testId="roll-info-width">{roll.width != null ? `${num(roll.width)} cm` : null}</Row>
            <LastPrintRow roll={roll} />
            <Row label="Kumaş (kayıtta)" testId="roll-info-item">{roll.item?.name}</Row>
            <Row label="Renk (kayıtta)" testId="roll-info-color">
              {roll.color ? (
                <span className="inline-flex items-center gap-1.5">
                  {roll.color.hex && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: roll.color.hex }} />}
                  {roll.color.name}
                </span>
              ) : null}
            </Row>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
