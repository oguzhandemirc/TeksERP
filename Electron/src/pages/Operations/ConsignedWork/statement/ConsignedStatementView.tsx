// İçerideki İşler → "Emanet ekstresi" sekmesi (genel fason P1): müşteri malının dönem mutabakatı (F2 ucu).
// Seçim URL'de (`musteri`, `from`, `to`) — derin bağlantı ve geri tuşu çalışır. Dönem fabrika günüdür (`factory-time`).
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, UserRound } from "lucide-react";
import { ListBody, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { factoryDayKey } from "@/lib/factory-time";
import { apiErrorText } from "@/lib/api-error";
import { ReportExportBar } from "@/pages/Reports/_components/ReportExportBar";
import type { ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { CONSIGNED_STATEMENT_QUERY_KEY, getConsignedStatement, ownerCustomerPickerService, type OwnerCustomer } from "./service";
import { buildConsignedStatementExport, omittedText, reconciliationText, sectionSections } from "./statementExport";
import { StatementSectionView } from "./StatementSectionView";

export const STATEMENT_PARAMS = { customer: "musteri", from: "from", to: "to" } as const;

/** Varsayılan dönem: içinde bulunulan fabrika ayının ilk günü → bugün. */
export function defaultStatementPeriod(now: Date = new Date()): { from: string; to: string } {
  const today = factoryDayKey(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

export function ConsignedStatementView() {
  const [sp, setSp] = useSearchParams();
  const def = defaultStatementPeriod();
  const customerId = sp.get(STATEMENT_PARAMS.customer);
  const from = sp.get(STATEMENT_PARAMS.from) || def.from;
  const to = sp.get(STATEMENT_PARAMS.to) || def.to;
  const set = (key: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(key, v);
    else next.delete(key);
    setSp(next, { replace: true });
  };
  const periodBad = from > to;

  const q = useQuery({
    queryKey: [CONSIGNED_STATEMENT_QUERY_KEY, customerId, from, to],
    queryFn: () => getConsignedStatement(customerId!, from, to),
    enabled: Boolean(customerId) && !periodBad,
    staleTime: 30_000,
  });
  const st = q.data?.data;
  const warnings = q.data?.warnings ?? [];
  const recon = st ? reconciliationText(st) : null;

  return (
    <>
      <StatementControls customerId={customerId} from={from} to={to} periodBad={periodBad} set={set}
        buildSpec={() => (st ? buildConsignedStatementExport(st, warnings) : null)} exportDisabled={!st} />
      <ListBody>
        {!customerId ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Ekstresini görmek istediğiniz müşteriyi seçin. Ekstre, dönemde müşterinin malından ne aldığımızı, ne
              gönderdiğimizi (BRÜT), fasondan doğrudan ne çıktığını, ne fire verildiğini ve ne kaldığını gösterir.
            </div>
          </ListMessage>
        ) : periodBad ? (
          <ListMessage className="text-sm text-destructive">Bitiş günü başlangıçtan önce olamaz.</ListMessage>
        ) : q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Ekstre hazırlanıyor…</ListMessage>
        ) : q.isError || !st ? (
          <ListMessage>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Ekstre alınamadı.</p>
              <p className="mt-1 text-muted-foreground">{apiErrorText(q.error, "Sunucuya ulaşılamadı.")}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
            </div>
          </ListMessage>
        ) : (
          <div className="flex flex-col gap-5 p-3" data-testid="consigned-statement">
            <StatementNotes notes={[...st.omitted.map(omittedText)]} warnings={warnings} ok={recon} />
            {sectionSections(st).map((s) => (
              <StatementSectionView key={s.kind} section={s} />
            ))}
            <p className="px-1 text-[11px] text-muted-foreground">
              Açılış + giren − çıkan − doğrudan sevk − fire = kalan. Sevk rakamı BRÜTtür; iptal edilen kayıt silinmez,
              kendi gününde ayrı "storno" satırıyla terslenir. Günler fabrika günüdür.
            </p>
          </div>
        )}
      </ListBody>
    </>
  );
}

interface ControlsProps {
  customerId: string | null;
  from: string;
  to: string;
  periodBad: boolean;
  set: (key: string, v: string | null) => void;
  buildSpec: () => ReportExportSpec | null;
  exportDisabled: boolean;
}

/** Üst bant: müşteri seçici (doğrudan modal) · dönem · Excel/PDF/Yazdır. */
function StatementControls({ customerId, from, to, periodBad, set, buildSpec, exportDisabled }: ControlsProps) {
  return (
      <ListToolbar>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-72 max-w-full">
            <div className="mb-1 text-xs text-muted-foreground">Müşteri (emanet sahibi)</div>
            <EntityPickerModal<OwnerCustomer>
              value={customerId}
              onChange={(id) => set(STATEMENT_PARAMS.customer, id)}
              service={ownerCustomerPickerService}
              queryKey="consigned-statement-owners"
              getLabel={(o) => o.name}
              getSubLabel={(o) => o.code}
              icon={UserRound}
              placeholder="Müşteri seç…"
              title="Emanet sahibi seç"
              description="Malını bize bırakmış (en az bir emanet topu olmuş) müşteriler."
              countLabel="müşteri"
            />
          </div>
          <div className="w-36">
            <div className="mb-1 text-xs text-muted-foreground">Başlangıç</div>
            <DatePickerInput value={from} onChange={(v) => set(STATEMENT_PARAMS.from, v)} aria-label="Ekstre başlangıç günü" invalid={periodBad} max={to} />
          </div>
          <div className="w-36">
            <div className="mb-1 text-xs text-muted-foreground">Bitiş</div>
            <DatePickerInput value={to} onChange={(v) => set(STATEMENT_PARAMS.to, v)} aria-label="Ekstre bitiş günü" invalid={periodBad} min={from} />
          </div>
          <div className="ml-auto">
            <ReportExportBar disabled={exportDisabled} buildSpec={buildSpec} />
          </div>
        </div>
      </ListToolbar>
  );
}

function StatementNotes({ notes, warnings, ok }: { notes: string[]; warnings: string[]; ok: string | null }) {
  if (notes.length === 0 && warnings.length === 0 && !ok) return null;
  return (
    <div className="flex flex-col gap-1.5 text-xs" data-testid="statement-notes">
      {warnings.map((w) => (
        <p key={w} role="alert" className="flex gap-2 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {w}
        </p>
      ))}
      {notes.map((n) => (
        <p key={n} className="flex gap-2 text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" /> {n}
        </p>
      ))}
      {ok && <p className="flex gap-2 text-emerald-700 dark:text-emerald-400"><Info className="h-4 w-4 shrink-0" /> {ok}</p>}
    </div>
  );
}
