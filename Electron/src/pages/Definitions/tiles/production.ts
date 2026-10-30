// Tanımlar › Üretim & Kalite karoları (sıra = hub sırası).
import { Factory, Route as RouteIcon, FlaskConical, AlertTriangle, Bookmark, Undo2, Warehouse, Printer, Ruler, MessageSquareText, Clock3, BellRing, Cpu, Binary } from "lucide-react";
import { isProductRecipesVisible, isRoutesVisible } from "../production-regime";
import { isShiftDefinitionsVisible } from "@/pages/ShiftDefinitions/shift-regime";
import { isLoomAlarmDutyVisible } from "@/pages/LoomAlarmDuty/duty-regime";
import { isMachineCollectorsVisible } from "@/pages/MachineCollectors/collector-model";
import { isMachineStopCodeMapsVisible } from "@/pages/MachineStopCodeMaps/code-map-model";
import { TERIM, TERIM_AD } from "@/lib/terim";
import { flagOffHint, flagSettingTrail } from "@/lib/flag-setting-path";
import type { DefinitionTile } from "../tile-config";

export const productionTiles: DefinitionTile[] = [
  {
    key: "return-reasons",
    title: "İade Nedenleri",
    description: "Müşteri iadesi neden kataloğu",
    icon: Undo2,
    to: "/definitions/return-reasons",
    // Ürün niteliği değil, kalite/iade olay kodu — Hata Tipleri ile aynı grupta.
    group: "production",
    permission: "return:read",
  },
  {
    key: "warehouses",
    title: "Depolar",
    description: "Fiziksel depo tanımları + varsayılan depo",
    icon: Warehouse,
    to: "/definitions/warehouses",
    group: "production",
    // ⚠️ İzin route ile BİREBİR (`content-routes.tsx`): ayrışırsa kart görünür,
    // tıklayınca /forbidden'a düşer.
    permission: "warehouse:read",
  },
  {
    key: "stations",
    title: "Üretim İstasyonları",
    description: "İstasyonlar + makineleri + (fason) renk/özellik yetenekleri — tek yerde, bilgi",
    icon: Factory,
    to: "/definitions/stations",
    group: "production",
    permission: "station:read",
  },
  {
    key: "shift-definitions",
    title: "Vardiya Tanımları",
    description: "Vardiya kataloğu — başlangıç saati, süre, planlı mola, çalışılan günler; takvim etkisi önizlemeli",
    icon: Clock3,
    to: "/definitions/shift-definitions",
    group: "production",
    permission: "loom:spec-manage",
    visibleWhen: isShiftDefinitionsVisible,
    offHint: `${flagOffHint("dokumaEnabled")} · ya da ${flagSettingTrail("machineStopTrackingEnabled")}`,
  },
  {
    key: "loom-alarm-duty",
    title: "Alarm Sorumluları",
    description: "Tezgah alarmı kime bildirilir — hol × vardiya sorumlusu, nöbet değişikliği, kademe kuralı",
    icon: BellRing,
    to: "/definitions/loom-alarm-duty",
    group: "production",
    permission: "loom:spec-manage",
    visibleWhen: isLoomAlarmDutyVisible,
    offHint: flagOffHint("tezgahEnabled"),
  },
  {
    key: "machine-collectors",
    title: TERIM_AD.makineVeriToplayicilari,
    description: "Tezgaha takılan kartların kaydı — bağlı tezgahlar, kart tipi, sır yenileme, iptal",
    icon: Cpu,
    to: "/definitions/machine-collectors",
    group: "production",
    permission: "loom:spec-manage",
    visibleWhen: isMachineCollectorsVisible,
    offHint: flagOffHint("tezgahEnabled"),
  },
  {
    key: "machine-stop-codes",
    title: "Duruş Kodu Eşleme",
    description: "Kartın ham duruş kodu → duruş sebebi; kart tipi geneli ya da tezgah üst-yazımı",
    icon: Binary,
    to: "/definitions/machine-stop-codes",
    group: "production",
    permission: "loom:spec-manage",
    visibleWhen: isMachineStopCodeMapsVisible,
    offHint: flagOffHint("tezgahEnabled"),
  },
  {
    key: "peripherals",
    title: "Donanım",
    description: "Yazıcı + kantar/metraj cihazları (ağ/Bluetooth/USB/seri) — tür, dil/komut, adres",
    icon: Printer,
    to: "/definitions/peripherals",
    group: "production",
    permission: "station:read",
  },
  {
    key: "routes",
    title: "Üretim Rotaları",
    description: "Şablon iş akışları ve istasyon sıraları",
    icon: RouteIcon,
    to: "/definitions/routes",
    group: "production",
    permission: "station:read",
    // Backend ikizi `route.routes` → `requireProductionEnabled`.
    visibleWhen: isRoutesVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    key: "product-recipes",
    title: `${TERIM.terbiyeIsEmri.tekil} Şablonları`,
    description: "Kumaş + renk + özellik + en + rota — hazır terbiye iş emri şablonları",
    icon: FlaskConical,
    to: "/definitions/product-recipes",
    group: "production",
    permission: "station:read",
    visibleWhen: isProductRecipesVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    // TEK KART, DÖRT SEKME — dört ayrı kart menüyü kalabalıklaştırırdı ve
    // dördü de aynı şeyin (operatöre gösterilen hazır mesaj) bağlamları.
    key: "reason-presets",
    title: "Hazır Sebepler",
    description: "Fire · kayıt düzeltmesi · elle top ekleme · iptal ekranlarındaki hazır mesajlar",
    icon: MessageSquareText,
    to: "/definitions/reason-presets",
    group: "production",
    // ⚠️ Kart ile route AYNI izni taşımalı — ayrışırsa kullanıcı kartı görür,
    // tıklar, /forbidden'a düşer. Düzenleme ayrıca `roll:manual-adjust` ister
    // ve o kontrol sayfanın İÇİNDE yapılır (tuşlar çizilmez).
    permission: "roll:read",
  },
  {
    // ÇUVAL İZLERİ (2026-09-04) — paketlemede çuvala bırakılan işaretlerin
    // kataloğu. "Depolar" ile aynı grupta: ikisi de sevkiyat/depo tarafının
    // ana verisi ve ayrı bir Tanımlar grubu açmak tek kart için menüyü bölerdi.
    // ⚠️ Karo ile route AYNI izni taşır (`content-routes.tsx` aynası);
    // düzenleme `shipping:write` ve o kontrol sayfanın İÇİNDE.
    key: "sack-tags",
    title: "Çuval İzleri",
    description: "Paketlemede çuvala bırakılan işaretler — “kontrol edilecek”, “eklenecek var”",
    icon: Bookmark,
    to: "/definitions/sack-tags",
    group: "production",
    permission: "shipping:read",
  },
  {
    key: "defect-types",
    title: "Hata Tipleri",
    description: "Kalite kontrol hata tanımları",
    icon: AlertTriangle,
    to: "/definitions/defect-types",
    group: "production",
    permission: "quality:read",
  },
  {
    // ÇÖZGÜ KARTLARI — devere modülü. `visibleWhen` ETKİN değeri okur
    // (ticaret && iplik && devere, `useOperationsVisibilityContext`te tek yerde
    // çözülür): ham değere bağlansaydı ticaret kapalı bir kurulumda karo çizilir,
    // tıklayan kullanıcı backend kapısından 403 yerdi.
    key: "warp-specs",
    title: "Çözgü Kartları",
    description: "Çözgü tanımı: tel adedi · iplik · tarak (bir kart çok deseni besler)",
    icon: Ruler,
    to: "/definitions/warp-specs",
    group: "production",
    permission: "warpspec:read",
    visibleWhen: (ctx) => ctx.devereEnabled,
    offHint: flagOffHint("devereEnabled"),
  },
];
