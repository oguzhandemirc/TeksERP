// =============================================================================
// DEMO SENARYO ÜRETİCİLERİ
// =============================================================================
// Sahada denenmesi ZOR olan ekranları tek tıkla oynanabilir hâle getirir:
// "Yeniden Etiketle" bir topun ÖNCE etiketlenmiş SONRA değişmiş olmasını ister;
// bunu elle kurmak için baskı alıp sonra spec düzenlemek gerekir. Demoyu gezen
// kişi bunu bilmez ve ekranı "çalışmıyor" diye okur.
//
// ⚠️ HAM `prisma.create` YOK — senaryolar GERÇEK SERVİS YOLLARINI sürer.
// Gerekçe: ham insert, guard'ları/denormları/audit'i atlar ve "demoda çalışıyor,
// sahada patlıyor" sınıfını doğurur. Demo verisi de gerçek kapılardan geçmiş
// olmalı; geçemiyorsa bu bir BULGUdur, gizlenecek bir şey değil.
//
// ⚠️ Her senaryo denetim izi bırakır (`DEMO_SCENARIO` audit olayı) — demoda
// üretilmiş bir kaydın sonradan "bu nereden geldi" sorusuna cevabı olsun.
//
// ⚠️ REJİM KAPISI BURADA DEĞİL, ROUTE'TA (`requireDemoMode`). Servis katmanına
// koymak, dahili çağıranları da (seed) kapının arkasına iterdi — F221 deseninin
// aynısı: enforcement çağrı yüzeyinde yaşar.
// =============================================================================
import { RollStatus } from "@prisma/client";
import { matchesPermission } from "../middlewares/rbac.middleware";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { LabelService } from "./label.service";
import { InventoryService } from "./inventory.service";

/** Senaryo künyesi — panel listeyi BURADAN kurar, kendi kopyasını tutmaz. */
export interface DemoScenario {
  code: string;
  title: string;
  /** Hangi ekranda işe yarar (panel gruplaması). */
  screen: string;
  description: string;
  /** Simüle ettiği GERÇEK işin izni — uç bunu da arar. */
  permissions: string[];
}

/**
 * TEK KAYNAK. Electron ayna liste TUTMAZ (`GET /api/demo/scenarios` okur) —
 * ayna tutulsaydı yeni senaryo eklendiğinde panel onu göremez ve "drift"
 * sınıfı doğardı (mobil `permissions.ts` dersinin ikizi).
 */
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    code: "RELABEL_STALE",
    title: "Etiketi basılmış + sonradan değişmiş bir top hazırla",
    screen: "Envanter → top detayı → Etiket",
    description:
      "Seçilen (ya da uygun bulunan) topun etiketini BASILMIŞ olarak damgalar, sonra metrajını bir tık değiştirir. " +
      "Sonuç: top hem 'son basıldığı yer' bandını hem sarı 'etiket güncel değil' rozetini taşır — 'Yeniden Etiketle' akışı denenebilir hâle gelir.",
    permissions: ["label:print", "roll:manual-adjust"],
  },
];

/** Senaryonun dokunduğu topun TAM durumu — yamaya değil, tam duruma yazıyoruz. */
const SENARYO_SELECT = {
  id: true,
  barcode: true,
  status: true,
  currentQty: true,
  colorId: true,
  labelDirty: true,
  labelPrintedAt: true,
  properties: { select: { propertyId: true, valueId: true } },
} as const;

export class DemoService {
  private readonly labels = new LabelService();
  private readonly inventory = new InventoryService();

  /** Panel bu listeyi çizer; `allowed` kullanıcının izinlerine göre hesaplanır. */
  listScenarios(userPermissions: string[]): Array<DemoScenario & { allowed: boolean }> {
    // ⚠️ `matchesPermission` — düz `includes` süperadminin `["*"]`ini tanımaz ve
    // ekran "yetkin yok" derken uç ÇALIŞIR (gösterim/kapı ayrışması).
    // `admin:*` dalı KORUNUR (bugünkü kısayol).
    const yetkili = (kodlar: string[]): boolean =>
      matchesPermission(userPermissions, "admin:*") ||
      kodlar.every((k) => matchesPermission(userPermissions, k));
    return DEMO_SCENARIOS.map((s) => ({ ...s, allowed: yetkili(s.permissions) }));
  }

  /**
   * "Yeniden Etiketle" senaryosu.
   *
   * ⚠️ TOP SEÇİMİ DAR: yalnız barkodlu ve fiziksel olarak elde duran top
   * (`WAREHOUSE`/`A1_STOCK`/`STOCK`). Sevk edilmiş/iptal/fasondaki topa
   * dokunmak, demoda bile defteri yalanlardı.
   */
  async relabelStale(rollId: string | undefined, userId?: string): Promise<{
    rollId: string;
    barcode: string | null;
    oncekiMetraj: number;
    yeniMetraj: number;
    /** Top zaten hazırdı — hiçbir şey değiştirilmedi. */
    zatenHazir: boolean;
  }> {
    const uygunStatus: RollStatus[] = [RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.STOCK];
    const roll = rollId
      ? await prisma.roll.findUnique({
          where: { id: rollId },
          select: SENARYO_SELECT,
        })
      : await prisma.roll.findFirst({
          where: { status: { in: uygunStatus }, barcode: { not: null }, currentQty: { gt: 1 } },
          orderBy: { updatedAt: "desc" },
          select: SENARYO_SELECT,
        });

    if (!roll) {
      throw AppError.badRequest(
        "Senaryo için uygun top bulunamadı (barkodlu, depoda/stokta ve metrajı 1'den büyük bir top gerekiyor).",
      );
    }
    if (!uygunStatus.includes(roll.status)) {
      throw AppError.badRequest(
        `Bu top "${roll.status}" durumunda — senaryo yalnız depoda/stokta duran topla çalışır.`,
      );
    }

    // ⚠️ TEKRAR TIKLAMA ZARARSIZ OLMALI: senaryo metrajı 1 m düşürüyor ve demoyu
    // gezen kişi düğmeye defalarca basar. Kapı olmasaydı her tık topu 1 m
    // eritirdi (20 tık = 20 m kayıp) — demo yardımcısı veriyi bozan bir araca
    // dönerdi. Top zaten hedef durumdaysa DOKUNMADAN "hazır" denir.
    if (roll.labelPrintedAt != null && roll.labelDirty) {
      return {
        rollId: roll.id,
        barcode: roll.barcode,
        oncekiMetraj: Number(roll.currentQty),
        yeniMetraj: Number(roll.currentQty),
        zatenHazir: true,
      };
    }

    // ① Etiket BASILDI damgası — `labelPrintedAt` + `lastLabelSnapshot` yazan TEK nokta.
    await this.labels.recordPrintEvent(roll.id, userId);

    // ② Küçük bir spec değişikliği → `labelDirty = true` (fiziksel etiket artık uyuşmuyor).
    //    Metraj 1 m düşürülür: en görünür ve en zararsız alan.
    const oncekiMetraj = Number(roll.currentQty);
    const yeniMetraj = Math.max(1, Math.round((oncekiMetraj - 1) * 100) / 100);
    // ⚠️ RENK VE ÖZELLİKLER AYNEN GERİ VERİLİR — `applyManualProperties` bir
    // YAMA değil, TAM DURUM yazar: `colorId: null` geçmek topun rengini SİLER
    // (`colorChanged = roll.colorId !== data.colorId`). Demo senaryosunun bitmiş
    // bir topu renksiz bırakması, tam da düzeltilmek istenen kusuru ÜRETİRDİ.
    // Değişen TEK alan metrajdır; bayatlığı doğuran da odur.
    await this.inventory.applyManualProperties(
      roll.id,
      {
        colorId: roll.colorId,
        // Yalnız BAYRAK (değersiz) satırlar geri yazılır — replace zaten yalnız
        // onlara dokunur; SEÇİM satırları operatör verisidir ve silinmemeli.
        propertyIds: roll.properties.filter((x) => x.valueId == null).map((x) => x.propertyId),
        currentQty: yeniMetraj,
        reason: "Demo senaryosu — etiket bayatlatma",
      },
      userId,
    );

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        event: "DEMO_SCENARIO",
        scenario: "RELABEL_STALE",
        oncekiMetraj,
        yeniMetraj,
      },
    });

    return { rollId: roll.id, barcode: roll.barcode, oncekiMetraj, yeniMetraj, zatenHazir: false };
  }
}

export const demoService = new DemoService();
