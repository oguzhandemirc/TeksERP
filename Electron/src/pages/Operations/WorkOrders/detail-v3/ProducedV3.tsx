import { useState } from "react";
import { formatNumber } from "@/lib/format";
import type { WorkOrder } from "../types";
import { closeSnapshotLabel, diffCloseSnapshot, totalsDelta } from "./closeSnapshotDiff";

/**
 * v3 üretilen nihai toplar — çıkan yoksa boş kutu (nerede işlendiği ipucuyla),
 * varsa özet (top·m + A1/Fire çipleri). Ayrıntılı liste ProducedRollsCard'dadır;
 * v3 detay sayfası özet+durum gösterir.
 *
 * Kapanmış iş emrinde başlık KAPANIŞ KÜNYESİNİ gösterir (kapanış anında donan hâl);
 * bugünkü hâl farklıysa tek satır "Bugün: …" ve isteğe bağlı top başına fark.
 */
export function ProducedV3({ wo, holdingText }: { wo: WorkOrder; holdingText?: string }) {
  const p = wo.producedRolls;
  const snap = wo.closeSnapshot;
  if (snap) return <ClosedProduced wo={wo} />;
  if (!p || p.count === 0) {
    return (
      <div className="card">
        <div className="emptybox">
          <span className="ic">◪</span>
          Henüz depoya çıkan nihai top yok{holdingText ? ` — ${holdingText}` : ""}.
        </div>
      </div>
    );
  }
  return (
    <div className="card info">
      <div className="wc-sum">
        <span className="big num">
          {p.count} top · {formatNumber(p.totalMeters, 0)} m
        </span>
        {p.a1.count > 0 && <span className="chip dim num">A1: {p.a1.count}</span>}
        {p.fire.count > 0 && <span className="chip bad num">Fire: {p.fire.count}</span>}
      </div>
    </div>
  );
}

function ClosedProduced({ wo }: { wo: WorkOrder }) {
  const snap = wo.closeSnapshot!;
  const p = wo.producedRolls;
  const [open, setOpen] = useState(false);
  const a1 = snap.lines.filter((l) => l.bucket === "A1").length;
  const fire = snap.lines.filter((l) => l.bucket === "SCRAP").length;
  // Başlık metresi canlıyla aynı tanım: depo + A1 (fire başlığa girmez).
  const snapMeters = snap.warehouseM + snap.a1M;
  const liveCount = p?.count ?? 0;
  const liveMeters = Number(p?.totalMeters ?? 0);
  const delta = totalsDelta({ count: snap.rollCount, meters: snapMeters }, { count: liveCount, meters: liveMeters });
  const changes = diffCloseSnapshot(snap.lines, p?.items ?? []);
  const reopened = wo.status !== "COMPLETED";
  const label = closeSnapshotLabel(snap, reopened);
  return (
    <div className="card info">
      <div className="wc-sum">
        <span className="comp">{label}:</span>
        <span className="big num">
          {snap.rollCount} top · {formatNumber(snapMeters, 0)} m
        </span>
        {a1 > 0 && <span className="chip dim num">A1: {a1}</span>}
        {fire > 0 && <span className="chip bad num">Fire: {fire}</span>}
        {snap.yieldPct != null && <span className="chip dim num">Verim %{formatNumber(snap.yieldPct, 1)}</span>}
        <span className="comp">{new Date(snap.closedAt).toLocaleString("tr-TR")}</span>
      </div>
      {(delta || changes.length > 0) && (
        <div className="wc-sum" style={{ marginTop: 6 }}>
          <span className="comp">
            Bugün: {liveCount} top · {formatNumber(liveMeters, 0)} m{delta ? ` (${delta})` : ""}
          </span>
          {changes.length > 0 && (
            <button type="button" className="chip dim" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Farkı gizle" : `${changes.length} topta fark ›`}
            </button>
          )}
        </div>
      )}
      {open && changes.length > 0 && (
        <table className="w-full text-xs" style={{ marginTop: 8 }} data-testid="kapanis-farki">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Top</th>
              <th className="py-1 font-medium">Kapanıştan bu yana</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.rollId} className="border-t">
                <td className="py-1 pr-2 font-mono">{c.barcode ?? "—"}</td>
                <td className="py-1">{c.changes.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
