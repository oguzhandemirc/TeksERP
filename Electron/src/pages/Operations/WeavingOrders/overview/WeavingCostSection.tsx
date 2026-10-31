// SY-D4: dokuma iş emri panelinde "Maliyet" bölümü — ürünün YÜRÜRLÜKTEKİ standart sürümü ve dokuma satırları
// (sayılar kayıtlı sürümden; panel hesaplamaz). Modül kapalı ya da `cost:read` yoksa sorgu ATILMAZ, bölüm çizilmez.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMaliyetEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { V3Section } from "@/pages/Operations/WorkOrders/detail-v3/V3Section";
import { costItemService } from "@/pages/Cost/Items/service";
import { fmtDecFull } from "@/pages/Cost/shared/format";
import { COMPONENT_LABEL } from "@/pages/Cost/shared/labels";

/** Dokuma grubunun bileşenleri (backend `cost-component-groups.helper` → `dokumaTl` aynası). */
export const WEAVING_COMPONENTS: ReadonlySet<string> = new Set(["LOOM_MACHINE", "LOOM_LABOR", "ENERGY", "BEAM_PREP", "WEAVING_PICK"]);

export function WeavingCostSection({ itemId }: { itemId: string }) {
  const moduleOpen = useMaliyetEnabled();
  const { hasPermission } = useRoleAccess();
  const enabled = moduleOpen && hasPermission("cost:read");
  const q = useQuery({
    queryKey: ["cost-items", "detail", itemId],
    queryFn: () => costItemService.detail(itemId),
    enabled,
  });
  if (!enabled) return null;
  const v = q.data?.aktifSurum ?? null;
  const lines = (v?.satirlar ?? []).filter((l) => WEAVING_COMPONENTS.has(l.bilesen));
  return (
    <V3Section title="Maliyet (standart)">
      <div className="card" data-testid="wo-cost">
        {q.isError ? (
          <div className="emptybox">Maliyet okunamadı.</div>
        ) : q.isLoading ? (
          <div className="emptybox">Yükleniyor…</div>
        ) : !v ? (
          <div className="emptybox">Bu ürünün kayıtlı standart maliyeti yok.</div>
        ) : (
          <>
            <div className="order">
              <span className="cust">Standart (v{v.surumNo})</span>
              <span className="spacer" />
              <span className="num" data-testid="wo-cost-total">
                {fmtDecFull(v.standartTlM, 4)} TL/m
                {v.sunumDovizi && ` · ${v.standartDovizM != null ? fmtDecFull(v.standartDovizM, 4) : "kur yok"} ${v.sunumDovizi}/m`}
              </span>
            </div>
            {lines.map((l) => (
              <div className="order" key={l.sira} data-testid="wo-cost-line">
                <span className="onum">{COMPONENT_LABEL[l.bilesen] ?? l.etiket}</span>
                <span className="spacer" />
                <span className="num">{fmtDecFull(l.tutarTlM, 4)} TL/m</span>
              </div>
            ))}
          </>
        )}
        <Link className="text-xs underline" to={`/cost/items/${itemId}`}>Maliyet kartına git</Link>
      </div>
    </V3Section>
  );
}
