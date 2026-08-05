import { arrayMove } from "@dnd-kit/sortable";

/** Sıralanabilir satırın ihtiyaç duyulan MİNİMUM şekli. */
export interface ReorderableRow {
  workOrderStepId: string;
  isUrgent: boolean;
}

export interface QueueReorderResult<T> {
  /** Ekranda gösterilecek YENİ liste (iyimser güncelleme). */
  next: T[];
  /** Backend'e gidecek priority payload'ı (acil satırlar HARİÇ; boş olabilir). */
  payload: { id: string; priority: number }[];
}

/**
 * Sürüklenen satırı yeni yerine taşır ve `priority`'yi liste index'inden üretir.
 *
 * İKİ LİSTE PAYLAŞIR (2026-08-05): bekleyen kuyruk ve MAKİNE İÇİ sıra. İkisi de
 * `WorkOrderStep.priority` yazar, ikisi de aynı uca gider
 * (`PATCH /kursun-qc/queue/reorder`) — çünkü bir adım aynı anda ya bekleyendir ya
 * bir makinededir; kümeler birbirini dışlar ve yeniden numaralama yalnız kendi
 * kümesine dokunur. Jenerik olmasının sebebi budur: iki satır tipi de yalnız
 * `workOrderStepId` + `isUrgent` taşır, gerisi çağıranın tipinde kalır.
 *
 * **KAPSAM = TEK GRUP.** Makine grupları AYRI listelerdir; bir gruptaki sürükleme
 * yalnız o grubun satırlarını numaralar. Makineler arası taşıma bu fonksiyonun
 * işi DEĞİLDİR — o bir yeniden ATAMA'dır (kaldır → tekrar ata) ve kazara
 * sürüklemeyle yapılmamalıdır.
 *
 * Acil (isUrgent) satırlar payload'a GİRMEZ: backend onları listenin başına
 * pinler (sıralama önce `isUrgent`), priority'leri anlamsızdır ve yazılırsa
 * acillik kalkınca satır beklenmedik bir yere düşer.
 *
 * Taşınamayan durumlar (aynı hücre, listede olmayan id) `null` döner — çağıran
 * hiçbir şey yapmaz.
 */
export function reorderRows<T extends ReorderableRow>(
  items: T[],
  activeId: string,
  overId: string,
): QueueReorderResult<T> | null {
  if (activeId === overId) return null;

  const oldIdx = items.findIndex((i) => i.workOrderStepId === activeId);
  const newIdx = items.findIndex((i) => i.workOrderStepId === overId);
  if (oldIdx < 0 || newIdx < 0) return null;

  const next = arrayMove(items, oldIdx, newIdx);
  const payload = next
    .filter((i) => !i.isUrgent)
    .map((i, idx) => ({ id: i.workOrderStepId, priority: idx * 10 }));

  return { next, payload };
}

/**
 * Bir MAKİNENİN yeni sırasını, dağıtılmışların DÜZ listesine geri örer.
 *
 * Dağıtılmışlar ekranda makineye göre gruplanır ama state düz bir dizidir ve
 * gruplama o dizideki GÖRELİ SIRAYI korur. Bu yüzden yeni sıra, o makinenin
 * satırlarının BULUNDUĞU SLOTLARA sırayla yerleştirilir: diğer makinelerin
 * satırları hem yerinde kalır hem de GRUPLARIN ekrandaki sırası değişmez.
 *
 * Naif alternatifler sessizce yanlıştır: satırları sona eklemek ya da diziyi
 * `machineId`'ye göre yeniden sıralamak, planlamacı tek bir makinenin içini
 * düzenlerken bütün makine kartlarının yerini oynatırdı.
 *
 * `nextGroupRows` o makinenin TÜM satırlarını taşımalıdır — `reorderRows` her
 * zaman öyle döner, yani eksik gelmesi ULAŞILAMAZ bir daldır. Yine de savunmacı
 * davranış seçilmiştir: kuyruk tükenirse slot ESKİ satırıyla dolar (satır SAYISI
 * korunur, içerik tekrarlanabilir). Alternatif — eksik slotu düşürmek — iyimser
 * state'ten bir işi yok eder ve sunucu yanıtı gelene kadar operatör onu göremez;
 * tekrarlanan satır en azından GÖRÜNÜR bir tutarsızlıktır.
 */
export function applyGroupOrder<T extends { machineId: string }>(
  all: T[],
  machineId: string,
  nextGroupRows: T[],
): T[] {
  const queue = [...nextGroupRows];
  return all.map((row) => (row.machineId === machineId ? (queue.shift() ?? row) : row));
}
