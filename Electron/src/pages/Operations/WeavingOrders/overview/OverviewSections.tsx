// =============================================================================
// DOKUMA İŞİ GENEL BAKIŞ — panel bölümleri (v3 `.wo-v3` dili)
// =============================================================================
// Her bölüm sunucu listesini olduğu gibi çizer; liste gelmediyse (eski backend)
// çağıran bölümü hiç çizmez. Kırpılmış listede sayaç "son N / toplam M" der.
// =============================================================================
import type { MouseEvent, ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { formatFactory } from "@/lib/factory-time";
import { WARP_BEAM_STATUS_META } from "@/pages/Operations/WarpBeams/types";
import { V3Section } from "@/pages/Operations/WorkOrders/detail-v3/V3Section";
import { formatPlannedM, type WeavingExecutionKind, type WeavingOrderLineLink } from "../types";
import { listCount, progressView } from "./overview-model";
import type { CappedList, MachineRef, OverviewBeam, OverviewDoff, OverviewLiveRun, OverviewProgress, OverviewRecentRun } from "./types";

const at = (iso: string | null | undefined) => formatFactory(iso, "dd.MM HH:mm");
const meters = (v: number | null) => (v === null ? "ölçülemedi" : `${formatNumber(v, 0)} m`);
const machineLabel = (m: MachineRef) => `${m.code} · ${m.name}`;

export function OverviewKpis({ progress, kind }: { progress: OverviewProgress; kind: WeavingExecutionKind | undefined }) {
  const view = progressView(progress, kind);
  const fason = kind === "SUBCONTRACTED";
  return (
    <div className="kpis" data-testid="wo-ov-kpis">
      <Kpi label="Hedef" value={formatPlannedM(progress.plannedM)} />
      <Kpi label="Üretilen top" value={meters(progress.rollMeters)} sub={`${progress.rollCount} top · ${progress.doffCount} indirme`} />
      {fason ? (
        <Kpi label="Fason kabul" value={meters(progress.fasonReceivedM)} />
      ) : (
        <Kpi
          label="Koşum metresi"
          value={meters(progress.runMeters)}
          sub={`${progress.closedRunCount} kapanmış koşum${progress.unmeasuredRunCount > 0 ? ` · ${progress.unmeasuredRunCount} ölçülmemiş` : ""}`}
        />
      )}
      <div className="kpi" data-testid="wo-ov-progress">
        <span className="lab">İlerleme</span>
        {view.kind === "pct" ? (
          <>
            <div className="big num">
              {formatNumber(view.pct, 0)}
              <small>%</small>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(100, view.pct)}%` }} />
            </div>
          </>
        ) : (
          <div className="big">{view.kind === "open-ended" ? "açık uçlu" : "ölçülemedi"}</div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="lab">{label}</span>
      <div className="big num">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** Satır kabı: tıklanabilirse düğme gibi davranır, değilse düz satır. */
function Row({ onClick, children, testId }: { onClick?: (e: MouseEvent) => void; children: ReactNode; testId?: string }) {
  if (!onClick) return <div className="order" data-testid={testId}>{children}</div>;
  return (
    <div
      className="order"
      role="button"
      tabIndex={0}
      data-testid={testId}
      style={{ cursor: "pointer" }}
      title="Tezgah Salonu'nda aç (Shift/Ctrl+tık: yeni sekme)"
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick(e as unknown as MouseEvent)}
    >
      {children}
    </div>
  );
}

export function LiveRunsSection({
  list,
  emptyText,
  onOpenMachine,
}: {
  list: CappedList<OverviewLiveRun>;
  emptyText: string;
  onOpenMachine?: (machineId: string, e: MouseEvent) => void;
}) {
  return (
    <V3Section title="Şu an tezgahta" active={list.items.length > 0} count={list.total > 0 ? listCount(list) : undefined}>
      {list.items.length === 0 ? (
        <div className="card emptybox" data-testid="wo-ov-live-empty">{emptyText}</div>
      ) : (
        <div className="card">
          {list.items.map((r) => (
            <Row key={r.id} testId="wo-ov-live-run" onClick={onOpenMachine ? (e) => onOpenMachine(r.machine.id, e) : undefined}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                <div>
                  <span className="cust">{machineLabel(r.machine)}</span>
                  <span className="onum"> · Hat {r.productionLineNo}</span>
                </div>
                <div className="kpi-sub">
                  <span>Başladı {at(r.startedAt)}</span>
                  <span>{r.doffCount} indirme</span>
                  {r.operator && <span>Operatör: <b>{r.operator.name}</b></span>}
                </div>
                {r.beams && r.beams.length > 0 && (
                  <div className="kpi-sub">
                    {r.beams.map((b) => (
                      <span key={b.id} className="chip dim num">
                        Levent {b.beamNo}: {formatNumber(b.remainingM, 0)} / {formatNumber(b.plannedLengthM, 0)} m
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {r.openStop ? (
                <span className="pill bad sm" data-testid="wo-ov-open-stop">
                  <span className="dot" />
                  Duruş: {r.openStop.reasonLabel ?? "Sebep bekleniyor"} · {at(r.openStop.startedAt)}
                </span>
              ) : (
                <span className="pill run sm">
                  <span className="dot" />
                  Çalışıyor
                </span>
              )}
            </Row>
          ))}
        </div>
      )}
    </V3Section>
  );
}

export function RecentRunsSection({ list }: { list: CappedList<OverviewRecentRun> }) {
  if (list.items.length === 0) return null;
  return (
    <V3Section title="Son koşumlar" count={listCount(list)}>
      <div className="card" data-testid="wo-ov-recent-runs">
        {list.items.map((r) => (
          <Row key={r.id}>
            <span className="cust">{machineLabel(r.machine)}</span>
            <span className="onum">
              {at(r.startedAt)} → {at(r.endedAt)}
            </span>
            <span className="spacer" />
            {r.revokedAt ? (
              <span className="chip bad" title={r.revokeReason ?? undefined}>
                Geri alındı{r.revokeReason ? `: ${r.revokeReason}` : ""}
              </span>
            ) : (
              <span className="num">{meters(r.producedM)}</span>
            )}
          </Row>
        ))}
      </div>
    </V3Section>
  );
}

export function RecentDoffsSection({ list }: { list: CappedList<OverviewDoff> }) {
  if (list.items.length === 0) return null;
  return (
    <V3Section title="Son indirmeler" count={listCount(list)}>
      <div className="card" data-testid="wo-ov-doffs">
        {list.items.map((d) => (
          <Row key={d.id}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
              <div>
                <span className="cust mono">{d.code}</span>
                <span className="onum"> · {d.machine.code} · {at(d.doffedAt)}</span>
              </div>
              {d.rolls.length > 0 && (
                <div className="kpi-sub">
                  {d.rolls.map((r) => (
                    <span key={r.id} className="chip dim num">
                      {r.barcode ?? "barkodsuz"} · {formatNumber(r.initialQty, 0)} m
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span className="num">{d.pieceCount} parça</span>
          </Row>
        ))}
      </div>
    </V3Section>
  );
}

export function BeamsSection({ list }: { list: CappedList<OverviewBeam> }) {
  if (list.items.length === 0) return null;
  return (
    <V3Section title="Leventler" count={listCount(list)}>
      <div className="card" data-testid="wo-ov-beams">
        {list.items.map((b) => (
          <Row key={b.id}>
            <span className="cust mono">{b.beamNo}</span>
            <span className="onum">{b.warpSpecCode}</span>
            <span className="spacer" />
            {b.currentMachine && <span className="onum">Tezgah {b.currentMachine.code}</span>}
            <span className="num">
              {formatNumber(b.remainingM, 0)} / {formatNumber(b.plannedLengthM, 0)} m
            </span>
            <span className="chip dim">{WARP_BEAM_STATUS_META[b.status]?.label ?? b.status}</span>
          </Row>
        ))}
      </div>
    </V3Section>
  );
}

export function OrderLinesSection({ lines }: { lines: WeavingOrderLineLink[] }) {
  return (
    <V3Section title="Bağlı siparişler" count={lines.length}>
      {lines.length === 0 ? (
        <div className="card emptybox">Siparişe bağlı değil — stoğa dokuma.</div>
      ) : (
        <div className="card" data-testid="wo-ov-order-lines">
          {lines.map((l) => (
            <Row key={l.id}>
              <span className="cust">{l.orderLine.order.customer.name}</span>
              <span className="onum">{l.orderLine.order.orderNumber}</span>
              <span className="spacer" />
              {l.orderLine.cancelledAt && <span className="chip bad">iptal</span>}
              <span className="num">
                {l.allocatedM !== null ? `${formatNumber(l.allocatedM, 0)} m tahsis · ` : ""}
                {formatNumber(l.orderLine.quantity, 0)} {l.orderLine.unit}
              </span>
            </Row>
          ))}
        </div>
      )}
    </V3Section>
  );
}
