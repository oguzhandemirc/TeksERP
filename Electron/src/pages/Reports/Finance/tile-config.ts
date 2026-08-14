// =============================================================================
// ÖN MUHASEBE RAPORLARI — kategori karoları
// =============================================================================
// ⚠️ `to` DEĞERLERİ `routes/content-routes.tsx`'teki path'lerle BİREBİR aynı
// olmak ZORUNDA: ayrışırsa kullanıcı kartı görür, tıklar ve `/forbidden`'a ya
// da boş ekrana düşer. Aynı liste sağdaki `ReportSideRail`'i ve komut paletini
// de besler (`command-entries.reports.ts` bu diziden üretir) — yani tek yazım
// hatası üç yüzeyde birden kırılır.
//
// ⚠️ URL KALIBI `/reports/<kategori>/<rapor>` OLMALI: `ReportSideRail`
// kategoriyi path'in İKİNCİ segmentinden çözer ve iki segmentli bir adreste
// (`/reports/finance-aging`) hiç render etmez — rail sessizce kaybolur.
//
// ⚠️ Bu karolarda İZİN ALANI YOKTUR (`HubTile` taşımaz): izin filtresi kategori
// seviyesindedir (`Reports/tile-config.ts` → `permission: "report:finance"`)
// ve route'ta `ProtectedRoute` ile uygulanır.
//
// ⚠️ CARİ EKSTRE ayrı bir karo DEĞİLDİR ve bu bilinçlidir: ekstre TEK bir cari
// sorar, yani ekranın ilk işi cari seçtirmek olurdu — ama cari seçici
// `/api/finance/cari` ucunu ister ve o uç `finance:read` iznindedir. Yalnız
// `report:finance` taşıyan yönetim kullanıcısı seçicide 403 alır, ekran boş
// kalır ve sebebi hiçbir yerde yazmaz. Ekstre bu yüzden yaşlandırma satırından
// açılır (cari zaten bellidir) ve `/api/reports/finance/statement` ucunu
// çağırır.
// =============================================================================

import { ArrowLeftRight, BookOpen, CalendarClock, Hourglass, Percent } from "lucide-react";
import type { HubTile } from "../_components/ReportHubGrid";

export const financeReportTiles: HubTile[] = [
  {
    key: "aging",
    title: "Cari Yaşlandırma",
    description: "Açık bakiyenin yaşı — kimden ne kadar alacak var, ne kadar gecikmiş (kesit raporu)",
    icon: Hourglass,
    to: "/reports/finance/aging",
  },
  {
    key: "cash-book",
    title: "Kasa & Banka Defteri",
    description: "Devir, dönem hareketleri ve yürüyen bakiye — tahsilat, kasa hareketi ve çek tahsili",
    icon: BookOpen,
    to: "/reports/finance/cash-book",
  },
  {
    key: "cheque-due",
    title: "Çek Vade Takvimi",
    description: "Hangi hafta/ay ne kadar tahsilat girecek, ne kadar ödeme çıkacak — vadesi geçmişler ayrı blokta",
    icon: CalendarClock,
    to: "/reports/finance/cheque-due",
  },
  {
    key: "vat-summary",
    title: "KDV Dönem Özeti",
    description: "Satış/alış KDV'si oran kırılımlı matrah + KDV + tevkifat — beyanname değil, muhasebeciye özet",
    icon: Percent,
    to: "/reports/finance/vat-summary",
  },
  {
    key: "fx-diff",
    title: "Kur Farkı Raporu",
    description: "Dövizli kapamalarda gerçekleşen TL kur farkı — lehte/aleyhte ayrı, cari ve para birimi süzgeçli",
    icon: ArrowLeftRight,
    to: "/reports/finance/fx-diff",
  },
];
