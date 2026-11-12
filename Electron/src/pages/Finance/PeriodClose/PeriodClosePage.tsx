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
import { AlertTriangle, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { PermissionGate } from "@/components/PermissionGate";
import type { CariRow, Currency } from "../service";
import { CariPicker } from "./CariPicker";
import { CashPeriodSection } from "./CashPeriodSection";
import { ClosePeriodDialog } from "./ClosePeriodDialog";
import { LockStatusCard } from "./LockStatusCard";
import { ReopenPeriodDialog } from "./ReopenPeriodDialog";
import { VerifyPeriodDialog } from "./VerifyPeriodDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { PERIOD_CURRENCIES, listPeriodCloses, type PeriodCloseRow } from "./service";
import { usePeriodCloseTable } from "./periodCloseColumns";

type TabKey = "cari" | "cash";

export function PeriodClosePage() {
  const [tab, setTab] = useState<TabKey>("cari");
  const [cari, setCari] = useState<CariRow | null>(null);
  const [currency, setCurrency] = useState<Currency | "">("");
  const [includeReopened, setIncludeReopened] = useState(false);
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
    queryKey: ["finance", "period-closes", cari?.id ?? "", currency, includeReopened],
    queryFn: () =>
      listPeriodCloses({
        page: 1,
        pageSize: PAGE_SIZE,
        cariId: cari?.id,
        currency: currency || undefined,
        includeReopened,
      }),
  });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination.total ?? rows.length;
  const hasRows = !q.isLoading && rows.length > 0;
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
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
            <CariPicker
              className="w-72"
              nullable
              value={cari?.id ?? null}
              selectedLabel={cari ? `${cari.code} — ${cari.name}` : null}
              onChange={setCari}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency | "")}
            >
              <option value="">Tüm para birimleri</option>
              {PERIOD_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button
              variant={includeReopened ? "default" : "outline"}
              onClick={() => setIncludeReopened((v) => !v)}
              title="Yeniden açılmış kapanışlar da listelensin (denetim görünümü)"
            >
              Yeniden açılanlar
            </Button>
            <div className="ml-auto">
              <DataTableTools table={table} exportName="Dönem kapanışları" compact />
            </div>
          </div>

          {cari && currency ? (
            <ListMessage className="shrink-0 border-b">
              <LockStatusCard cariId={cari.id} cariLabel={`${cari.code} — ${cari.name}`} currency={currency} />
            </ListMessage>
          ) : null}
          {hasRows ? (
            <>
              {q.isError && (
                <p className="flex shrink-0 items-start gap-2 border-b bg-amber-100 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Liste tazelenemedi — aşağıdaki kayıtlar son başarılı okumaya aittir ve eski olabilir.
                  Bu arada yapılmış bir kapanış burada görünmeyebilir.
                </p>
              )}
              {total > rows.length && (
                <p className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
                  Toplam {total} kapanış var, ilk {rows.length} tanesi gösteriliyor. Aradığınızı görmüyorsanız
                  cari ya da para birimi seçerek daraltın.
                </p>
              )}
              <DataTable table={table} rowClassName={(r) => (r.reopenedAt ? "opacity-60" : undefined)} />
            </>
          ) : (
            <ListBody>
              {q.isLoading ? (
                <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
              ) : q.isError ? (
                /* Sessiz boş liste YASAK — dosya başındaki nota bak. Yalnız elde satır YOKKEN: başarılı ilk yüklemeden
                   SONRA düşen tazeleme listeyi silmez, üstüne "eski olabilir" bandı basılır (yukarıda). */
                <ListMessage>
                  <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Kapanış listesi alınamadı.</p>
                      <p className="mt-0.5 text-xs">
                        Bu ekran şu an dönemlerin açık olduğunu SÖYLEMİYOR — bilinmiyor. Kayıt girmeden önce
                        listeyi yenileyin.
                      </p>
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
                        Tekrar dene
                      </Button>
                    </div>
                  </div>
                </ListMessage>
              ) : (
                <ListMessage>
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {includeReopened
                      ? "Bu filtreyle kapanış kaydı yok."
                      : "Aktif kapanış yok — seçili kapsamda tüm dönemler açık. Yeniden açılmış eski kapanışlar için “Yeniden açılanlar” düğmesine basın."}
                  </div>
                </ListMessage>
              )}
            </ListBody>
          )}
          <ListFooter loaded={rows.length} total={q.data ? total : null} />
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
