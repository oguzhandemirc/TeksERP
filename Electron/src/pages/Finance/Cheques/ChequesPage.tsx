// =============================================================================
// ÇEK / SENET PORTFÖYÜ
// =============================================================================
// ⚠️ VARSAYILAN FİLTRE "CANLI OLANLAR"dır, "tümü" değil. Portföyün tek sorusu
// "elimde ne var, sırada ne var" — tahsil edilmiş/iptal edilmiş yüzlerce kayıt
// listenin başına gelirse (liste VADE sıralı!) o soru cevapsız kalır. Geçmiş
// kayıtlar gizlenmiş DEĞİL, tek seçimle geri gelir ve seçim şeritte GÖRÜNÜR
// durur — kullanıcı dar bir listeye baktığını bilmeli.
//
// ⚠️ SÜZME SUNUCUDA. Liste sayfalıdır; istemcide süzmek yalnız O ANKİ SAYFAYI
// süzer ve kullanıcı "kayıt yok" sanır — oysa kayıt sonraki sayfadadır.
//
// ⚠️ KIRPMA SESSİZ DEĞİL: sunucu toplamı gösterilen satır sayısını aşarsa bunu
// ekranda YAZARIZ. "İlk 100 kayıt" gerçeği söylenmezse, aradığı çeki bulamayan
// kullanıcı onun sistemde olmadığı sonucuna varır.
//
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR. İstek düşerse (modül kapalı, izin
// yok, sunucuya ulaşılamıyor) elimizde boş bir dizi kalır ve o diziyi "portföy
// boş" diye basmak DÜPEDÜZ YALANDIR — kullanıcı çekinin sistemde olmadığı
// sonucuna varır ve ikinci kez girer. Interceptor'ın bastığı toast birkaç
// saniyede kaybolur; ekranda kalan cümle doğruyu söylemek zorunda (2026-08-12
// FilterBar vakasının aynısı: yanlış kapıya giden istek "Sonuç yok." olarak
// görünüyordu).
//
// ⚠️ Yazma düğmeleri `finance:cheque` ile kapılıdır; ekranın kendisi
// `finance:read` ile açılır (backend de tam olarak böyle: portföy bir TUTAR
// GÖRÜNÜMÜDÜR ve aynı bilgi cari ekstresinde zaten görünüyor — ikinci bir izne
// kapamak aynı veriyi bir ekranda var, bir ekranda yok yapardı).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { ReportExportBar } from "@/pages/Reports/_components";
import { buildChequeExport } from "./chequeExport";
import { getChequeSummary, listCheques, type ChequeKind, type ChequeRow, type ChequeStatus } from "./service";
import { ChequeSummaryCards } from "./ChequeSummaryCards";
import { ChequeTable } from "./ChequeTable";
import { ChequeFormDialog } from "./ChequeFormDialog";
import { ChequeActionDialog } from "./ChequeActionDialog";
import { ChequeDetailDialog } from "./ChequeDetailDialog";
import {
  ChequeFilterBar, EMPTY_FILTERS, LIVE_STATUS, isFilterDirty, type ChequeFilterState,
} from "./ChequeFilterBar";
import { dayEndIso, dayStartIso } from "./dates";
import type { ChequeActionDef } from "./transitions";

const PAGE_SIZE = 100;

export function ChequesPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ChequeFilterState>(EMPTY_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<ChequeKind>("RECEIVED");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ row: ChequeRow; def: ChequeActionDef } | null>(null);

  const { search, status, kind, docType, currency, dueFrom, dueTo } = filters;

  const q = useQuery({
    queryKey: ["finance", "cheques", search, status, kind, docType, currency, dueFrom, dueTo],
    queryFn: () =>
      listCheques({
        page: 1,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        status: status || undefined,
        kind: kind || undefined,
        docType: docType || undefined,
        currency: currency || undefined,
        // Gün sınırı İSTEMCİNİNDİR: yerel 00:00 / 23:59:59.999 (bkz. dates.ts).
        // Boş/bozuk değer `undefined` döner → parametre hiç gitmez.
        dueFrom: dayStartIso(dueFrom),
        dueTo: dayEndIso(dueTo),
      }),
  });

  const summaryQ = useQuery({
    queryKey: ["finance", "cheques", "summary"],
    queryFn: () => getChequeSummary(),
  });

  // Bir geçiş HEM cari defteri HEM kasa/banka bakiyesini oynatır → dar
  // invalidate ekranın bir yarısını bayat bırakır.
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["finance"] });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination.total ?? 0;
  const dirty = isFilterDirty(filters);
  const activeKey = kind && status && !status.includes(",") ? `${kind}:${status}` : null;

  const selectBucket = (k: ChequeKind, s: ChequeStatus) =>
    // İkinci tıkla kovadan çık — seçilebilen her şey geri alınabilmeli.
    setFilters((f) =>
      activeKey === `${k}:${s}`
        ? { ...f, kind: "", status: LIVE_STATUS }
        : { ...f, kind: k, status: s },
    );

  const openForm = (k: ChequeKind) => {
    setFormKind(k);
    setFormOpen(true);
  };

  // DIŞA AKTARIM — spec TIKLANDIĞINDA kurulur ve EKRANDAKİ satırlardan beslenir
  // (yeni istek YOK): dosyadaki liste, ekrandaki listeden farklı olamaz. Aktif
  // süzgeçler dosyanın kapağına yazılır — varsayılan "canlı olanlar" da bir
  // süzgeçtir ve söylenmezse dosya tam portföy sanılır (bkz. `chequeExport.ts`).
  const spec = useMemo(
    () => () => (rows.length > 0 ? buildChequeExport({ rows, filters, total }) : null),
    [rows, filters, total],
  );

  return (
    <PageShell>
      <PageHeader
        title="Çek / Senet Portföyü"
        description="Alınan çek kaydedildiği AN carinin borcunu azaltır; tahsil edildiğinde kasa/banka bakiyesi artar. Her adım defterde iz bırakır."
        actions={
          <div className="flex items-center gap-2">
            {/* Dışa aktarım YAZMA İZNİ İSTEMEZ (`finance:cheque` gate'inin
                DIŞINDA): dosya, ekranı zaten açabilen kişinin gördüğü listenin
                taşınabilir hâlidir — okuma ile yazmayı aynı kapıya bağlamak,
                portföyü görebilen ama çek işleyemeyen kullanıcıyı (muhasebe)
                dosyasız bırakırdı. Liste boşken/hata varken düğmeler iş yapmaz:
                boş bir Excel "portföy boş" diye okunur ve bu bir YALAN olur. */}
            <ReportExportBar disabled={rows.length === 0} buildSpec={spec} />
            <PermissionGate permission="finance:cheque">
              <div className="flex gap-2">
                <Button onClick={() => openForm("RECEIVED")}>
                  <Plus className="mr-1 h-4 w-4" />
                  Çek Girişi
                </Button>
                <Button variant="outline" onClick={() => openForm("ISSUED")}>
                  <Plus className="mr-1 h-4 w-4" />
                  Çek Çıkışı
                </Button>
              </div>
            </PermissionGate>
          </div>
        }
      />

      <ChequeFilterBar value={filters} onChange={setFilters} />

      <PageBody className="p-6">
        <ChequeSummaryCards
          rows={summaryQ.data ?? []}
          isLoading={summaryQ.isLoading}
          isError={summaryQ.isError}
          onSelect={selectBucket}
          activeKey={activeKey}
        />

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Portföy listesi yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “kayıt yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Kayıtlarınız
              yerinde duruyor; yeni giriş yapmadan önce tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {dirty
              ? "Bu filtreyle kayıt yok. Geçmiş kayıtlar için durum filtresini “Tümü” yapın."
              : "Portföyde canlı çek/senet yok. “Çek Girişi” ile müşteriden aldığınız çeki kaydedebilirsiniz."}
          </div>
        ) : (
          <>
            <ChequeTable
              rows={rows}
              onDetail={(r) => setDetailId(r.id)}
              onAction={(row, def) => setActionTarget({ row, def })}
            />
            {total > rows.length && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-500">
                {total} kaydın ilk {rows.length} tanesi gösteriliyor (vade sırasına göre). Aradığınızı bulmak
                için arama ya da vade aralığı filtresini kullanın.
              </p>
            )}
          </>
        )}
      </PageBody>

      {/* Diyaloglar KOŞULLU mount edilir: her açılış taze bileşen demektir ve
          ön-doldurma yalnız başlangıç değeri olarak kalır. */}
      {formOpen && (
        <ChequeFormDialog
          open={formOpen}
          initialKind={formKind}
          onOpenChange={setFormOpen}
          onCreated={invalidate}
        />
      )}
      {actionTarget && (
        <ChequeActionDialog
          row={actionTarget.row}
          def={actionTarget.def}
          open
          onOpenChange={(o) => !o && setActionTarget(null)}
          onDone={invalidate}
        />
      )}
      {detailId && (
        <ChequeDetailDialog chequeId={detailId} open onOpenChange={(o) => !o && setDetailId(null)} />
      )}
    </PageShell>
  );
}
