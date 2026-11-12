// Cari kayıt sayfası sekmeleri — görünürlük TEK yerden: kapı (rol + izin + modül) açık VE veri var.
// Boş sekme çizilmez (kullanıcı kararı): kapısı açık sekmenin listesi sayfa açılışında aynı sorgu anahtarıyla
// yoklanır; sekme içeriği o önbellekten okur (ikinci istek yok).
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { ClipboardList, FileText, History, Info, Receipt, ShoppingBag, Tags, Truck, Wallet, type LucideIcon } from "lucide-react";
import type { RecordTab } from "@/components/record/RecordPageShell";
import type { PartnerRoleFlags } from "@/lib/partnerRoles";
import { CARI_TAB_LIMIT, cariOrdersQuery, cariPricesQuery, cariShipmentsQuery } from "./CariCommerceTabs";
import { cariFasonQuery, cariPurchaseOrdersQuery, cariReceiptsQuery } from "./CariOtherTabs";
import type { CariSourceKey } from "./cari-sources";
import { cariDocumentsCount, cariDocumentsQuery } from "./cari-documents";

export const CARI_TAB_KEYS = ["genel", "siparisler", "sevkiyatlar", "hesap", "fiyatlar", "fason", "alislar", "belgeler", "gecmis"] as const;
export type CariTabKey = (typeof CARI_TAB_KEYS)[number];
export const CARI_TAB_PARAM = "sekme";

const TAB_META: Record<CariTabKey, { label: string; icon: LucideIcon }> = {
  genel: { label: "Genel", icon: Info },
  siparisler: { label: "Siparişler", icon: ClipboardList },
  sevkiyatlar: { label: "Sevkiyatlar", icon: Truck },
  hesap: { label: "Hesap hareketleri", icon: Wallet },
  fiyatlar: { label: "Fiyat listeleri", icon: Tags },
  fason: { label: "Fason", icon: Receipt },
  alislar: { label: "Alışlar", icon: ShoppingBag },
  belgeler: { label: "Belgeler", icon: FileText },
  gecmis: { label: "Geçmiş", icon: History },
};

export interface CariTabGateInput {
  roles: PartnerRoleFlags;
  access: Record<CariSourceKey, boolean>;
  hasAccount: boolean;
  subcontractorId: string | null;
}

/** Kapı: rol + izin/modül. Kapalı sekmenin verisi hiç sorgulanmaz. */
export function cariTabGates({ roles, access, hasAccount, subcontractorId }: CariTabGateInput): Record<CariTabKey, boolean> {
  return {
    genel: true,
    siparisler: roles.isCustomerRole && access.orders,
    sevkiyatlar: roles.isCustomerRole && access.shipments,
    hesap: access.finance && hasAccount,
    fiyatlar: roles.isCustomerRole && access.prices,
    fason: access.fason && Boolean(subcontractorId),
    alislar: roles.isSupplierRole && (access.purchases || access.receipts),
    // Tür başına izin + modül sunucuda; görünen tür yoksa yoklama 0 döner ve sekme çizilmez.
    belgeler: true,
    gecmis: access.history,
  };
}

/**
 * Görünür sekmeler. `rows[k]`: yoklanan satır sayısı (undefined = henüz yok/yükleniyor → gizli).
 * Genel, Hesap ve Geçmiş yoklanmaz (hesap kartın kendisi; 90 günü boş olsa da tam ekstre oradan açılır).
 * Geçmiş audit'tir: ayak izinden karar/sayı türetilmez (kök kural) — görünürlüğü yalnız izin kapısı.
 * Sayı yalnız sınırın altındaysa rozet olur (50 = "en az 50", kesin sayı değil).
 */
const UNPROBED = new Set<CariTabKey>(["genel", "hesap", "gecmis"]);

export function visibleCariTabs(gates: Record<CariTabKey, boolean>, rows: Partial<Record<CariTabKey, number>>): RecordTab[] {
  return CARI_TAB_KEYS.filter((k) => gates[k] && (UNPROBED.has(k) || (rows[k] ?? 0) > 0)).map((k) => {
    const n = rows[k];
    return { key: k, ...TAB_META[k], count: !UNPROBED.has(k) && n != null && n < CARI_TAB_LIMIT ? n : null };
  });
}

interface ProbeArgs extends CariTabGateInput {
  customerId: string;
}

/** Kapısı açık sekmelerin satır sayılarını yoklar (sekme içeriğiyle aynı sorgu anahtarı). */
export function useCariRecordTabs(args: ProbeArgs): { tabs: RecordTab[]; probing: boolean } {
  const gates = cariTabGates(args);
  const { customerId, subcontractorId, access } = args;
  const len = (d: unknown[] | undefined) => d?.length;
  const qs = useQueries({
    queries: [
      { ...cariOrdersQuery(customerId), enabled: gates.siparisler },
      { ...cariShipmentsQuery(customerId), enabled: gates.sevkiyatlar },
      { ...cariPricesQuery(customerId), enabled: gates.fiyatlar },
      { ...cariFasonQuery(subcontractorId ?? ""), enabled: gates.fason },
      { ...cariPurchaseOrdersQuery(customerId), enabled: gates.alislar && access.purchases },
      { ...cariReceiptsQuery(customerId), enabled: gates.alislar && access.receipts },
    ],
  });
  const docs = useInfiniteQuery(cariDocumentsQuery(customerId));
  const [orders, shipments, prices, fason, pos, receipts] = qs;
  const purchaseRows = len(pos!.data as unknown[]) ?? 0;
  const receiptRows = len(receipts!.data as unknown[]) ?? 0;
  const rows: Partial<Record<CariTabKey, number>> = {
    siparisler: len(orders!.data as unknown[]),
    sevkiyatlar: len(shipments!.data as unknown[]),
    fiyatlar: len(prices!.data as unknown[]),
    fason: len(fason!.data as unknown[]),
    // İki liste ayrı sayılır; rozet yalnız tek liste açıksa anlamlı — toplam rozet basılmaz.
    alislar: purchaseRows + receiptRows > 0 ? CARI_TAB_LIMIT : undefined,
    belgeler: cariDocumentsCount(docs.data?.pages[0]),
  };
  return { tabs: visibleCariTabs(gates, rows), probing: qs.some((q) => q.isLoading) || docs.isLoading };
}
