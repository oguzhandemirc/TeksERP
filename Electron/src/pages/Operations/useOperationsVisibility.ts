import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { isReportOpenWith } from "@/lib/report-gate";
import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { sackStoreService } from "./SackStore/service";
import type { OperationsVisibilityContext } from "./tile-config";

/**
 * Operasyon karolarının `visibleWhen` yüklemine geçilecek ÇALIŞMA ANI durumu —
 * TEK KURULUM NOKTASI.
 *
 * İki tüketici var ve ikisi de aynı kararı vermek zorunda: Operasyon hub'ının
 * karo listesi ve KOMUT PALETİ. Bağlamı iki yerde elle kurmak, `ctx`'e yeni bir
 * alan eklendiğinde birinin sessizce eski/eksik değerle karar vermesi demekti;
 * hook tek kurulum noktası olduğu için yeni alan ikisine de aynı anda gelir.
 *
 * Dönüş tipi AÇIK yazılır: bağlama alan eklenip burası güncellenmezse derleme
 * düşer (alan sessizce `undefined` gelip yüklemi yanlış karara sürükleyemez).
 *
 * 2026-08-22: çıkış bekleyen sevkiyat SONDASI (`sack-store/board?limit=1`) kalktı —
 * Sevk Kapısı karosu artık yalnız bayrağa bakıyor (gerekçe `tile-config.ts`'te).
 */
export function useOperationsVisibilityContext(): OperationsVisibilityContext {
  const shipmentConfirmationEnabled = useShipmentConfirmationEnabled();
  const { hasPermission } = useRoleAccess();
  const flagsQuery = useFeatureFlags();
  const financeEnabled = flagsQuery.data?.data?.financeEnabled ?? false;
  // Backend varsayılanı AÇIK — belirsizken de açık kabul edilir (panelin her
  // yerindeki yazım: `productionEnabled ?? true`).
  const productionEnabled = flagsQuery.data?.data?.productionEnabled ?? true;
  const ticaretEnabled = flagsQuery.data?.data?.ticaretEnabled ?? false;
  // ⚠️ ETKİN DEĞER, HAM DEĞİL — bağımlılık (iplik → ticaret) panelde TEK yerde
  // çözülür: burada. Backend de aynı kuralı kapının içinde uygular; ham değer
  // yalnız Genel Ayarlar toggle'ının kendi yazdığını geri okuması için döner.
  // Zinciri karo yüklemlerine dağıtmak, bir gün birinin unutması demekti.
  const iplikEnabled =
    ticaretEnabled && (flagsQuery.data?.data?.iplikEnabled ?? false);
  // 2026-09-02: ÇOK DEPO artık veri türevi DEĞİL, modül anahtarı. Eskiden
  // `useMultiWarehouse()` (aktif depo > 1) okunuyordu — o hook da artık aynı
  // bayrağı okuyor, yani tek kaynak korunuyor. Buradan çağrılmamasının sebebi
  // depo listesi sorgusunun bu ekranda hiç gerekmemesi (hub her açılışta
  // kimsenin okumadığı bir istek atıyordu — 2026-09-01 sondasının aynısı).
  const depoMultiEnabled = flagsQuery.data?.data?.depoMultiEnabled ?? false;
  // ⚠️ DEVERE BAĞIMSIZ (2026-09-14, 1e K3 / DEVERE-LEVENT §9.7d): hazır/fason levent iplik
  // tüketmez; backend kapısı yalnız devere okur, iplik kapısı aksiyon anında (içeride sarım).
  // Belirsizken FALSE ("sıfır görünür fark").
  const devereEnabled = flagsQuery.data?.data?.devereEnabled ?? false;
  // ⚠️ ETKİN DEĞER (iki halka): dokuma → production. Belirsizken FALSE — fabrikada
  // karo bir an belirip kaybolmamalı ("sıfır görünür fark"); backend kapısı
  // `requireDokumaEnabled` aynı sırayı ölçer.
  const dokumaEnabled = productionEnabled && (flagsQuery.data?.data?.dokumaEnabled ?? false);
  // Rapor listesi: alan yoksa/yüklenmediyse de `null` — "boş liste = hepsi açık" yalnız
  // backend'in gerçekten boş dizi söylediği durumdur (fail-closed, K5).
  const reportsClosedKeys: readonly string[] | null = flagsQuery.data?.data?.reportsClosedKeys ?? null;
  const isReportOpen = useCallback((key: string) => isReportOpenWith(reportsClosedKeys, key), [reportsClosedKeys]);

  // ⚠️ ÇIKIŞ BEKLEYEN SEVKİYAT SONDASI KALDIRILDI (2026-09-01, birleştirme).
  // 2026-08-22 kararı Sevk Kapısı karosunu SAF BAYRAĞA bağladı ve `sack-store/
  // board?limit=1` sondasını kaldırdı. Birleştirmede kararın yalnız YARISI
  // taşındı: karo yüklemi düzeltilmişti ama bağlam alanı ve onu besleyen sorgu
  // depo dalından hayatta kaldı — Operasyon hub'ı her açılışta KİMSENİN
  // OKUMADIĞI bir istek atıyordu.
  return {
    shipmentConfirmationEnabled,
    financeEnabled,
    productionEnabled,
    ticaretEnabled,
    iplikEnabled,
    depoMultiEnabled,
    devereEnabled,
    dokumaEnabled,
    reportsClosedKeys,
    isReportOpen,
  };
}
