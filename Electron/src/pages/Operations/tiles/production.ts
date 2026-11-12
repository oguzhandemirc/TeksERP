// Üretim karoları (menü kökü Üretim, `/production`; sıra = hub sırası). Fason karolarının ikisi `warehouse.ts`te.
import { Factory, FilePlus2, Gauge, History, Ruler, Share2, SwatchBook, Spool, AlertOctagon, MonitorPlay, Siren, Layers, CalendarClock } from "lucide-react";
import { isKursunPlanningVisible, isMeterDeviationsVisible, isWorkOrdersVisible } from "../production-regime";
import { isWeavingOrdersVisible } from "../WeavingOrders/weaving-regime";
import { isMachineStopsVisible, machineStopsTitle } from "../MachineStops/stop-regime";
import { isWeavingFloorVisible } from "../WeavingFloor/floor-regime";
import { isLoomAlarmsVisible } from "../LoomAlarms/alarm-regime";
import { isWarpBeamsVisible } from "../WarpBeams/warp-beam-regime";
import { TERIM, TERIM_AD, terimDokumaRejimi } from "@/lib/terim";
import { flagOffHint, flagSettingTrail } from "@/lib/flag-setting-path";
import type { OperationsTile } from "../tile-config";

export const productionTiles: OperationsTile[] = [
  {
    key: "work-orders",
    get title() { return TERIM.terbiyeIsEmri.cogul; },
    description: "Üretim partileri ve rota ilerleyişi",
    icon: Factory,
    to: "/operations/work-orders",
    group: "production",
    permission: "workorder:read",
    // ÜRETİM MODÜLÜ (2026-09-03): backend `workorder.routes` zaten
    // `requireProductionEnabled` taşıyordu; karo bayraksızdı → modül kapalı bir
    // kurulumda kart görünür, tıklayınca 403. Yüklem SAF modülden DOĞRUDAN
    // geçirilir (sarmalayan ok fonksiyonu YAZILMAZ — palet kimlik testi).
    visibleWhen: isWorkOrdersVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    // K6 (Gülkesim 2026-11-02): tek giriş — seçici (Standart: Terbiye · Dokuma / Özel: kısayol rotaları). Adres ve izin
    // yeni kayıt route'uyla birebir; eski karosuz palet girişinin yerini aldı.
    key: "work-order-create",
    get title() { return `${TERIM.terbiyeIsEmri.tekil} oluştur`; },
    // Dokuma kapalı kurulumda seçicide dokuma iş emri yok — açıklama da anmaz.
    get description() {
      const dokuma = terimDokumaRejimi() ? `, ${TERIM.dokumaIsEmri.tekilKucuk}` : "";
      return `${TERIM.terbiyeIsEmri.tekil}${dokuma} ya da özel kısayol (ör. Kurşun & Tambur) — belge okutarak da`;
    },
    icon: FilePlus2,
    to: "/operations/work-orders/new",
    group: "production",
    permission: "workorder:write",
    visibleWhen: isWorkOrdersVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    key: "work-order-events",
    get title() { return `${TERIM.terbiyeIsEmri.tekil} Hareketleri`; },
    get description() { return `${TERIM.terbiyeIsEmri.cumleBasi.yalin} no ya da top barkoduyla bütün hareketler`; },
    icon: History,
    to: "/operations/work-order-events",
    group: "production",
    permission: "workorder:read",
    // İş emirleriyle aynı modül kapısı — üretim kapalı kurulumda karo çizilmez.
    visibleWhen: isWorkOrdersVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    // DOKUMA İŞİ (2026-09-13, ekran dilimi): backend `weaving-order.routes`
    // `requireDokumaEnabled` taşır; karo aynı bayrağa bağlı — referans profilde
    // KAPALI, karo çizilmez. Yüklem SAF modülden DOĞRUDAN geçirilir (palet
    // kimlik testi `toBe`).
    key: "weaving-orders",
    title: TERIM.dokumaIsEmri.cogul,
    description: "Ne dokunacak, ne kadar, kimde — dokuma iş emri planlama; koşum ve top indirme tabletten",
    icon: Spool,
    to: "/operations/weaving-orders",
    group: "production",
    permission: "weavingorder:read",
    visibleWhen: isWeavingOrdersVisible,
    offHint: flagOffHint("dokumaEnabled"),
  },
  {
    // TEZGÂH YÜKÜ (SY-3 L2): salt okuma; backend `/api/weaving-orders/loom-load` `requireDokumaEnabled` +
    // `weavingorder:read` — karo dokuma işleriyle aynı yüklem ve izin (route `ProtectedRoute` ile birebir).
    key: "loom-load",
    title: "Tezgâh Yükü",
    description: "Hangi tezgâh ne zamana kadar dolu: iş sırası, kalan metre, tahmini süre, boşalma zamanı",
    icon: CalendarClock,
    to: "/operations/loom-load",
    group: "production",
    permission: "weavingorder:read",
    visibleWhen: isWeavingOrdersVisible,
    offHint: flagOffHint("dokumaEnabled"),
  },
  {
    // TEZGAH / MAKİNE DURUŞLARI (2026-09-14 Faz 1b; D4-A3 rejim): backend `requireMachineStopRegime`
    // (dokuma ∨ üretim ∧ `uretim.makineDurusTakibi`); karo aynı rejim alanına bağlı. İki izinden BİRİ açar
    // (route `requireAnyPermission` ile birebir); eylemler ekran içinde izinle. Dokumasız rejimde ad "Makine Duruşları".
    key: "machine-stops",
    title: "Tezgah Duruşları",
    titleWhen: machineStopsTitle,
    description: "Sebep bekleyen duruşlar, sebep atama ve yeniden sınıflandırma, elle duruş girişi",
    icon: AlertOctagon,
    to: "/operations/machine-stops",
    group: "production",
    permissionAny: ["loom:manual-entry", "loom:classify"],
    visibleWhen: isMachineStopsVisible,
    offHint: `${flagOffHint("dokumaEnabled")} · ya da ${flagSettingTrail("machineStopTrackingEnabled")}`,
  },
  {
    // TEZGAH SALONU (canlı ekran): backend `/api/loom-floor` `requireTezgahEnabled` +
    // `loom:live-view`; karo aynı bayrak ve izinle (route `ProtectedRoute` ile birebir).
    key: "weaving-floor",
    title: "Tezgah Salonu",
    description: "Holdeki tezgahlar canlı: çalışan, duran, hedef süreyi aşan duruşlar; tam ekran / TV kipi",
    icon: MonitorPlay,
    to: "/operations/weaving-floor",
    group: "production",
    permission: "loom:live-view",
    visibleWhen: isWeavingFloorVisible,
    offHint: flagOffHint("tezgahEnabled"),
  },
  {
    // TEZGAH ALARMLARI: backend `/api/loom-alarms` `requireTezgahEnabled` + alarm bayrağı +
    // `loom:alarm-view`; karo modül bayrağı ve izinle (route `ProtectedRoute` ile birebir).
    key: "loom-alarms", title: TERIM_AD.tezgahAlarmlari, icon: Siren, to: "/operations/loom-alarms", group: "production",
    description: "Hedef süreyi aşan duruşlar: üstlen, sustur, not düş; aktif ve geçmiş alarmlar",
    permission: "loom:alarm-view", visibleWhen: isLoomAlarmsVisible, offHint: flagOffHint("tezgahEnabled"),
  },
  {
    // LEVENTLER (2026-09-14, devere Faz 1b): backend `warp-beam.routes` `requireDevereEnabled`
    // taşır; karo aynı bayrağa bağlı (ETKİN değer: devere → iplik → ticaret). Referans
    // profilde KAPALI, karo çizilmez. Yüklem SAF (palet kimlik testi `toBe`).
    key: "warp-beams",
    title: "Leventler",
    description: "Levent planla, sar (iplik brüt çıkar, dip ayrı döner), hazır levent stoğu",
    icon: Layers,
    to: "/operations/warp-beams",
    group: "production",
    permission: "warpbeam:read",
    visibleWhen: isWarpBeamsVisible,
    offHint: flagOffHint("devereEnabled"),
  },
  {
    key: "kartela",
    title: "Kartela Takibi",
    description: "Kartela fason sevkleri ve dönen kartelalar",
    icon: SwatchBook,
    to: "/operations/kartela",
    group: "production",
    permission: "kartela:read",
  },
  {
    // Eski "Kurşun Sırası" + "Kurşun Dağıtım" tek ekranda birleşti (2026-08-05).
    // İkisi de AYNI iş emirlerini gösteriyordu; bayrak yeni açıldığında ikisi
    // birden menüde çıkıyor ve planlamacı aynı işi iki listede arıyordu.
    key: "kursun-dagitim",
    title: TERIM_AD.kursunPlanlama,
    description: "Kurşun sırasını düzenle; dağıtım açıkken fiziksel makinelere dağıt",
    icon: Share2,
    to: "/operations/kursun-dagitim",
    group: "production",
    // Route ile hizalı: kaliteci sırayı yönetir, dağıtımcı makineye verir —
    // ikisi de aynı ekranı kullanır.
    permissionAny: ["quality:write", "workorder:distribute"],
    // ⚠️ İKİ FARKLI BAYRAK, KARIŞTIRMA: ekran hâlâ
    // `production.kursunBypassEnabled`ten BAĞIMSIZ (o bayrak yalnız ekranın
    // İÇİNDEKİ dağıtım kontrollerini açar/kapatır). Buradaki kapı MODÜL
    // anahtarı `production.enabled` — backend ikizi `kursun-bypass.routes`
    // üzerindeki `requireProductionEnabled` (2026-09-03).
    visibleWhen: isKursunPlanningVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    // H4 (2026-10-29): kurşun çıkış metresi sapmaları + ofis onayı. Okuma ve onay aynı izin.
    key: "kursun-sapmalar",
    title: "Metre Sapmaları",
    description: "Kurşun çıkış metresi girişten eşik üstü saptığında: liste, özet, ofis onayı",
    icon: Ruler,
    to: "/operations/kursun-sapmalar",
    group: "production",
    permission: "kursun:meter-approve",
    visibleWhen: isMeterDeviationsVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    // F10 (2026-11-08): firmalar arası açık fason sevkleri, termin/gecikme. İzin route ve backend ile birebir; fason
    // modül bayrağı henüz yok (`planlanan:fason`) ⇒ karo bayraksız.
    key: "fason-kokpiti",
    title: "Fason Kokpiti",
    description: "Fasondaki açık sevkler: termin, gecikme, fasonda kalan metre",
    icon: Gauge,
    to: "/operations/fason-kokpiti",
    group: "production",
    permissionAny: ["subcontractor:read", "workorder:read"],
  },
];
