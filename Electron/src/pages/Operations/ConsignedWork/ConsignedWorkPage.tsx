// İÇERİDEKİ İŞLER (ister 3.2) — müşteri başına içerideki emanet top/metre, durum kırılımıyla. Tek sunucu toplaması
// (`/api/consigned-work`); satır ya da hücre tıklaması Kumaş Stoğu'nu o sahibin süzgeciyle açar. Modül kapısı `ROUTE_MODULE`.
// Hazırlık kolonu (D4-J3) İKİNCİ HESAP DEĞİL: `ready-works?groupBy=customer` ucundan; `shipping:read` yoksa istek atılmaz.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/PageShell";
import { ListBand, ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { CONSIGNED_WORK_QUERY_KEY, getConsignedWork, type ConsignedOwnerRow } from "./service";
import { primaryBucket, rollsLinkFor } from "./consigned-links";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { getAllReadyWorks, READY_WORKS_QUERY_KEY } from "@/pages/Operations/ReadyWorks/service";
import { OwnersTable, TotalsStrip, type ReadinessStatus } from "./ConsignedWorkTable";
import { PageTabs } from "@/components/layout/PageTabs";
import { CONSIGNED_STATEMENT_QUERY_KEY } from "./statement/service";
import { ConsignedStatementView, STATEMENT_PARAMS } from "./statement/ConsignedStatementView";

/** Görünüm URL'de (`?view=ekstre`) — satırdaki "Ekstre" düğmesi ve derin bağlantı aynı yere iner. */
const VIEW_PARAM = "view";

export function ConsignedWorkPage() {
  const [sp, setSp] = useSearchParams();
  if (sp.get(VIEW_PARAM) === "ekstre") {
    return (
      <PageShell>
        <PageHeader
          title="İçerideki İşler"
          description="Emanet ekstresi — müşterinin bize bıraktığı malın dönem mutabakatı: açılış, giren, çıkan (BRÜT), fasondan doğrudan sevk, fire, kalan."
          actions={<RefreshButton queryKey={CONSIGNED_STATEMENT_QUERY_KEY} />}
        />
        <ViewTabs value="ekstre" onChange={(v) => setSp(v === "ekstre" ? { [VIEW_PARAM]: "ekstre" } : {}, { replace: true })} />
        <ConsignedStatementView />
      </PageShell>
    );
  }
  return <ConsignedNowView onStatement={(id) => setSp({ [VIEW_PARAM]: "ekstre", ...(id ? { [STATEMENT_PARAMS.customer]: id } : {}) })} />;
}

function ViewTabs({ value, onChange }: { value: "anlik" | "ekstre"; onChange: (v: string) => void }) {
  return <PageTabs label="Emanet görünümü" tabs={[{ key: "anlik", label: "Anlık durum" }, { key: "ekstre", label: "Emanet ekstresi" }]} active={value} onSelect={onChange} />;
}

function ConsignedNowView({ onStatement }: { onStatement: (customerId: string | null) => void }) {
  const navigate = useNavigate();
  const [onlyReady, setOnlyReady] = useState(false);
  const q = useQuery({ queryKey: [CONSIGNED_WORK_QUERY_KEY, onlyReady ? "ready" : "all"], queryFn: () => getConsignedWork(onlyReady) });
  const rows = q.data?.rows ?? [];
  const open = (row: ConsignedOwnerRow) => navigate(rollsLinkFor(row.ownerCustomerId, primaryBucket(row)));
  const canReadShipping = useRoleAccess().hasPermission("shipping:read");
  const readyQ = useQuery({
    queryKey: [READY_WORKS_QUERY_KEY, "customer-all"],
    queryFn: () => getAllReadyWorks("customer"),
    enabled: canReadShipping,
  });
  // Hazırlık ucu düşerse ana liste etkilenmez; hücre "yüklenemedi" der.
  const readinessStatus: ReadinessStatus = readyQ.isError ? "error" : readyQ.isPending ? "loading" : "ok";
  const readiness = canReadShipping ? new Map((readyQ.data ?? []).map((w) => [w.id, w])) : null;

  return (
    <PageShell>
      <PageHeader
        title="İçerideki İşler"
        description="Müşterilerin işlenmek üzere bıraktığı (emanet) mal — müşteri başına top ve metre. Sevk edilen, hurdaya ayrılan ve iptal/tüketilmiş toplar sayılmaz; fasondaki ve karteladaki emanet içeride sayılır (Diğer). Satıra tıklayınca toplar o müşterinin süzgeciyle açılır."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={onlyReady ? "default" : "outline"}
              size="sm"
              aria-pressed={onlyReady}
              title="Yalnız sevke hazır (depoda) emaneti olan müşteriler; toplamlar da bu kapsamdan"
              onClick={() => setOnlyReady((v) => !v)}
            >
              Yalnız sevke hazır
            </Button>
            <RefreshButton queryKey={CONSIGNED_WORK_QUERY_KEY} />
          </div>
        }
      />
      <ViewTabs value="anlik" onChange={(v) => v === "ekstre" && onStatement(null)} />
      {!q.isLoading && !q.isError && q.data && (
        <ListBand>
          <TotalsStrip totals={q.data.totals} />
        </ListBand>
      )}
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Liste yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">Bu bir “içeride iş yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          </ListMessage>
        ) : (
          <>
            {rows.length === 0 ? (
              <ListMessage>
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {onlyReady
                    ? "Sevke hazır emaneti olan müşteri yok."
                    : "İçeride emanet mal yok. Emanet top, girişte “Sahibi” seçilerek ya da gelen belge onayıyla doğar."}
                </div>
              </ListMessage>
            ) : (
              q.data && <OwnersTable rows={rows} totals={q.data.totals} onOpen={open} readiness={readiness} readinessStatus={readinessStatus} onStatement={(r) => onStatement(r.ownerCustomerId)} />
            )}
          </>
        )}
      </ListBody>
      {rows.length > 0 && <ListFooter loaded={rows.length} />}
    </PageShell>
  );
}
