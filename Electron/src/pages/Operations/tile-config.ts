import type { LucideIcon } from "lucide-react";
import type { OperationGroupKey } from "./groups-config";
import { planningTiles } from "./tiles/planning";
import { productionTiles } from "./tiles/production";
import { warehouseTiles } from "./tiles/warehouse";
import { shippingTiles } from "./tiles/shipping";

/**
 * Karo görünürlüğünün bağlı olduğu ÇALIŞMA ANI durumu (hub + komut paleti).
 *
 * 2026-08-05'te KÜÇÜLDÜ: içinde üç kurşun alanı vardı (`kursunBypassEnabled`,
 * `kursunPendingAssignmentCount`, `kursunTabletRegimeCount`) ve iki ayrı kurşun
 * karosunun görünürlüğünü sürüyordu. Kurşun Sırası + Kurşun Dağıtım TEK ekranda
 * birleşti (`Kurşun Planlama`) ve o ekran BAYRAKTAN BAĞIMSIZ — bayrak yalnız
 * ekranın İÇİNDEKİ dağıtım kontrollerini açıp kapatıyor. Görünürlük kararı da
 * saf izin kontrolüne indi; sayaçları menü için çeken uç (`/kursun-bypass/
 * visibility`) Electron'da artık tüketilmiyor.
 *
 * 2026-08-22'de bir daha KÜÇÜLDÜ: `pendingPlannedShipments` (çıkış bekleyen
 * PLANNED sevkiyat sondası) kalktı — bkz. Sevk Kapısı karosundaki not. Bağlam
 * artık tek bayrak taşır; yeni bir sayaç eklemeden önce sorulacak soru "bu
 * ekranın işi başka bir ekrandan da yapılabiliyor mu?" (yapılabiliyorsa sayaç
 * değil, o ekrana aksiyon eklenir).
 */
export interface OperationsVisibilityContext {
  /** `shipping.confirmationEnabled` — sevk onayı ara adımı. */
  shipmentConfirmationEnabled: boolean;
  /**
   * ÇOK DEPOLU kurulum mu (`depo.multiEnabled`)?
   *
   * ⚠️ 2026-09-02: bu alan artık VERİDEN TÜRETİLMİYOR (eskiden "aktif depo > 1")
   * — gerçek bir modül anahtarı. Sebep: türetilmiş durum ikinci depo açılır
   * açılmaz yüzeyleri getiriyordu; modülü açma kararı artık AÇIK bir karardır ve
   * backend kapısıyla (`requireDepoMultiEnabled`, transfer uçları) aynı kaynaktan
   * beslenir. Adı `depoMultiEnabled` — bayrağın adıyla birebir (ctx'te ikinci bir
   * ad, "hangisi asıl" sorusunu doğururdu).
   *
   * "Fabrikada sıfır görünür fark" kuralının karo ayağı: fabrikada anahtar
   * KAPALI damgalandı (migration ölçtü) → Depo Transferi karosu ÇİZİLMEZ.
   *
   * Mal Kabul karosu bu bayrağa BAĞLANMAZ — tek depolu bir alım-satım firması da
   * onu kullanır; orada kapı İZİNDİR (`goods-receipt:*`, hiçbir varsayılan rolde yok).
   */
  depoMultiEnabled: boolean;
  /**
   * DEVERE / LEVENT modülü (`devere.enabled`) — ETKİN değer
   * (`ticaret && iplik && devere`), ham değil. Zincir üç halkadır ve panelde
   * TEK yerde çözülür (`useOperationsVisibilityContext`); backend kapısı
   * `requireDevereEnabled` aynı sırayı ölçer. Ham değer yalnız Modüller
   * ekranındaki toggle'ın kendi yazdığını geri okuması için döner.
   */
  devereEnabled: boolean;
  /**
   * DOKUMA İŞİ modülü (`dokuma.enabled`) — ETKİN değer (`production && dokuma`),
   * ham değil; tek çözüm noktası `useOperationsVisibilityContext`. Tezgah
   * izlemenin KARDEŞİ, çocuğu değil. Backend kapısı `requireDokumaEnabled`
   * (`weaving-order` · `machine-run` · `machine-doff` router'ları).
   */
  dokumaEnabled: boolean;
  /**
   * TEZGAH İZLEME modülü (`tezgah.enabled`) — ETKİN değer (`production && tezgah`);
   * tek çözüm noktası `useOperationsVisibilityContext`. Dokuma işinin KARDEŞİ.
   * Backend kapısı `requireTezgahEnabled` (`/api/loom-floor`).
   */
  tezgahEnabled: boolean;
  /**
   * KALİTE GÜVENCE modülü (`kaliteGuvence.enabled`, K4P) — zincirsiz (KK1 üretim kapalıyken de
   * çalışır). Belirsizken FALSE ("sıfır görünür fark"); backend kapısı `requireKaliteGuvenceEnabled`.
   */
  kaliteGuvenceEnabled: boolean;
  /**
   * MALİYET & TEKLİF modülü (`maliyet.enabled`, MAL) — ETKİN değer (`production && maliyet`); backend kapısı
   * `requireMaliyetEnabled` (`/api/cost`). Belirsizken FALSE: menü bayrak gelmeden çizilmez (fail-closed).
   */
  maliyetEnabled: boolean;
  /**
   * Ön muhasebe modülü açık mı (`finance.enabled`) — fiilen "bu bir TİCARET
   * kurulumu" anahtarı. Tanımlar menüsünün cari rejimi buna bakar: bayrak
   * AÇIKKEN tek "Cariler" karosu, KAPALIYKEN (fabrika) bugünkü Müşteriler +
   * Fason Firmalar. Belirsizken (yükleniyor) FALSE → fabrika görünümüne düşülür
   * (Sidebar featureFlag kararıyla aynı yön: yanlış tarafa düşmek fabrikada
   * karo titremesi demekti, ticarette yalnız kısa bir gecikme).
   */
  financeEnabled: boolean;
  /**
   * Üretim modülü açık mı (`production.enabled`, varsayılan AÇIK). Belirsizken
   * TRUE'ya düşülür — backend varsayılanı da odur.
   *
   * 2026-09-03 (P5): artık GERÇEKTEN karo kararı veriyor — İş Emirleri · Kumaş
   * Dengesi · Kurşun Planlama (Operasyon) ve Üretim Rotaları · İş Emri
   * Şablonları · Refakat Kartı (Tanımlar) bu bayrağa bağlandı. Yüklemler saf
   * katmanda: `Operations/production-regime.ts` · `Definitions/production-regime.ts`.
   * Backend ikizi `requireProductionEnabled` (route · iş emri · tambur · kurşun ·
   * parti · refakat kartı router'ları).
   *
   * ⚠️ ALAN AYRICA TİP ZORUNLULUĞU: komut paletinin Genel Ayarlar girişleri
   * `settingsCategoryVisibleWhen` yüklemini TAŞIYOR (kopyalamıyor) ve o yüklem
   * `SettingsRegime` bekliyor — yani bu bağlam iki rejim anahtarını da taşımak
   * zorunda. Karo bağı düşse bile alan kalır.
   *
   * ⚠️ AYAR KATEGORİLERİ AYRI BİR SORU ve orada kapı GİZLEME değil KİLİTTİR
   * (`SettingsCategory.moduleKey`): bu bayrağın arkasında OLMAYAN yüzeyler de
   * var (`/api/rolls` bilinçli kapısız), yani ayar sekmesini gizlemek "açtım,
   * kapatamıyorum" çıkmazı üretirdi. Ölçen bekçi:
   * `Teks-Erp/scripts/test_feature_flag_contract.ts` §14 / §14b.
   */
  productionEnabled: boolean;
  /**
   * TİCARET modülü açık mı (`ticaret.enabled`)? Alış siparişi · mal kabul · fiyat
   * listesi · stok sayımı yüzeylerinin rejim kapısı. Backend ikizi
   * `requireTicaretEnabled`. Belirsizken FALSE (fabrika görünümü — "sıfır fark").
   *
   * ⚠️ `financeEnabled` ile AYNI ŞEY DEĞİL: 2026-09-02'ye kadar bu ekranlar
   * ön muhasebe bayrağına asılıydı; ticaret paketi ondan ayrıldı. Bir kurulum
   * fatura tutmadan alım-satım yapabilir (ticaret açık, muhasebe kapalı).
   */
  ticaretEnabled: boolean;
  /**
   * İPLİK modülü açık mı? ⚠️ Buradaki değer ETKİN değerdir
   * (`ticaretEnabled && iplikEnabled`) — bağımlılık TEK YERDE, bağlamı kuran
   * `useOperationsVisibilityContext` içinde çözülür. Karo yüklemleri zinciri
   * yeniden kurmaz; kurarlarsa bir gün biri unutur ve ticaret kapalıyken iplik
   * karosu belirir (backend yine 403 verir → tıklanan boş ekran).
   */
  iplikEnabled: boolean;
  /**
   * KAPALI rapor anahtarları — `reports.closedKeys` tek listesi (Raporlar K2/K5).
   * `null` = liste okunamadı ya da bayraklar henüz yüklenmedi ⇒ FAIL-CLOSED, hiçbir rapor
   * açık değil. Karo · route · palet üçü de `isReportOpen`den okur, listeyi kendisi süzmez.
   */
  reportsClosedKeys: readonly string[] | null;
  /** Rapor açık mı — katalogda olmayan anahtar KAPALI, liste okunamadıysa KAPALI. */
  isReportOpen: (key: string) => boolean;
  /**
   * `reports.v2Enabled` — Rapor Merkezi + v2 yaprakları. Belirsizken FALSE (bugünkü hub). İsteğe
   * bağlı alan: bağlamı elle kuran testler/yüzeyler eski davranışta kalır (yokluk = kapalı).
   */
  reportsV2Enabled?: boolean;
  /**
   * Bayrak sorgusu SONUÇLANDI mı (başarı YA DA hata). Yüklenmemiş bayrak "kapalı" DEĞİL
   * "bilinmiyor"dur: modül/rapor kapısı bunu okuyup BEKLER — yenilemede (HMR · Cmd+R · ilk
   * giriş) ticaret yolu `?? false` ile kapalı okunup `/forbidden`a yönlendiriliyordu (2026-09-17).
   */
  flagsReady: boolean;
  /** Sorgu HATA ile bitti: bayraklar bilinmiyor; kapılar yönlendirmez, gerçek kapı backend 403. */
  flagsFailed: boolean;
}

export interface OperationsTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  /** Ait olduğu mantıksal grup (hub'da bölüm başlığı altında toplanır). */
  group: OperationGroupKey;
  permission?: string;
  /** Birden çok izinden HERHANGİ biri yeterli (route requireAnyPermission ile hizalı). */
  permissionAny?: string[];
  /**
   * Duruma bağlı görünürlük — verilmezse karo her zaman görünür (izin filtresi ayrı).
   *
   * NEDEN BAYRAK ALANI DEĞİL DE FONKSİYON (2026-08-02 kararı):
   * Eski üç alan (`requiresShipmentConfirmation` / `requiresKursunBypass` /
   * `hiddenWhenKursunBypass`) hub'da ard arda `if (…) return false` ile
   * uygulanıyordu; yani alanlar sessizce **VE** ile birleşiyordu. Yeni kurallar
   * ise **VEYA**'dır ("bayrak açık VEYA işi kaldı"). Bunu alan olarak ifade etmek
   * için iki alan daha (`visibleWhenPendingAssignments`,
   * `visibleWhenTabletRegime`) eklemek gerekirdi ve hangi alanın VE hangisinin
   * VEYA ile bağlandığı bilgisi karonun yanında değil, hub'ın filtre gövdesinde
   * kalırdı — düzeltmeye çalıştığımız hatanın ta kendisi. Tek bir saf yüklem,
   * kuralı karonun YANINDA tutar, hub'ı aptallaştırır (izin + yüklem) ve
   * doğrudan birim testine açar (`tile-visibility.test.ts`).
   *
   * Yüklem SAF olmalı: React hook'u çağırmaz, yalnız `ctx`'e bakar.
   */
  visibleWhen?: (ctx: OperationsVisibilityContext) => boolean;
  /**
   * `visibleWhen` false iken karo GİZLENMEZ, soluk çizilir ve tıkta bu mesajı verir (K4P yerleşim kararı:
   * modül kapalıyken kullanıcı ekranın varlığını ve nereden açılacağını görür). Palet yine gizler.
   */
  offHint?: string;
}

// Karolar grup dosyalarında (`tiles/*.ts`, UX-2 bölünmesi); bekçiler `scripts/lib/panel-karo-dosyalari.ts` ile hepsini okur.
export const operationsTiles: OperationsTile[] = [
  ...planningTiles,
  ...productionTiles,
  ...warehouseTiles,
  ...shippingTiles,
];
