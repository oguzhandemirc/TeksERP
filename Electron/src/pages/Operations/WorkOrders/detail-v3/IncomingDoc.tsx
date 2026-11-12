// İE detayı "Gelen" künyesi (2026-11-09): kaynak gelen belge no(ları) + gelen kumaş/renk (beyan) + gelen en + müşteri parti no — yalnız
// İE belgeden doğmuşsa; kumaş/renk müşterinin yazdığıdır, hedef kumaş/renk değil.
// Değerler sunucudan (`incoming`); en yalnız bütün köklerde aynıysa gelir (kısmi/karışık değer gösterilmez). Belge no, izin varsa
// gelen belge detayına bağlantıdır (SourceDocsV3 ile aynı gezinme).
import { Link } from "react-router-dom";
import { formatNumber } from "@/lib/format";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { WorkOrder } from "../types";

export function IncomingDoc({ incoming }: { incoming: WorkOrder["incoming"] }) {
  const { hasPermission } = useRoleAccess();
  if (!incoming) return null;
  const notes = incoming.notes ?? [];
  const width = incoming.widthCm == null ? null : Number(incoming.widthCm);
  const batch = incoming.customerBatchNo ?? null;
  const fabric = incoming.itemText?.trim() || null;
  const color = incoming.colorText?.trim() || null;
  if (notes.length === 0 && width == null && !batch && !fabric && !color) return null;
  const canOpen = hasPermission("gelen-belge:read");
  return (
    <>
      {notes.length > 0 && (
        <span data-testid="wo-incoming-notes">
          Belge{" "}
          {notes.map((n, i) => (
            <span key={n.id}>
              {i > 0 && ", "}
              {canOpen ? (
                <Link to={`/operations/gelen-belgeler/${n.id}`} className="font-medium underline">
                  {n.noteNo}
                </Link>
              ) : (
                <b>{n.noteNo}</b>
              )}
            </span>
          ))}
        </span>
      )}
      {fabric && (
        <span data-testid="wo-incoming-fabric">
          Gelen kumaş <b>{fabric}</b>
        </span>
      )}
      {color && (
        <span data-testid="wo-incoming-color">
          Gelen renk <b>{color}</b>
        </span>
      )}
      {width != null && (
        <span data-testid="wo-incoming-width">
          Gelen en <b className="num">{formatNumber(width, Number.isInteger(width) ? 0 : 1)} cm</b>
        </span>
      )}
      {batch && (
        <span data-testid="wo-incoming-batch">
          Müşteri parti <b>{batch}</b>
        </span>
      )}
    </>
  );
}
