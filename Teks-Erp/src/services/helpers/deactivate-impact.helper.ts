// =============================================================================
// PASİFE ALMANIN ETKİSİ — "kumaş kayboldu" sessizliğini kır (BULGU-T2-010)
// =============================================================================
// Ana veriyi pasife almak bağımlılık kontrolsüz ve önizlemesizdi. Sahada ölçüldü
// (2026-08-31): 1 AÇIK sipariş kalemi (1.500 m) ve 2 canlı top (100'er m) PASİF
// bir kumaşa bağlı.
//
// Etkisi sessiz ve kafa karıştırıcı: iş emri formunun kumaş seçicisi
// `isActive:true` süzdüğü için o siparişe iş emri AÇILAMAZ; toplar envanterde
// SAYILIR (raporlar `items.isActive` süzmez) ama üretime alınamaz. Operatör
// "kumaş kayboldu" der ve sebep hiçbir ekranda yazmaz.
//
// ⚠️ BU KATMAN ENGELLEMİYOR, GÖRÜNÜR KILIYOR — bilinçli.
// Denetimin önerisi "409 + force:true" idi. Deploy sırası backend ÖNCE olduğu
// için panel `force` göndermeyi öğrenene kadar pasife alma İMKÂNSIZ olurdu:
// sahada bugün yapılabilen bir iş, bir sürüm boyunca yapılamaz hâle gelirdi.
// Bunun yerine sayım yanıtın MESAJINA ve audit'e giriyor; panel hiçbir
// değişiklik yapmadan uyarıyı gösteriyor (toast `message`i basar).
// Engelleme istenirse tek satır: `blocked` alanı zaten hesaplanıyor.
// =============================================================================
import prisma from "../../lib/prisma";
import { MERGE_MAP, type MergeEntity } from "../../constants/merge-map";

/** Prisma model adı → birleştirme haritasındaki varlık. */
const MODEL_TO_ENTITY: Record<string, MergeEntity> = {
  item: "item",
  customer: "customer",
  color: "color",
  subcontractor: "subcontractor",
};

export interface BagimlilikSayimi {
  label: string;
  count: number;
}

/**
 * "Canlı" süzgeci olan tablolar. Ölü satırları saymak GÜRÜLTÜ üretir ve uyarıyı
 * değersizleştirir: iptal edilmiş bir sipariş kalemi ya da hurdaya ayrılmış bir
 * top, pasife almayı sorunlu kılmaz.
 */
const CANLI_SUZGEC: Record<string, string> = {
  rolls: `status NOT IN ('CANCELLED','SCRAP','SHIPPED','SUBCONTRACTOR_CONSUMED','KARTELA_CONSUMED','TAMBUR_CONSUMED')`,
  order_lines: `"cancelledAt" IS NULL`,
  work_orders: `status NOT IN ('COMPLETED','CANCELLED','SUPERSEDED')`,
};

/**
 * Pasife alınacak kaydın CANLI bağımlılıkları. Boş dizi = etkisi yok.
 *
 * ⚠️ Sayım `MERGE_MAP`ten türer — birleştirmenin taşıdığı tablolar ile pasife
 * almanın etkilediği tablolar AYNI kümedir. İkinci bir liste tutmak, birinin
 * güncellenip diğerinin unutulması demekti.
 */
export async function countLiveDependencies(
  modelName: string,
  id: string,
): Promise<BagimlilikSayimi[]> {
  const entity = MODEL_TO_ENTITY[modelName];
  if (!entity) return [];
  const sonuc: BagimlilikSayimi[] = [];
  for (const rule of MERGE_MAP[entity]) {
    if (rule.kind !== "MOVE") continue;
    const suzgec = CANLI_SUZGEC[rule.table];
    const sql =
      `SELECT count(*)::int AS n FROM "${rule.table}" ` +
      `WHERE "${rule.column}" = $1::uuid` +
      (suzgec ? ` AND ${suzgec}` : "");
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(sql, id);
      const n = rows[0]?.n ?? 0;
      if (n > 0) sonuc.push({ label: rule.label, count: n });
    } catch {
      // Tablo/kolon yoksa sessizce atla — uyarı katmanı yazma yolunu DÜŞÜRMEZ.
    }
  }
  return sonuc;
}

/** Operatörün okuyacağı tek cümle. Boşsa null. */
export function buildDependencyWarning(sayimlar: BagimlilikSayimi[]): string | null {
  if (sayimlar.length === 0) return null;
  const liste = sayimlar.map((s) => `${s.count} ${s.label.toLocaleLowerCase("tr")}`).join(", ");
  return (
    `⚠️ Bu kayda bağlı CANLI veri var (${liste}). Pasife alındı ama ` +
    "seçicilerde artık görünmeyecek — bağlı işler devam ediyorsa yeniden aktifleştirin."
  );
}
