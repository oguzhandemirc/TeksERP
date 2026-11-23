// =============================================================================
// DÖNEM KAPANIŞI — kapanış defteri
// =============================================================================
// Bir kapanış "31.12.2025 itibarıyla bu carinin TRY bakiyesi 15.000 TL'dir"
// beyanıdır: deftere satır YAZMAZ, bir FOTOĞRAF çeker ve o dönemi MÜHÜRLER.
// Mühürden sonra o tarihe (ve öncesine) düşen her defter yazımı 409 alır.
//
// ⚠️ YENİDEN AÇILMIŞ SATIR LİSTEDEN SİLİNMEZ, SOLUKLAŞIR. İptal edilmiş belgenin
// listede kalması ile aynı gerekçe: denetimde aranan şey "bu dönem bir kez
// kapandı, sonra şu gerekçeyle açıldı" izidir. Varsayılan görünüm yalnız AKTİF
// kapanışları gösterir (operasyon sorusu: "nereye kadar kapalıyız"); geçmişin
// tamamı "Yeniden açılanlar" düğmesiyle gelir (denetim sorusu).
//
// ⚠️ "Doğrula" YALNIZ aktif satırlarda çizilir — yeniden açılmış dönemde
// defterin değişmiş olması BEKLENEN durumdur ve orada alarm basmak gerçek
// ayrışmayı gürültüye boğardı.
//
// ⚠️ İZİN AYRIMI: okuma `finance:read`, kapatma/açma `finance:close`.
// `finance:invoice` bunu KAPSAMAZ — her gün deftere işleyen kişi ile geçmişi
// mühürleyen kişi ayrıdır (görev ayrılığı).
//
// ⚠️ İSTEK DÜŞERSE "KAPANIŞ YOK" YAZILMAZ. Boş liste ile başarısız istek aynı
// ekrana çıkarsa, sayfa "seçili kapsamda tüm dönemler açık" diye OLUMLU bir
// beyanda bulunur — oysa hiçbir şey bilinmiyordur. Bu ekranda o cümle
// kullanıcıyı mühürlü bir döneme kayıt girmeye yönlendirir. Hata dalı ayrı
// basılır ve açıkça "bilinmiyor" der.
//
// İKİ SEKME (2026-08-14, K-1): "Cari" (cari × para birimi mührü) ve
// "Kasa / Banka" (hesap mührü — `CashPeriodSection`). İki kapanış AYRI
// defterleri korur ve boyutları farklıdır; tek listeye karıştırmak "hangi
// mühür neyi kapatıyor" sorusunu bulandırırdı. Başlıktaki "Dönem Kapat"
// düğmesi AKTİF sekmenin diyaloğunu açar — iki ayrı düğme, aynı işin iki
// kopyası gibi okunur ve yanlış olanına basılırdı.
// =============================================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { cariPickerService } from "../Allocations/service";
import { PICKER_CHIP } from "../PaymentsFilterBar";
import { TruncatedHint } from "../TruncatedHint";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { PermissionGate } from "@/components/PermissionGate";
import type { CariRow, Currency } from "../service";
import { CashPeriodSection } from "./CashPeriodSection";
import { ClosePeriodDialog } from "./ClosePeriodDialog";
import { LockStatusCard } from "./LockStatusCard";
import { ReopenPeriodDialog } from "./ReopenPeriodDialog";
import { VerifyPeriodDialog } from "./VerifyPeriodDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { PERIOD_CURRENCIES, listPeriodCloses, type PeriodCloseRow } from "./service";
import { usePeriodCloseTable } from "./periodCloseColumns";

const CURRENCY_OPTIONS = PERIOD_CURRENCIES.map((c) => ({ value: c, label: c }));
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

type TabKey = "cari" | "cash";

export function PeriodClosePage() {
  const [tab, setTab] = useState<TabKey>("cari");
  const [cari, setCari] = useState<CariRow | null>(null);
  const [currency, setCurrency] = useState<Currency | "">("");
  const [includeReopened, setIncludeReopened] = useState(false);
  const { search, setSearch, term } = useListSearch();
  const [formOpen, setFormOpen] = useState(false);
  const [cashFormOpen, setCashFormOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<PeriodCloseRow | null>(null);
  const [reopenTarget, setReopenTarget] = useState<PeriodCloseRow | null>(null);

  // ⚠️ TEK SAYFA (backend tavanı 200). Kapanış sayısı cari × para birimi × dönem
  // ile büyür, yani yıllar içinde tavanı GERÇEKTEN aşar. Sonsuz kaydırma yerine
  // kırpmayı AÇIKÇA SÖYLEYEN bir satır konuldu: sessizce kesilen liste,
  // "o kapanış yok" diye okunur ve kullanıcı kapalı bir dönemi tekrar kapatmaya
  // çalışır. Filtreler (cari / para birimi) kırpmayı kaldırmanın yoludur.
  const PAGE_SIZE = 200;
  const q = useQuery({
    queryKey: ["finance", "period-closes", cari?.id ?? "", currency, includeReopened, term ?? ""],
    queryFn: () =>
      listPeriodCloses({
        page: 1,
        pageSize: PAGE_SIZE,
        cariId: cari?.id,
        currency: currency || undefined,
        includeReopened,
        search: term,
      }),
  });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination.total ?? rows.length;
  const table = usePeriodCloseTable(rows, { onVerify: setVerifyTarget, onReopen: setReopenTarget });

  return (
    <PageShell>
      <PageHeader
        title="Dönem Kapanışı"
        description={
          tab === "cari"
            ? "Kapanış deftere satır yazmaz — seçilen tarihteki bakiyenin fotoğrafını çeker ve o dönemi mühürler. Mühürlü döneme fatura, tahsilat ve çek kaydı girilemez."
            : "Kapanış deftere satır yazmaz — hesabın seçilen tarihteki bakiyesinin fotoğrafını çeker ve o dönemi mühürler. Mühürlü döneme tahsilat/ödeme, kasa hareketi ve çek tahsilatı girilemez."
        }
        actions={
          <div className="flex gap-2">
            <RefreshButton
              queryKey={tab === "cari" ? ["finance", "period-closes"] : ["finance", "cash-period-closes"]}
              extraKeys={[tab === "cari" ? ["finance", "period-status"] : ["finance", "cash-period-status"]]}
            />
            <PermissionGate permission="finance:close">
              {/* Tek düğme, AKTİF sekmenin diyaloğunu açar — dosya başındaki not. */}
              <Button onClick={() => (tab === "cari" ? setFormOpen(true) : setCashFormOpen(true))}>
                <Lock className="mr-1 h-4 w-4" />
                Dönem Kapat
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex min-h-0 flex-1 flex-col">
        <PageTabsList>
            <PageTabsTrigger value="cari">Cari Hesaplar</PageTabsTrigger>
            <PageTabsTrigger value="cash">Kasa / Banka</PageTabsTrigger>
        </PageTabsList>

        <TabsContent value="cari" className="mt-0 flex min-h-0 flex-1 flex-col">
          <ListToolbar className="flex-row flex-wrap items-center">
            <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Cari adı, cari kodu ya da kapanış notu ara" />
            <EntityPickerModal<CariRow>
              value={cari?.id ?? null}
              onChange={(_id, item) => setCari(item ?? null)}
              service={cariPickerService}
              queryKey="finance-cari"
              getLabel={(c) => c.name}
              getSubLabel={(c) => c.code}
              nullable
              noneLabel="Tüm cariler"
              label="Cari:"
              placeholder="Tümü"
              title="Cari seç"
              countLabel="cari"
              triggerClassName={PICKER_CHIP}
              placeholderClassName="text-foreground"
              hideChevron
            />
            <SelectChip<Currency> id="period-currency" label="Para birimi" value={currency || null} options={CURRENCY_OPTIONS} onChange={(v) => setCurrency(v ?? "")} />
            <ToolbarToggle checked={includeReopened} onCheckedChange={setIncludeReopened} label="Yeniden açılanlar" title="Yeniden açılmış kapanışlar da listelensin (denetim görünümü)" />
            <div className="ml-auto flex items-center gap-1.5">
              <DataTableTools table={table} exportName="Dönem kapanışları" compact />
            </div>
          </ListToolbar>

          {cari && currency ? (
            <ListMessage className="shrink-0 border-b">
              <LockStatusCard cariId={cari.id} cariLabel={`${cari.code} — ${cari.name}`} currency={currency} />
            </ListMessage>
          ) : null}
          {/* Sessiz boş liste YASAK (dosya başı): satır yokken hata ayrı ekran; satır varken düşen tazeleme listeyi
              silmez, DataTable "Liste tazelenemedi" bandını basar. */}
          <DataTable
            table={table}
            rowClassName={(r) => (r.reopenedAt ? "opacity-60" : undefined)}
            isLoading={q.isLoading}
            isError={q.isError}
            onRetry={() => void q.refetch()}
            errorText="Kapanış listesi alınamadı. Bu ekran şu an dönemlerin açık olduğunu SÖYLEMİYOR — bilinmiyor."
            emptyText={includeReopened || term ? "Bu filtreyle kapanış kaydı yok." : "Aktif kapanış yok — seçili kapsamda tüm dönemler açık."}
            emptyDescription={includeReopened || term ? undefined : "Yeniden açılmış eski kapanışlar için “Yeniden açılanlar” kutusunu işaretleyin."}
          />
          <ListFooter loaded={rows.length} total={q.data ? total : null}>
            {total > rows.length && rows.length > 0 ? <TruncatedHint /> : null}
          </ListFooter>
        </TabsContent>

        <TabsContent value="cash" className="mt-0 flex min-h-0 flex-1 flex-col">
          {/* Kasa sekmesi kendi filtre şeridini, listesini ve diyaloglarını
              taşır — pasifken Radix içeriği UNMOUNT eder, sorguları koşmaz. */}
          <PageBody className="p-6">
            <CashPeriodSection formOpen={cashFormOpen} onFormOpenChange={setCashFormOpen} />
          </PageBody>
        </TabsContent>
      </Tabs>

      {/* ⚠️ MOUNT DESENİ İKİ TÜRLÜ ve bilinçli — yorum kodu birebir anlatmalı:
          • Kapatma diyaloğu KOŞULLU mount edilir (`formOpen &&`): kapanınca
            bileşen ölür, form alanları (cari/tarih/not) bir sonraki açılışa
            taşınmaz. Tetikleyicisi tek bir buton olduğu için kapanış animasyonu
            kaybı görünmez.
          • Doğrula/Yeniden Aç SÜREKLİ mount, açılış `row != null` ile sürülür —
            böylece satırdan satıra geçişte Radix kapanış animasyonu korunur.
            Karşılığında hedef DEĞİŞİNCE durum sıfırlanmalıdır: bunu
            `ReopenPeriodDialog` içindeki `useEffect([row?.id])` yapar. O effect
            silinirse bir dönem için yazılan gerekçe diğerine taşınır — yani bu
            yorum ile o effect BİRLİKTE okunur. */}
      {formOpen && <ClosePeriodDialog open={formOpen} onOpenChange={setFormOpen} />}
      <VerifyPeriodDialog row={verifyTarget} onOpenChange={() => setVerifyTarget(null)} />
      <ReopenPeriodDialog row={reopenTarget} onOpenChange={() => setReopenTarget(null)} />
    </PageShell>
  );
}
