// =============================================================================
// CANLI KG BAKİYESİ (tek kalem × tek depo)
// =============================================================================
// NEDEN AYRI DOSYA: aynı soruyu İKİ yüzey soruyor — hareket diyaloğu ("ne
// yazıyorum, üstüne ne geliyor") ve hareket dökümü panelinin başlığı. İkisi de
// kendi sorgusunu kursaydı react-query ANAHTARLARI kaçınılmaz olarak ayrışırdı
// ve `invalidateQueries(["yarn"])` birini tazeleyip diğerini bayat bırakırdı.
// Anahtar TEK YERDE yaşasın diye hook burada.
//
// ⚠️ DÖKÜM PANELİ NEDEN LİSTE SATIRINA GÜVENEMEZ: panel, bakiye listesinden
// alınan bir SNAPSHOT ile açılıyor. Kullanıcı panelin içinden hareket yazınca
// defter satırı hemen görünür ama snapshot'taki bakiye ESKİ kalır — ekranın bir
// yarısı yeni, diğer yarısı eski olur ("+100 kg yazdım, bakiye değişmedi").
// Listeden tazelemek de yetmez: liste BAKİYEYE göre sıralı ve sayfalı, yani
// hareketten sonra satır pekâlâ BAŞKA BİR SAYFAYA taşınır ve o sayfada
// bulunamaz. Doğru cevap tek kalem/depo için doğrudan sormaktır.
//
// ⚠️ "BİLMİYORUM" ile "SIFIR" AYRI DURUMLARDIR (`resolved`). Sorgu henüz
// dönmediyse ya da düştüyse bakiye hakkında hiçbir şey iddia edilemez; 0 kabul
// etmek "bu işlem bakiyeyi eksiye düşürür" gibi DOĞRULUĞU BİLİNMEYEN bir uyarı
// bastırırdı. Bakiye satırı gerçekten yoksa (kalem bu depoda hiç hareket
// görmemişse) `resolved` true + `balanceKg` null olur — bu bilinen bir cevaptır.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { listYarnStocks, type DecimalLike } from "./service";

export interface YarnBalanceState {
  /** Canlı bakiye. `null` = bakiye satırı YOK (ilk hareketle doğar) ya da henüz bilinmiyor — ayrımı `resolved` söyler. */
  balanceKg: DecimalLike | null;
  /** Sorgu koştu ve CEVAP VERDİ mi. `false` iken bakiye hakkında iddiada bulunma. */
  resolved: boolean;
  isLoading: boolean;
  isError: boolean;
}

export function useYarnBalance(
  itemId: string | null | undefined,
  warehouseId: string | null | undefined,
): YarnBalanceState {
  const enabled = Boolean(itemId && warehouseId);

  const q = useQuery({
    // ⚠️ Anahtar `["yarn", ...]` ile BAŞLAR: hareket yazıldıktan sonraki
    // `invalidateQueries({ queryKey: ["yarn"] })` bunu da kapsasın diye.
    queryKey: ["yarn", "stocks", "single", itemId ?? "", warehouseId ?? ""],
    queryFn: () =>
      listYarnStocks({
        page: 1,
        pageSize: 1,
        itemId: itemId ?? undefined,
        warehouseId: warehouseId ?? undefined,
        // ⚠️ `onlyNonZero` GÖNDERİLMEZ: burada sıfır bakiye de aranan cevaptır.
      }),
    enabled,
    staleTime: 0,
  });

  return {
    balanceKg: q.data?.data[0]?.balanceKg ?? null,
    resolved: enabled && q.isSuccess,
    isLoading: enabled && q.isLoading,
    isError: q.isError,
  };
}
