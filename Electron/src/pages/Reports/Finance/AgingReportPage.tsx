// =============================================================================
// CARİ YAŞLANDIRMA — "kimden ne kadar alacağım var ve NE KADAR ESKİ"
// =============================================================================
// ⚠️ BU BİR KESİT RAPORUDUR: tek bir `asOf` anı vardır, tarih ARALIĞI YOKTUR
// (bkz. `AgingFilterBar` başlığı). Katalog sözleşmesi `kesit`: ortak `ReportDateFilter`
// tek gün girdisi çizer, `useAsOfDay` `asOf`u günün SONU olarak üretir; aralık
// seçtiren bir ekran kavramı yanlış öğretirdi ve backend de `dateFrom`/`dateTo`'yu
// `.strict()` ile 400'ler.
//
// ⚠️ PARA BİRİMLERİ TOPLANMAZ — ne tabloda ne özet kartlarda. Üstteki kartlar bu
// yüzden ADET sayar (cari sayısı · vadesi geçen cari · mutabakat); para
// toplamları her blok kendi başlığında kendi biriminde basar. "Toplam alacak"
// diye tek sayı üretmek 1.000 USD ile 30.000 TL'yi toplamak olurdu.
//
// ⚠️ ARAMA İSTEMCİDE SÜZER ve bu güvenlidir çünkü rapor SAYFALI DEĞİLDİR (liste
// tamdır). Ama TOPLAM satırları backend'den gelir ve süzgeçten ETKİLENMEZ —
// süzgeç açıkken bunu söyleyen bir bant çıkar; söylenmezse "satırlar toplamı
// tutmuyor" denir ve rapora güven biter.
// =============================================================================

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ShieldCheck, TimerOff, Users } from "lucide-react";
import { MetricCard, ReportDateFilter, ReportExportBar, ReportPageLayout } from "../_components";
import { useAsOfDay } from "../_hooks/useReportDay";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { fmtDate, fmtInt } from "../_components/formatters";
import { AgingBlockTable } from "./AgingBlockTable";
import { AgingDetailDialog } from "./AgingDetailDialog";
import { AgingCariSelect, AgingFilterBar, type AgingFilterState } from "./AgingFilterBar";
import { AgingReconBanner, AgingScopeNote } from "./AgingReconBanner";
import { CariStatementDialog, type StatementTarget } from "./CariStatementDialog";
import { ReportErrorCard } from "./ReportErrorCard";
import { ReportNotesCard } from "./ReportNotesCard";
import { buildAgingExport } from "./agingExport";
import {
  getAgingReport,
  isZeroAmount,
  type AgingCariRow,
  type CariKind,
  type Currency,
} from "./service";
import { lowerTr } from "../../../lib/tr-case";
import { ReportFilterNotes } from "../_components";
import { useAxisNotes, useReportAxes } from "../_hooks/useReportAxes";

const AGING_AXES = ["cariId"] as const;

export function AgingReportPage() {
  const [sp, setSp] = useSearchParams();

  // Filtre URL'de yaşar: paylaşılan link filtresiyle birlikte gider (rapor
  // sayfalarının ortak sözleşmesi — `useReportDateRange` de böyle çalışır).
  const filters: AgingFilterState = {
    kind: (sp.get("kind") as CariKind | null) ?? "",
    currency: (sp.get("currency") as Currency | null) ?? "",
    onlyOverdue: sp.get("overdue") === "1",
    search: sp.get("q") ?? "",
  };
  const patch = (p: Partial<AgingFilterState>) => {
    const next = new URLSearchParams(sp);
    const set = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
    if (p.kind !== undefined) set("kind", p.kind);
    if (p.currency !== undefined) set("currency", p.currency);
    if (p.onlyOverdue !== undefined) set("overdue", p.onlyOverdue ? "1" : "");
    if (p.search !== undefined) set("q", p.search);
    setSp(next, { replace: true });
  };

  // Kesit URL `asOf` (YMD) → backend `asOf` = o günün SONU (hook üretir).
  const { ymd: asOfYmd, params: asOfParam } = useAsOfDay("finance/aging");
  const asOfIso = asOfParam.asOf;
  const asOfLabel = fmtDate(asOfYmd);
  // Kayıtlı cari bakiyesi her zaman "şu an"dır; geçmiş kesitte karşılaştırma
  // tanım gereği fark üretir (kasa defterindeki `storedComparable` ile aynı kural).
  const storedComparable = new Date(asOfIso).getTime() >= Date.now() - 60_000;

  // CARİ EKSENİ (R5b-d): sunucu süzer, seçenek listesi `meta.secenekler`ten
  // gelir. ⚠️ Ekrandaki ARAMA kutusuyla karıştırılmamalı: seçici RAPORU süzer
  // (toplamlar ve mutabakat yeniden hesaplanır), arama yalnız EKRANI daraltır.
  const axes = useReportAxes();
  const query = useQuery({
    queryKey: ["reports", "finance", "aging", asOfIso, filters.kind, filters.currency, filters.onlyOverdue, axes.sel.cariId],
    queryFn: () =>
      getAgingReport({
        ...asOfParam,
        cariId: axes.sel.cariId,
        kind: filters.kind || undefined,
        currency: filters.currency || undefined,
        onlyOverdue: filters.onlyOverdue,
      }),
    staleTime: 30_000,
  });

  const envelope = query.data;
  const report = envelope?.data;
  const [detailRow, setDetailRow] = useState<AgingCariRow | null>(null);
  const [statementTarget, setStatementTarget] = useState<StatementTarget | null>(null);
  // Ekstre bir DİYALOG raporudur (`finance/statement`); kapalıysa düğmesi belirmez ve diyalog
  // mount edilmez — karo/route/palet kuralı diyalog için de geçerli (K5), backend de 403 verir.
  const statementOpen = useOperationsVisibilityContext().isReportOpen("finance/statement");

  const needle = lowerTr(filters.search.trim());
  const matches = (r: AgingCariRow) =>
    !needle ||
    lowerTr(r.name).includes(needle) ||
    lowerTr(r.code).includes(needle);

  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of report?.blocks ?? []) for (const r of b.rows) if (matches(r)) ids.add(r.cariId);
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, needle]);

  // ⚠️ CARİ SAYISI ≠ SATIR SAYISI (2026-08-14 denetim bulgusu). Rapor satırları
  // (cari × PARA BİRİMİ) çifti başına kuruluyor: TRY'de ve USD'de bakiyesi olan
  // TEK bir müşteri İKİ satır üretir. Bu iki kart eskiden satır sayıyordu —
  // biri `reconciliation.rowsChecked` (adı zaten "satır"), diğeri `rows.filter
  // (...).length` — ve yönetici "kaç müşteri bize borçlu" sorusunun cevabını
  // buradan okuduğu için sayı SİSTEMATİK olarak şişkindi (canlı veride 5 cari
  // için "6"). Hata da log da çıkmıyordu.
  //
  // ⚠️ `reconciliation.rowsChecked` DÜZELTİLMEDİ ve düzeltilmemeli: o alan
  // MUTABAKATIN kaç satır denetlediğini söyler, adı da doğrudur — kart yanlış
  // alana bakıyordu.
  const distinctCari = (pred: (r: { cariId: string; overdueTotal: unknown }) => boolean): number => {
    const ids = new Set<string>();
    for (const b of report?.blocks ?? []) for (const r of b.rows) if (pred(r)) ids.add(r.cariId);
    return ids.size;
  };
  const openCari = distinctCari(() => true);
  const overdueCari = distinctCari((r) => !isZeroAmount(r.overdueTotal as never));
  const mismatched = report?.reconciliation.mismatchedRows ?? 0;
  const { secenekler, notes: axisNotlari } = useAxisNotes(envelope, axes.sel, AGING_AXES);
  const filterNote = needle ? `Ekranda “${filters.search.trim()}” araması uygulanıyor` : null;

  const spec = useMemo(
    () => () => (report ? buildAgingExport({ report, visibleRowIds: visibleIds, asOfLabel, filterNote, filterNotes: axisNotlari }) : null),
    [report, visibleIds, asOfLabel, filterNote, axisNotlari],
  );

  return (
    <ReportPageLayout
      reportKey="finance/aging"
      title="Cari Yaşlandırma"
      description="Açık bakiyenin yaşı — kimden ne kadar alacağımız var ve ne kadar gecikmiş."
      filters={
        <AgingFilterBar
          value={filters}
          onChange={patch}
          dateFilter={<ReportDateFilter reportKey="finance/aging" bare />}
          cariSelect={<AgingCariSelect options={secenekler?.cariId} value={axes.sel.cariId} onChange={(v) => axes.set("cariId", v)} />}
        />
      }
      actions={<ReportExportBar disabled={!report} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={axisNotlari} />
      <AgingScopeNote />

      <AgingReconBanner recon={report?.reconciliation} />

      {/* ⚠️ HATA DURUMUNDA KARTLAR HİÇ ÇİZİLMEZ. `overdueCari` boş listeden 0,
          `mismatched` de `?? 0` ile 0 çıkıyor → "Mutabakat: Tutuyor" YEŞİL
          basılırdı. Veri hiç gelmemişken mutabakatın tuttuğunu iddia etmek, bu
          ekranda yapılabilecek en tehlikeli yalandır (kullanıcı tam da o karta
          bakıp rakama güveniyor). */}
      {query.isError ? null : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Kesit" value={asOfLabel} hint="Seçilen günün SONU itibarıyla" icon={CalendarClock} />
        <MetricCard
          label="Açık bakiyeli cari"
          value={fmtInt(openCari)}
          hint="Tekil cari sayısı — çok para birimli cari BİR kez sayılır"
          icon={Users}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Vadesi geçen cari"
          value={fmtInt(overdueCari)}
          hint="Vadesi gelmemiş ve vadesiz satırlar hariç"
          icon={TimerOff}
          tone={overdueCari > 0 ? "warn" : "ok"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Mutabakat"
          value={mismatched === 0 ? "Tutuyor" : `${fmtInt(mismatched)} satır sapmış`}
          hint="Σ kovalar − kapanmamış kredi = cari defteri"
          icon={ShieldCheck}
          tone={mismatched === 0 ? "ok" : "bad"}
          isLoading={query.isLoading}
        />
      </div>
      )}

      {filterNote ? (
        <p className="text-xs text-muted-foreground">
          {filterNote} — <strong>TOPLAM satırları süzgeçten etkilenmez</strong>, kesitteki tüm carileri
          kapsar.
        </p>
      ) : null}

      {/* ⚠️ HATA DALI BOŞ DALDAN ÖNCE GELİR. Aksi halde 403/500'de ekran
          "açık bakiyeli cari yok" der — para konusunda sessizce YANLIŞ bir
          cevap (bkz. `ReportErrorCard` başlığı). En sık gerçekleşen hâli
          fabrika kurulumudur: `finance.enabled` kapalı → 403. */}
      {query.isError ? (
        <ReportErrorCard error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : (report?.blocks.length ?? 0) === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Bu kesitte açık bakiyeli cari yok.
          {/* Kapalı bir filtreyi sebep gibi göstermek, kullanıcıyı olmayan bir
              düğmeyi aramaya gönderir — ipucu yalnız filtre AÇIKKEN basılır. */}
          {filters.onlyOverdue
            ? " “Yalnız vadesi geçenler” açık: vadesi gelmemiş ve vadesiz bakiyeler listelenmiyor — filtreyi kapatıp tekrar bakın."
            : " Kesiti ileri alın ya da filtreleri gevşetin."}
        </div>
      ) : (
        report?.blocks.map((b) => (
          <AgingBlockTable
            key={b.currency}
            block={b}
            buckets={report.buckets}
            rows={b.rows.filter(matches)}
            storedComparable={storedComparable}
            onOpenDetail={setDetailRow}
            onOpenStatement={
              statementOpen
                ? // `code`: ekstre dosyasının kapağında cari kodu da yazsın (H3 dikişi).
                  (r) => setStatementTarget({ cariId: r.cariId, name: r.name, code: r.code, currency: r.currency })
                : undefined
            }
          />
        ))
      )}

      <ReportNotesCard title="Bu rapor nasıl okunur" notes={report?.notes ?? []} />

      {/* Diyaloglar KOŞULLU mount edilir: her açılış taze bileşen demektir ve
          içerideki tarih/para birimi durumu bir önceki cariden sızmaz. */}
      {detailRow ? (
        <AgingDetailDialog
          row={detailRow}
          asOf={asOfIso}
          open={Boolean(detailRow)}
          onOpenChange={(o) => !o && setDetailRow(null)}
        />
      ) : null}
      {statementTarget && statementOpen ? (
        <CariStatementDialog
          target={statementTarget}
          open={Boolean(statementTarget)}
          onOpenChange={(o) => !o && setStatementTarget(null)}
        />
      ) : null}
    </ReportPageLayout>
  );
}
