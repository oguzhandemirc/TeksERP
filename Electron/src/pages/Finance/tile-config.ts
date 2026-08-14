// =============================================================================
// MUHASEBE HUB KAROLARI
// =============================================================================
// ⚠️ KARO ile ROUTE AYNI izin listesini taşımalı (`content-routes` aynası).
// Ayrışırsa kullanıcı kartı görür, tıklar ve `/forbidden`'a düşer — bu proje
// bunu bir kez yaşadı (AccountingDispatch sapması).
//
// ⚠️ Menü satırının kendisi ayrıca `financeEnabled` bayrağına bağlıdır
// (`nav-config`): bayrak kapalı bir kurulumda bu karoların hiçbiri çizilmez,
// izin taşıyan kullanıcıda bile. Bayrak REJİM, izin KİŞİ kapısıdır.
// =============================================================================
import {
  Users,
  FileText,
  Wallet,
  Landmark,
  ArrowRightLeft,
  ScrollText,
  Link2,
  Lock,
  Receipt,
  type LucideIcon,
} from "lucide-react";

export interface FinanceTile {
  key: string;
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  tone: string;
  /** Bu izinlerden HERHANGİ biri yeterli. */
  permissionAny: string[];
}

export const financeTiles: FinanceTile[] = [
  {
    key: "cari",
    title: "Cari Hesaplar",
    description: "Müşteri ve fason firmaların bakiyeleri, ekstre, vade ve risk limiti.",
    to: "/finance/cari",
    icon: Users,
    tone: "text-info",
    permissionAny: ["finance:read"],
  },
  {
    key: "invoices",
    title: "Faturalar",
    description: "Satış/alış faturaları ve iadeleri — taslak hazırla, onayla, gerekirse storno et.",
    to: "/finance/invoices",
    icon: FileText,
    tone: "text-primary",
    permissionAny: ["finance:read"],
  },
  {
    key: "payments",
    title: "Tahsilat / Ödeme",
    description: "Kasa ve bankadan yapılan tahsilat ile ödemeler; iptali ters kayıtla yapılır.",
    to: "/finance/payments",
    icon: ArrowRightLeft,
    tone: "text-success",
    permissionAny: ["finance:read"],
  },
  {
    key: "accounts",
    title: "Kasa & Banka",
    description: "Kasa ve banka hesapları — her biri TEK para birimlidir; bakiye hareketten türetilir.",
    to: "/finance/accounts",
    icon: Wallet,
    tone: "text-station-depo",
    permissionAny: ["finance:read"],
  },
  {
    // ⚠️ Tahsilat/Ödeme'nin İKİZİ DEĞİL: orası CARİ hareketidir (cari defterine
    // de yazar), burası kasanın KENDİ defteri — carisi olmayan masraf/gelir,
    // hesaplar arası virman ve açılış. Ayrı karo, ayrı ekran (backend'de de
    // ayrı tablo/servis).
    key: "cash-transactions",
    title: "Kasa Hareketleri",
    description: "Carisiz masraf ve gelir fişleri, hesaplar arası virman, açılış bakiyesi.",
    to: "/finance/cash-transactions",
    icon: Receipt,
    tone: "text-success",
    permissionAny: ["finance:read"],
  },
  // ── Paket C (2026-08-14) ──────────────────────────────────────────────────
  // ⚠️ ÜÇÜNÜN DE `permissionAny` LİSTESİ `content-routes` İLE BİREBİR AYNI
  // (`finance:read`). Görüntüleme kapısı okumadır; yazma yetkileri
  // (`finance:cheque` · `finance:payment` · `finance:close`) sayfaların İÇİNDE
  // `PermissionGate` ile ayrılır. Route'a yazma iznini koymak, kayıtları
  // GÖRMESİ gereken kişiyi ekrandan tamamen dışarıda bırakırdı.
  {
    key: "cheques",
    title: "Çek / Senet",
    description: "Portföydeki çek ve senetler — giriş, bankaya verme, tahsil, ciro, karşılıksız, iade.",
    to: "/finance/cheques",
    icon: ScrollText,
    tone: "text-station-fason",
    permissionAny: ["finance:read"],
  },
  {
    key: "allocations",
    title: "Fatura Kapama",
    description: "Tahsilat/çek ile faturayı eşleştir — hangi fatura hâlâ açık.",
    to: "/finance/allocations",
    icon: Link2,
    tone: "text-primary",
    permissionAny: ["finance:read"],
  },
  {
    key: "period-close",
    title: "Dönem Kapanışı",
    description: "Geçmiş dönemi mühürle — kapalı döneme fatura, tahsilat ve çek girilemez.",
    to: "/finance/period-close",
    icon: Lock,
    tone: "text-station-depo",
    permissionAny: ["finance:read"],
  },
  {
    key: "rates",
    title: "Kurlar",
    description: "Günlük döviz kurları. Kur girilmemiş bir günde döviz faturası kesilemez.",
    to: "/finance/rates",
    icon: Landmark,
    tone: "text-station-fason",
    permissionAny: ["finance:read"],
  },
];
