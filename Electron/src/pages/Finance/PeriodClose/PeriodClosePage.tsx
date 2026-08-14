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
// =============================================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lock, ShieldCheck, Unlock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import type { CariRow, Currency } from "../service";
import { CariPicker } from "./CariPicker";
import { ClosePeriodDialog } from "./ClosePeriodDialog";
import { LockStatusCard } from "./LockStatusCard";
import { ReopenPeriodDialog } from "./ReopenPeriodDialog";
import { VerifyPeriodDialog } from "./VerifyPeriodDialog";
import {
  PERIOD_CURRENCIES,
  formatDayKey,
  formatInstant,
  listPeriodCloses,
  moneyOf,
  type PeriodCloseRow,
} from "./service";

export function PeriodClosePage() {
  const [cari, setCari] = useState<CariRow | null>(null);
  const [currency, setCurrency] = useState<Currency | "">("");
  const [includeReopened, setIncludeReopened] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
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

  return (
    <PageShell>
      <PageHeader
        title="Dönem Kapanışı"
        description="Kapanış deftere satır yazmaz — seçilen tarihteki bakiyenin fotoğrafını çeker ve o dönemi mühürler. Mühürlü döneme fatura, tahsilat ve çek kaydı girilemez."
        actions={
          <PermissionGate permission="finance:close">
            <Button onClick={() => setFormOpen(true)}>
              <Lock className="mr-1 h-4 w-4" />
              Dönem Kapat
            </Button>
          </PermissionGate>
        }
      />

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
      </div>

      <PageBody className="space-y-6 p-6">
        {cari && currency ? (
          <LockStatusCard cariId={cari.id} cariLabel={`${cari.code} — ${cari.name}`} currency={currency} />
        ) : null}

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError && rows.length === 0 ? (
          /* Sessiz boş liste YASAK — dosya başındaki nota bak. Şart `rows.length
             === 0` ile daraltıldı: başarılı ilk yüklemeden SONRA düşen bir
             tazeleme de `isError` yakar ve koşulsuz kurgu, çalışan bir ekranı
             tek geçici hatada tamamen silerdi. Elde veri varsa liste KALIR,
             üstüne "eski olabilir" bandı basılır (aşağıda). */
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
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {includeReopened
              ? "Bu filtreyle kapanış kaydı yok."
              : "Aktif kapanış yok — seçili kapsamda tüm dönemler açık. Yeniden açılmış eski kapanışlar için “Yeniden açılanlar” düğmesine basın."}
          </div>
        ) : (
          <div className="space-y-2">
            {q.isError && (
              <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Liste tazelenemedi — aşağıdaki kayıtlar son başarılı okumaya aittir ve eski olabilir.
                Bu arada yapılmış bir kapanış burada görünmeyebilir.
              </p>
            )}
            {total > rows.length && (
              <p className="text-xs text-muted-foreground">
                Toplam {total} kapanış var, ilk {rows.length} tanesi gösteriliyor. Aradığınızı görmüyorsanız
                cari ya da para birimi seçerek daraltın.
              </p>
            )}
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Cari</th>
                    <th className="px-3 py-2 text-left">Para</th>
                    <th className="px-3 py-2 text-left">Dönem Sonu</th>
                    <th className="px-3 py-2 text-right">Mühürlü Bakiye</th>
                    <th className="px-3 py-2 text-right">Hareket</th>
                    <th className="px-3 py-2 text-left">Kapatıldı</th>
                    <th className="px-3 py-2 text-left">Not</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const reopened = Boolean(r.reopenedAt);
                    return (
                      <tr key={r.id} className={`border-t ${reopened ? "opacity-60" : ""}`}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.cariName}</div>
                          <div className="font-mono text-xs text-muted-foreground">{r.cariCode}</div>
                        </td>
                        <td className="px-3 py-2 font-medium">{r.currency}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDayKey(r.periodEnd)}
                          {reopened && (
                            <Badge className="ml-2 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                              Yeniden açıldı
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{moneyOf(r.closingBalance, r.currency)}</td>
                        <td className="px-3 py-2 text-right">{r.txnCount}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {formatInstant(r.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.notes ?? "—"}
                          {reopened && (
                            <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
                              Açılma: {formatInstant(r.reopenedAt)} — {r.reopenReason ?? "gerekçe yok"}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {!reopened && (
                              <>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  title="Mühürlü rakamı bugünkü defterle karşılaştır (salt okuma)"
                                  onClick={() => setVerifyTarget(r)}
                                >
                                  <ShieldCheck className="h-4 w-4" />
                                </Button>
                                <PermissionGate permission="finance:close">
                                  <Button variant="outline" size="sm" onClick={() => setReopenTarget(r)}>
                                    <Unlock className="mr-1 h-3.5 w-3.5" />
                                    Yeniden Aç
                                  </Button>
                                </PermissionGate>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PageBody>

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
