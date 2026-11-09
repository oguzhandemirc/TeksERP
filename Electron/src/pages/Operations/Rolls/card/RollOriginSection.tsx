// NEREDEN GELDİ — giriş kaynağı, gelen belge (en yakın atadan), müşterinin parti/top no'su, ata top, kim/ne zaman.
// Değeri olmayan satır çizilmez; tarihler fabrika saatinde (`safeFormat`).
import { LogIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import { TERIM } from "@/lib/terim";
import { rollEntrySourceLabels } from "@/types/enums";
import type { Roll } from "../types";
import { CardLink, CardRow, CardSection } from "./CardSection";

const INCOMING_DOCS_PATH = "/operations/gelen-belgeler";

export function RollOriginSection({ roll }: { roll: Roll }) {
  const dn = roll.deliveryNote ?? null;
  const who = roll.createdBy?.fullName ?? roll.createdBy?.username ?? null;
  const source = rollEntrySourceLabels[roll.entrySource as keyof typeof rollEntrySourceLabels] ?? roll.entrySource;
  return (
    <CardSection title="Nereden geldi" icon={LogIn} testId="roll-card-origin">
      <CardRow label="Giriş kaynağı">
        <Badge variant="muted" className="text-[10px]">{source}</Badge>
      </CardRow>
      <CardRow label="Gelen belge" testId="roll-origin-note">
        {dn && (
          <>
            <CardLink to={`${INCOMING_DOCS_PATH}/${dn.noteId}`}>{dn.noteNo}</CardLink>
            {dn.inherited && <span className="ml-1 text-muted-foreground">(ata topun belgesi)</span>}
          </>
        )}
      </CardRow>
      <CardRow label="Gönderen belge no" testId="roll-origin-sender-doc">{dn?.senderDocNo}</CardRow>
      <CardRow label="Müşteri parti no" testId="roll-origin-customer-batch">{dn?.customerBatchNo ?? roll.labelBatchNo}</CardRow>
      <CardRow label="Müşteri top no" testId="roll-origin-sender-roll">{dn?.senderRollNo}</CardRow>
      <CardRow label="Ata top" testId="roll-origin-parent">
        {roll.parent?.barcode ? <span className="font-mono">{roll.parent.barcode}</span> : null}
      </CardRow>
      <CardRow label="Giriş istasyonu">{roll.entryStation?.name}</CardRow>
      {(roll.entrySource === "WEAVING" || roll.weavingOrder) && (
        <CardRow label={TERIM.dokumaIsEmri.tekil} testId="roll-weaving-order">
          {roll.weavingOrder ? <span className="font-mono">{roll.weavingOrder.weavingOrderNumber}</span> : <span className="text-muted-foreground">— (işsiz koşum)</span>}
        </CardRow>
      )}
      <CardRow label="Ekleyen">
        {who && (
          <>
            {who}
            {roll.createdMachine?.name ? <span className="text-muted-foreground"> · {roll.createdMachine.name}</span> : null}
          </>
        )}
      </CardRow>
      <CardRow label="Giriş tarihi">{safeFormat(roll.createdAt, "dd.MM.yyyy HH:mm", "")}</CardRow>
      <CardRow label="Ekleme nedeni">{roll.manualReason}</CardRow>
    </CardSection>
  );
}
