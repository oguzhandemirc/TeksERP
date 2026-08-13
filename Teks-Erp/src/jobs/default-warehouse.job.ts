// =============================================================================
// VARSAYILAN DEPO — boot-time uzlaştırması
// =============================================================================
// NEDEN MIGRATION DEĞİL: migration'a INSERT gömmek uuid'yi ve adı TAŞA yazar;
// taze kurulumun seed'iyle çatallanır, geri alınamaz ve her ortamda (fabrika,
// ticaret, dev, CI) aynı satırın iki farklı kopyası doğabilir. İzin kataloğu
// uzlaştırmasıyla aynı gerekçe ve aynı kalıp: KODU DEPLOY ETMEK = SATIRI GETİRMEK.
//
// NEDEN LAZY (ilk kullanımda yarat) DEĞİL: depo çözümü `roll.create` sıcak
// yolundan çağrılıyor; oraya "yoksa yarat" koymak rastgele bir kullanıcının
// transaction'ı içinde master-data doğurmak demekti (audit atfı belirsiz,
// eşzamanlı iki giriş yarışır).
//
// SÖZLEŞME:
//   • Varsayılan depo VARSA hiçbir şey yapılmaz.
//   • Depo(lar) var ama hiçbiri varsayılan DEĞİLSE → EN ESKİSİ varsayılan yapılır
//     (yeni bir depo doğurmak yerine). Varsayılansız durumda her top deposuz
//     yazılırdı; sessizce ikinci bir "Merkez Depo" yaratmak ise envanteri ikiye
//     bölerdi.
//   • Hiç depo yoksa → "Merkez Depo" (DP-MERKEZ) doğar.
// Best-effort: hata sunucuyu DÜŞÜRMEZ ama sessizce de yutulmaz.
// =============================================================================
import prisma from "../lib/prisma";
import { DEFAULT_WAREHOUSE_CODE, DEFAULT_WAREHOUSE_NAME } from "../services/helpers/warehouse.helper";
import { p2002Mentions } from "../utils/p2002";

export type DefaultWarehouseResult = {
  action: "exists" | "promoted" | "created";
  id: string;
  name: string;
};

/**
 * Varsayılan deponun varlığını garanti eder. İdempotenttir; iki boot yarışsa bile
 * `warehouses_isDefault_key` partial unique'i ikinciyi bloklar ve sonuç "exists"e döner.
 */
export async function ensureDefaultWarehouse(): Promise<DefaultWarehouseResult> {
  const existing = await prisma.warehouse.findFirst({
    where: { isDefault: true },
    select: { id: true, name: true },
  });
  if (existing) return { action: "exists", id: existing.id, name: existing.name };

  // Depo var ama varsayılan işaretlenmemiş → en eskisini terfi ettir.
  const oldest = await prisma.warehouse.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (oldest) {
    await prisma.warehouse.update({ where: { id: oldest.id }, data: { isDefault: true } });
    console.warn(
      `[warehouse] Varsayılan depo işaretli değildi — en eski depo ("${oldest.name}") varsayılan yapıldı.`,
    );
    return { action: "promoted", id: oldest.id, name: oldest.name };
  }

  try {
    const created = await prisma.warehouse.create({
      data: { code: DEFAULT_WAREHOUSE_CODE, name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
      select: { id: true, name: true },
    });
    console.log(`[warehouse] Varsayılan depo oluşturuldu: ${created.name} (${DEFAULT_WAREHOUSE_CODE})`);
    return { action: "created", id: created.id, name: created.name };
  } catch (err) {
    // Yarış: başka bir süreç aynı anda yarattı (kod unique VEYA isDefault partial
    // unique çarptı) → onun yarattığını oku, hata değil.
    if (p2002Mentions(err, /warehouses_(code_key|isDefault_key)/)) {
      const now = await prisma.warehouse.findFirst({
        where: { isDefault: true },
        select: { id: true, name: true },
      });
      if (now) return { action: "exists", id: now.id, name: now.name };
    }
    throw err;
  }
}

const STARTUP_DELAY_MS = 5 * 1000;

let started = false;

/** Açılışta BİR KEZ koşar (izin kataloğu uzlaştırmasıyla aynı kalıp). */
export function startDefaultWarehouseReconciler(): void {
  if (started) return;
  started = true;

  setTimeout(() => {
    void ensureDefaultWarehouse().catch((err) => {
      // Buraya düşmek = yeni topların `warehouseId`'si NULL doğacak demektir.
      // Veri kaybı değil (geri doldurulabilir) ama sessiz kalmamalı.
      console.error(
        "[warehouse] VARSAYILAN DEPO UZLAŞTIRMASI BAŞARISIZ — yeni toplar deposuz yazılabilir. " +
          "Tanımlar → Depolar'dan elle bir depo açıp varsayılan yapın.",
        err,
      );
    });
  }, STARTUP_DELAY_MS).unref();
}
