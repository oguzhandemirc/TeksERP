// D8: dokuma iş emri panelinde "Çözgü ihtiyacı" — işin KALAN metresi için çözgü, eldeki/yoldaki arz ve fason
// devere önerisi (`GET /api/warp-plan/need?source=WEAVING_ORDER`). Kapalı işte, devere kapalıyken ya da
// `warpspec:read` yoksa sorgu ATILMAZ; 403 (modül/lisans/yetki) gelirse bölüm çizilmez.
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { V3Section } from "@/pages/Operations/WorkOrders/detail-v3/V3Section";
import { NeedCompactList } from "@/pages/Operations/WarpPlan/need/NeedTable";
import { needTabHref } from "@/pages/Operations/WarpPlan/need/need-model";
import { isNeedHidden, useWarpNeed } from "@/pages/Operations/WarpPlan/need/need-service";

interface Props {
  weavingOrderId: string;
  isOpen: boolean;
  /** Bağlantıya geçmeden paneli kapat. */
  onNavigate: () => void;
}

export function WarpNeedSection({ weavingOrderId, isOpen, onNavigate }: Props) {
  const devere = useDevereEnabled();
  const { hasPermission } = useRoleAccess();
  const enabled = isOpen && devere && hasPermission("warpspec:read");
  const q = useWarpNeed({ source: "WEAVING_ORDER", weavingOrderId }, enabled);
  const openTarget = useOpenTarget();
  if (!enabled || (q.isError && isNeedHidden(q.error))) return null;
  const res = q.data;
  if (res && res.rows.length === 0 && res.warnings.length === 0) return null;
  return (
    <V3Section title="Çözgü ihtiyacı" active={res?.rows.some((r) => r.suggestion) ?? false}>
      <div className="space-y-2" data-testid="wo-warp-need">
        {q.isError ? (
          <div className="card emptybox">Çözgü ihtiyacı okunamadı.</div>
        ) : !res ? (
          <div className="card emptybox">Yükleniyor…</div>
        ) : (
          <>
            {res.warnings.map((w) => (
              <div key={w.code + w.message} className="card emptybox">{w.message}</div>
            ))}
            <NeedCompactList res={res} onNavigate={onNavigate} />
          </>
        )}
        <button
          type="button"
          className="text-xs underline"
          onClick={(e) => {
            onNavigate();
            openTarget(needTabHref({ weavingOrderId }), e);
          }}
        >
          Çözgü Hesabı'nda ayrıntıyla aç
        </button>
      </div>
    </V3Section>
  );
}
