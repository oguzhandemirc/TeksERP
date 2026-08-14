// =============================================================================
// KAPAMA KAYNAKLARI — tahsilat/ödeme ve çek/senet TEK ŞEKİLDE
// =============================================================================
// İki farklı uçtan gelen iki farklı satır şekli burada TEK bir `SourceItem`e
// indirgenir. Gerekçe: kapama açısından ikisi de aynı şeydir — "kapatmaya kalan
// parası olan bir belge". Ekranın geri kalanı (seçim, FIFO önerisinin tutarı,
// alt bandın kalan hesabı, gönderilen gövde) ayrımı bilmek zorunda kalsaydı
// aynı `kind === "CHEQUE"` dalı beş yerde tekrarlanır ve biri unutulduğunda
// ekran çekle çalışırken tahsilatla çalışmaz (ya da tersi) hâle gelirdi.
//
// ⚠️ Çekin "serbest" tutarı burada TÜRETİLİR (`amount - allocatedTotal`), çünkü
// çek tarafında `freeTotal` döndüren bir uç YOK (`unallocated-payments` yalnız
// `payments` tablosunu okur). Türetme kuruş aritmetiğiyle yapılır; otorite yine
// backend'dedir (aşımda 409).
import { useQuery } from "@tanstack/react-query";
import type { Currency } from "../service";
import { toKurus } from "./allocationMath";
import {
  listAllocatableCheques,
  listUnallocatedPayments,
  type Direction,
  type SourceKind,
} from "./service";

export interface SourceItem {
  kind: SourceKind;
  id: string;
  docNo: string;
  /** Satırın ikinci satırı — çekte banka/keşideci, tahsilatta yön. */
  subtitle: string;
  /** Tarih etiketi: tahsilatta işlem tarihi, çekte VADE (aranan bilgi odur). */
  dateLabel: string;
  amountKurus: number;
  /** Kapamaya kalan — seçildiğinde FIFO önerisi bu tutarla istenir. */
  freeKurus: number;
}

interface Params {
  cariId: string | null;
  currency: Currency;
  direction: Direction;
  kind: SourceKind;
}

const trDate = (iso: string): string => new Date(iso).toLocaleDateString("tr-TR");

export function useAllocationSources({ cariId, currency, direction, kind }: Params): {
  items: SourceItem[];
  isLoading: boolean;
  /**
   * ⚠️ İSTEK DÜŞTÜ Mü — "boş liste" ile AYNI ŞEY DEĞİLDİR ve karıştırmak bu
   * projede adı konmuş bir hata sınıfıdır (2026-08-12 saha bulgusu: FilterBar
   * hatayı yutup "Sonuç yok." gösteriyordu). Burada bedeli daha ağır: uç 403
   * verdiğinde (izin yok ya da `finance.enabled` KAPALI — kapı 403 döner) ekran
   * "bu cari ve para biriminde bağlanmamış tahsilat yok" diye KENDİNDEN EMİN ve
   * YANLIŞ bir cümle kurar. Toast görünüp kaybolur, ekrandaki yalan kalır.
   */
  isError: boolean;
} {
  const paymentsQ = useQuery({
    queryKey: ["finance", "allocations", "unallocated-payments", cariId, currency, direction],
    queryFn: () => listUnallocatedPayments({ cariId: cariId as string, currency, direction }),
    // Cari seçilmeden uç ZORUNLU `cariId` ister → istek 400 alır ve ekran açılır
    // açılmaz kırmızı bir toast basardı.
    enabled: Boolean(cariId) && kind === "PAYMENT",
  });

  const chequesQ = useQuery({
    queryKey: ["finance", "allocations", "allocatable-cheques", cariId, currency, direction],
    queryFn: () => listAllocatableCheques({ cariId: cariId as string, currency, direction }),
    enabled: Boolean(cariId) && kind === "CHEQUE",
  });

  if (kind === "PAYMENT") {
    const items: SourceItem[] = (paymentsQ.data?.data ?? []).map((p) => ({
      kind: "PAYMENT",
      id: p.id,
      docNo: p.docNo,
      subtitle: p.direction === "IN" ? "Tahsilat" : "Ödeme",
      dateLabel: trDate(p.paymentDate),
      amountKurus: toKurus(p.amount),
      freeKurus: toKurus(p.freeTotal),
    }));
    return { items, isLoading: paymentsQ.isLoading, isError: paymentsQ.isError };
  }

  const items: SourceItem[] = (chequesQ.data ?? [])
    .map((c) => {
      const amountKurus = toKurus(c.amount);
      return {
        kind: "CHEQUE" as const,
        id: c.id,
        docNo: c.docNo,
        subtitle: [
          c.docType === "CHEQUE" ? "Çek" : "Senet",
          c.bankName ?? c.drawerName ?? null,
          c.serialNo ? `No: ${c.serialNo}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        dateLabel: `Vade ${trDate(c.dueDate)}`,
        amountKurus,
        freeKurus: amountKurus - toKurus(c.allocatedTotal),
      };
    })
    // Tamamı bağlanmış çek listede DURMAZ: seçilebilir görünüp her denemede
    // "kapamaya kalan tutar 0" 409'u vermesi, kullanılabilir bir seçenekmiş gibi
    // görünmesinden daha kötüdür.
    .filter((c) => c.freeKurus > 0);

  return { items, isLoading: chequesQ.isLoading, isError: chequesQ.isError };
}
