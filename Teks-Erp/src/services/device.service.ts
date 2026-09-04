// =============================================================================
// TeksERP - Device Service (Tablet allowlist + atama)
// =============================================================================
// Eski 6-haneli PairingCode akışı KALDIRILDI. Yeni model: tablet boot'ta kendi
// kalıcı deviceId'sini `announce` eder → bilinmiyorsa PENDING kaydı açılır → admin
// "Onayla & Ata" ile APPROVED yapıp bir makineye bağlar → tablet otomatik çalışır.
// İstasyon makineden türetilir. `resolveDevice` yalnız APPROVED+aktif cihaza
// machineId döner (atıf), aksi null (bugünkü eşleşmemiş davranışı).
// =============================================================================

import prisma from "../lib/prisma";
import { DeviceKind } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { readDevicePairingRequired } from "./system-setting.service";
import { ACTOR_SELECT } from "./helpers/system-account.helper";

/**
 * Eşleşme bekleyen cihaz üst sınırı (F-CORE-GUV-003). Kimlik doğrulamasız
 * `announce` ucunun sınırsız satır açmasını engeller. Gerçekte bekleyen cihaz
 * sayısı tek hanelidir (2026-08-09 ölçümü: 9) — 200 cömert bir tavandır ve
 * meşru bir kuruluma (aynı gün onlarca tablet devreye alma) engel olmaz.
 */
const MAX_PENDING_DEVICES = 200;

/** Admin cihaz listesi okuma tavanı — tavansız `findMany` yasağı (perf kuralı 5). */
const DEVICE_LIST_LIMIT = 500;

/**
 * Toplam cihaz satırı üst sınırı — `MAX_PENDING_DEVICES`in İKİZİ, eşleştirme
 * KAPALI rejim için (2026-09-04).
 *
 * ⚠️ Neden ikinci bir tavan gerekti: bayrak kapalıyken yeni cihaz artık APPROVED
 * doğuyor (aşağıdaki gerekçe), yani PENDING sayacı hiç artmıyor ve tek başına
 * bırakılsaydı `MAX_PENDING_DEVICES` **sessizce etkisiz** kalırdı — kimlik
 * doğrulamasız `announce` ucu sınırsız satır açabilirdi. İki zarar: (1) admin
 * Cihazlar ekranı sahte kayıtlarla kullanılamaz hale gelir (tavanın asıl
 * gerekçesi), (2) bayrak sonradan AÇILDIĞINDA o satırlar "onaylı" sayılır.
 * Tavan bilinçli olarak liste tavanına eşit: onun ötesinde ekran zaten kırpıyor,
 * yani sistem çoktan kullanılamaz durumda. Gerçek fabrikada 28 cihaz var.
 */
const MAX_DEVICE_ROWS = DEVICE_LIST_LIMIT;

const DEVICE_INCLUDE = {
  machine: {
    select: { id: true, code: true, name: true, station: { select: { id: true, name: true } } },
  },
  hardwareLinks: {
    select: { peripheral: { select: { id: true, code: true, name: true, kind: true } } },
  },
} as const;

type DeviceWithMachine = {
  status: string;
  isActive: boolean;
  machineId: string | null;
  machine: { id: string; code: string; name: string; station: { id: string; name: string } | null } | null;
};

/**
 * Cihazın istemciye dönen atama görünümü.
 *
 * ⚠️ `pairingRequired` KARARIN KENDİSİDİR, süs değil (2026-09-04). Eskiden bu
 * cevap yalnız ham `status` taşıyordu ve istemciler onay ekranını `PENDING`e
 * bağlıyordu — bayrak KAPALIYKEN bile. Karar iki uca (`/devices/status` +
 * `/devices/pairing-required`) bölününce her istemci onu ayrı ayrı kurmak ve
 * ayrı ayrı yanlış yapmak zorunda kalıyordu. Artık tek cevap kararı taşır:
 * onay ekranı koşulu = `pairingRequired && status !== "APPROVED"`.
 */
function toAssignment(d: DeviceWithMachine, pairingRequired: boolean) {
  const station = d.machine?.station ?? null;
  return {
    pairingRequired,
    status: d.isActive ? d.status : "INACTIVE",
    machineId: d.machineId,
    machineCode: d.machine?.code ?? null,
    machineName: d.machine?.name ?? null,
    stationId: station?.id ?? null,
    stationName: station?.name ?? null,
  };
}

/** Cihaz detayında gösterilen donanım özeti — etiket profili dahil (liste ucu
 *  bunu ÇEKMEZ; over-fetch olmasın diye detay endpoint'ine ayrıldı). */
const PERIPHERAL_SUMMARY_SELECT = {
  id: true,
  code: true,
  name: true,
  kind: true,
  connectionType: true,
  languageOverride: true,
  // Etiket Stüdyosu v2: medya cihazın kendinde ("Boyutlar" profili emekli).
  labelWidthMm: true,
  labelHeightMm: true,
  labelDpi: true,
} as const;

/** Geçerli cihaz türüne normalize et (geçersiz/boş → TABLET). F6: Device.kind artık
 *  DeviceKind enum'u — dönüş tipi de enum, yazım uçları (create/update) tip-güvenli. */
function normalizeDeviceKind(k?: string | null): DeviceKind {
  const v = (k ?? "").toUpperCase();
  return (Object.values(DeviceKind) as string[]).includes(v) ? (v as DeviceKind) : DeviceKind.TABLET;
}

export class DeviceService {
  /** Admin: tüm cihazları listele (PENDING'ler önce). */
  static async list() {
    return prisma.device.findMany({
      orderBy: [{ status: "asc" }, { isActive: "desc" }, { createdAt: "desc" }],
      include: DEVICE_INCLUDE,
      // ⚠️ TAVAN (2026-08-09, F-CORE-GUV-003). Eskiden tavansızdı ve bu, kimlik
      // doğrulamasız `announce` ucuyla birleşince asıl zararı üretiyordu: sahte
      // kayıtlar tek yanıtta dönüp ekranı kullanılamaz hale getiriyordu. Artık
      // hem kaynakta tavan (MAX_PENDING_DEVICES) hem burada okuma tavanı var —
      // iki bağımsız hat. Sıralama PENDING'i öne aldığı için tavan, eşleşme
      // bekleyen cihazları KESMEZ; kesilen taraf eski APPROVED kuyruğudur.
      take: DEVICE_LIST_LIMIT,
    });
  }

  /**
   * Admin: cihaz detayı (Cihaz İşlem Dökümü ekranının başlığı). Cihaz meta'sı +
   * bağlı donanımlar (etiket profiliyle) + SON çalışma oturumu ("son oturum açma").
   * Donanım iki sahiplik yolundan birleşir: legacy tekil (PeripheralDevice.deviceId)
   * + M:N atama (DevicePeripheral) — id'ye göre dedup edilir.
   */
  static async detail(id: string) {
    const device = await prisma.device.findUnique({
      where: { id },
      select: {
        id: true,
        deviceId: true,
        name: true,
        kind: true,
        status: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
        machineId: true,
        machine: {
          select: {
            id: true,
            code: true,
            name: true,
            station: { select: { id: true, name: true } },
          },
        },
        peripherals: { where: { isActive: true }, select: PERIPHERAL_SUMMARY_SELECT },
        hardwareLinks: {
          where: { peripheral: { isActive: true } },
          select: { peripheral: { select: PERIPHERAL_SUMMARY_SELECT } },
        },
      },
    });
    if (!device) throw AppError.notFound("Cihaz bulunamadı");

    const { peripherals, hardwareLinks, ...rest } = device;
    const hardware = new Map<string, (typeof peripherals)[number]>();
    for (const p of [...peripherals, ...hardwareLinks.map((l) => l.peripheral)]) {
      hardware.set(p.id, p);
    }

    // Son oturum açma — [deviceId, startedAt] index'i sort-free karşılar.
    //
    // ⚠️ AKTÖR SÜZÜLMEZ, NÖTRLENİR (2026-09-03). Bu yüzey "bu cihazı en son KİM
    // açtı" sorusunu cevaplar; süzgeç burada YALAN üretirdi (satır düşerse cihaz
    // hiç kullanılmamış görünür). Ama düz `username` select'i de yanlıştı ve
    // ÖLÇÜLDÜ (D1): satıcı tablete PIN'le girince — tasarımın KENDİ akışı —
    // oturum o cihaza yazılıyor ve `admin:settings` taşıyan her yönetici Cihazlar
    // ekranında gerçek giriş adını görüyordu. Doğru çözüm audit yüzeyleriyle
    // Aktör GERÇEK adıyla döner (2026-09-04: kimlik maskesi kaldırıldı).
    const lastSession = await prisma.workSession.findFirst({
      where: { deviceId: id },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        endReason: true,
        user: { select: ACTOR_SELECT },
        machine: { select: { id: true, code: true, name: true } },
        station: { select: { id: true, code: true, name: true, kind: true } },
      },
    });

    return {
      ...rest,
      hardware: [...hardware.values()],
      lastSession,
    };
  }

  /**
   * Mobil (public): tablet boot'ta deviceId'sini bildirir. Var olan → lastSeen
   * güncellenir; mevcut atama döner. Bilinmeyen cihazın DOĞUŞ DURUMU bayrağa
   * bağlıdır (2026-09-04):
   *
   * - `devicePairingRequired = true`  → **PENDING** (admin onaylar; eski davranış)
   * - `devicePairingRequired = false` → **APPROVED** (kapı kapalı, onay diye bir
   *   adım YOK)
   *
   * ⚠️ Neden APPROVED ve neden `DeviceStatus` enum'una üçüncü bir değer
   * eklenmedi: enum iki değerlidir (`PENDING|APPROVED`) ve anlamı "bu cihaz
   * kapıdan geçebilir mi"dir. Bayrak kapalıyken kapı YOKTUR — herkes geçer —
   * yani doğru başlangıç, kapının açık karşılığı olan APPROVED'dır. Eski
   * koşulsuz PENDING doğuşu iki şeyi birden bozuyordu: (1) istemci PENDING'i
   * "onay bekleniyor" diye okuyup kilitleniyordu (saha bulgusu), (2) `resolveDevice`
   * yalnız APPROVED cihaza atıf döndüğü için bayrak kapalı kurulumda tabletin
   * `req.device`'ı HİÇ dolmuyor, yani makine atfı ve **cihaza bağlı donanım**
   * (BT yazıcı) çözümü sessizce boşa düşüyordu. "Yeni bir durum değeri" bunların
   * ikisini de çözmez, üçüncü bir dal daha açardı.
   *
   * ⚠️ Bayrak SONRADAN AÇILIRSA otomatik onaylananlar APPROVED KALIR. Bayrak
   * ileriye dönük bir kapıdır ("bundan sonra yeni cihaz onay ister"), geriye
   * dönük bir iptal değil: 28 cihazlık bir fabrikada retroaktif düşürme, ayarı
   * açan yöneticinin vardiya ortasında tüm tabletleri kilitlemesi demekti
   * (çıkışsız kapı). Otomatik onaylananların izi audit'te durur
   * (`DEVICE_AUTO_APPROVED`); yönetici tek tek `revoke` ile gözden geçirebilir.
   *
   * ⚠️ Bayrak kapalıyken MEVCUT bir PENDING cihaz TERFİ ETTİRİLMEZ. "Hiç
   * görülmemiş cihaz" ile "yönetici görüp PENDING'de BIRAKTIĞI (ya da `revoke`
   * ettiği) cihaz" farklı şeylerdir; public bir uç bir yönetici kararını geri
   * alamaz (F216'nın aynı gerekçesi).
   */
  static async announce(input: { deviceId: string; name?: string; kind?: string }) {
    const deviceId = (input.deviceId ?? "").trim();
    if (!deviceId) throw AppError.badRequest("deviceId zorunlu");
    const pairingRequired = await readDevicePairingRequired();
    const kind = normalizeDeviceKind(input.kind);
    const kindLabel = kind === "PHONE" ? "Telefon" : kind === "DESKTOP" ? "Masaüstü" : "Tablet";
    const fallbackName = input.name?.trim() || `${kindLabel} ${deviceId.slice(0, 8)}`;
    // ⚠️ YENİ CİHAZ KAYDI TAVANLI (2026-08-09 denetimi, F-CORE-GUV-003).
    // Bu uç KİMLİK DOĞRULAMASIZ (tablet eşleşmeden token alamaz) ve hız sınırı
    // yok — yani rastgele `deviceId` üreten bir betik sınırsız PENDING satırı
    // açabiliyordu. Zarar satır sayısı değil GÖRÜNÜRLÜK: admin Cihazlar ekranı
    // sahadaki gerçek tableti binlerce sahte kayıt arasında bulup onaylayamaz,
    // yani yeni tablet üretime alınamaz. Temizlik yolu satır satır (hard delete).
    //
    // Tavan YALNIZ YENİ KAYIT açar/kapatır: bilinen bir cihazın `announce`ı
    // (canlılık yazımı) HER ZAMAN çalışır — sahadaki tabletleri tavana kurban
    // etmek, önlenmeye çalışılan şeyden kötü olurdu. Eşik cömert: gerçekte
    // eşleşme bekleyen cihaz sayısı tek hanelidir (ölçüm: 9).
    const existing = await prisma.device.findUnique({
      where: { deviceId },
      select: { id: true },
    });
    if (!existing) {
      // Rejimden BAĞIMSIZ satır tavanı (bkz. MAX_DEVICE_ROWS): bayrak kapalıyken
      // PENDING sayacı hiç artmadığı için aşağıdaki tavan TEK BAŞINA yetmez.
      const totalCount = await prisma.device.count();
      if (totalCount >= MAX_DEVICE_ROWS) {
        throw AppError.tooManyRequests(
          `Kayıtlı cihaz sayısı üst sınıra ulaştı (${MAX_DEVICE_ROWS}). ` +
            `Yönetici panelinden kullanılmayan cihazları kaldırın.`,
          { code: "DEVICE_LIMIT" },
        );
      }
      if (pairingRequired) {
        const pendingCount = await prisma.device.count({ where: { status: "PENDING" } });
        if (pendingCount >= MAX_PENDING_DEVICES) {
          throw AppError.tooManyRequests(
            `Eşleşme bekleyen cihaz sayısı üst sınıra ulaştı (${MAX_PENDING_DEVICES}). ` +
              `Yönetici panelinden bekleyen cihazları onaylayın veya kaldırın.`,
            { code: "PENDING_DEVICE_LIMIT" },
          );
        }
      }
    }

    const device = await prisma.device.upsert({
      where: { deviceId },
      create: {
        deviceId,
        name: fallbackName,
        kind,
        // Kapı kapalıysa (bayrak false) onay diye bir adım yok → APPROVED doğar.
        status: pairingRequired ? "PENDING" : "APPROVED",
        isActive: true,
        lastSeenAt: new Date(),
      },
      // F216: Var olan cihazda announce SADECE canlılık (lastSeenAt) yazar — kind burada
      // DEĞİŞTİRİLMEZ. Aksi halde APPROVED bir cihaz public announce ile kind'ını DESKTOP'a
      // flip edip work-session zorunluluğunu bypass edebilirdi.
      update: { lastSeenAt: new Date() },
      include: DEVICE_INCLUDE,
    });
    // Cihaz tipini YALNIZ henüz onaylanmamış (PENDING) cihaz, client düzeltmesiyle
    // güncelleyebilir (ör. ilk announce TABLET tahmin etti, gerçekte PHONE). APPROVED
    // cihazın tipini yalnız admin (approveAndAssign) değiştirir. Atomik WHERE status=PENDING:
    // APPROVED satır 0 etkilenir (upsert↔onay race'inde de güvenli).
    if (input.kind && device.status === "PENDING" && device.kind !== kind) {
      await prisma.device.updateMany({ where: { deviceId, status: "PENDING" }, data: { kind } });
    }
    // Otomatik onayın İZİ (yalnız yeni doğan satırda). Bayrak sonradan açılırsa
    // yöneticinin "bu cihazı hiç kimse onaylamadı" diyebileceği tek kayıt budur.
    if (!existing && !pairingRequired && device.status === "APPROVED") {
      await AuditService.log({
        userId: undefined,
        action: "CREATE",
        tableName: "devices",
        recordId: device.id,
        newData: {
          event: "DEVICE_AUTO_APPROVED",
          deviceId,
          name: device.name,
          kind: device.kind,
          status: "APPROVED",
          reason: "devicePairingRequired=false",
        },
      }).catch(() => undefined);
    }
    return toAssignment(device, pairingRequired);
  }

  /**
   * Mobil (public): atama durumunu poll'la. Bilinmiyorsa UNKNOWN.
   * Cevap `pairingRequired`i DE taşır — onay ekranı kararı sunucudadır
   * (bkz. `toAssignment`); istemci iki ucu birleştirip mantığı kendi kurmaz.
   */
  static async getStatus(deviceId: string) {
    const [device, pairingRequired] = await Promise.all([
      prisma.device.findUnique({ where: { deviceId }, include: DEVICE_INCLUDE }),
      readDevicePairingRequired(),
    ]);
    if (!device) {
      return {
        pairingRequired,
        status: "UNKNOWN",
        machineId: null,
        machineCode: null,
        machineName: null,
        stationId: null,
        stationName: null,
      };
    }
    return toAssignment(device, pairingRequired);
  }

  /** Admin: cihazı onayla + (opsiyonel) makineye ata + opsiyonel takma ad. İstasyon makineden türetilir. */
  static async approveAndAssign(
    id: string,
    input: { machineId?: string | null; kind?: string; name?: string },
    userId?: string,
  ) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    let machineId: string | null = input.machineId ?? null;
    if (machineId) {
      const m = await prisma.machine.findFirst({ where: { id: machineId, isActive: true }, select: { id: true } });
      if (!m) throw AppError.badRequest("Makine bulunamadı veya pasif");
    }
    // Takma ad opsiyonel: verilmişse güncelle (yalnız panelde görünür — "Beratın telefonu").
    const name = input.name?.trim();
    const updated = await prisma.device.update({
      where: { id },
      data: {
        status: "APPROVED",
        isActive: true,
        machineId,
        ...(input.kind ? { kind: normalizeDeviceKind(input.kind) } : {}),
        ...(name ? { name } : {}),
      },
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { status: existing.status, machineId: existing.machineId },
      newData: { status: "APPROVED", machineId },
    }).catch(() => undefined);
    return updated;
  }

  /**
   * Admin: cihaza donanım ata (M:N paylaşım — join DevicePeripheral). Cihazın join
   * satırlarını seçilen donanımla DEĞİŞTİRİR. Aynı donanım (ör. ağ yazıcısı) başka
   * cihazlarda da kalabilir — diğer cihazlara DOKUNULMAZ. Boş liste = tümünü kaldır.
   */
  static async assignHardware(id: string, peripheralIds: string[], userId?: string) {
    const device = await prisma.device.findUnique({ where: { id }, select: { id: true } });
    if (!device) throw AppError.notFound("Cihaz bulunamadı");
    const ids = Array.from(new Set((peripheralIds ?? []).filter((p): p is string => typeof p === "string" && !!p)));
    if (ids.length > 0) {
      const found = await prisma.peripheralDevice.findMany({
        where: { id: { in: ids }, isActive: true }, select: { id: true },
      });
      if (found.length !== ids.length) throw AppError.badRequest("Bir veya daha fazla donanım bulunamadı veya pasif");
    }
    await prisma.$transaction([
      prisma.devicePeripheral.deleteMany({ where: { deviceId: id } }),
      ...(ids.length
        ? [prisma.devicePeripheral.createMany({ data: ids.map((peripheralId) => ({ deviceId: id, peripheralId })), skipDuplicates: true })] // F218
        : []),
    ]);
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id, newData: { assignedHardware: ids },
    }).catch(() => undefined);
    return { success: true, assigned: ids.length };
  }

  /** Admin: onayı/atamayı geri al → PENDING (tablet "atama bekleniyor"a düşer). */
  static async revoke(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({
      where: { id }, data: { status: "PENDING", machineId: null },
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { status: existing.status, machineId: existing.machineId },
      newData: { status: "PENDING", machineId: null },
    }).catch(() => undefined);
    return updated;
  }

  /** Admin: pasif cihazı tekrar aktifleştir (atama/onay durumu korunur). */
  static async reactivate(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    if (existing.isActive) throw AppError.badRequest("Cihaz zaten aktif");
    const updated = await prisma.device.update({ where: { id }, data: { isActive: true } });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { isActive: false }, newData: { isActive: true },
    }).catch(() => undefined);
    return updated;
  }

  /** Admin: cihazı pasife al (soft delete; onay/atama korunur, middleware 401'ler). */
  static async deactivate(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({ where: { id }, data: { isActive: false } });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { isActive: existing.isActive }, newData: { isActive: false },
    }).catch(() => undefined);
    return updated;
  }

  /** Admin: kalıcı sil (yalnız atanmamış — machineId=null — ve oturum geçmişi olmayan). */
  static async hardDelete(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    if (existing.machineId) {
      throw AppError.badRequest("Cihaz bir makineye atanmış. Önce atamayı geri alın.");
    }
    // Ayak izi tarihçesi korunur — oturum geçmişi olan cihaz kalıcı silinemez (FK Restrict'in
    // ham P2003'ü yerine anlaşılır Türkçe mesaj). Çözüm: pasife al (soft delete).
    const sessionCount = await prisma.workSession.count({ where: { deviceId: id } });
    if (sessionCount > 0) {
      throw AppError.badRequest(
        "Cihazın çalışma oturumu geçmişi var — kalıcı silinemez, pasife alın.",
      );
    }
    // peripheral_devices.deviceId ON DELETE SET NULL + device_peripherals pivot'u Cascade
    // (A5, 2026-07-31 denetimi) — guard'sız silmede donanımın hangi cihaza bağlı/
    // yönlendirilmiş olduğu izi sessizce kaybolurdu. Önce bağı çözün (unpair), sonra silin.
    const [peripheralCount, pivotCount] = await Promise.all([
      prisma.peripheralDevice.count({ where: { deviceId: id } }),
      prisma.devicePeripheral.count({ where: { deviceId: id } }),
    ]);
    if (peripheralCount + pivotCount > 0) {
      throw AppError.badRequest(
        `Cihaza bağlı ${peripheralCount + pivotCount} çevre birimi bağı (terazi/yazıcı) var — önce bağlantıyı kaldırın.`,
      );
    }
    await prisma.device.delete({ where: { id } });
    await AuditService.log({
      userId, action: "DELETE", tableName: "devices", recordId: id,
      oldData: { deviceId: existing.deviceId, name: existing.name, status: existing.status },
    }).catch(() => undefined);
    return { id };
  }

  /** Admin: cihaz adını yeniden adlandır. */
  static async rename(id: string, name: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({ where: { id }, data: { name } });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { name: existing.name }, newData: { name },
    }).catch(() => undefined);
    return updated;
  }

  // lastSeenAt yazım throttle'ı — resolveDevice her `x-device-id`'li istekte çalışır.
  private static lastSeenWrites = new Map<string, number>();
  private static readonly LAST_SEEN_THROTTLE_MS = 60_000;

  /**
   * Middleware: x-device-id → device + machineId çöz. YALNIZ APPROVED + aktif cihaza
   * atıf döner; PENDING/INACTIVE/bilinmeyen → null (eşleşmemiş davranışı).
   * lastSeenAt fire-and-forget (cihaz başına throttle'lı).
   */
  static async resolveDevice(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      select: { id: true, deviceId: true, name: true, machineId: true, kind: true, isActive: true, status: true },
    });
    if (!device || !device.isActive || device.status !== "APPROVED") return null;
    const now = Date.now();
    const lastWrite = DeviceService.lastSeenWrites.get(deviceId) ?? 0;
    if (now - lastWrite > DeviceService.LAST_SEEN_THROTTLE_MS) {
      DeviceService.lastSeenWrites.set(deviceId, now);
      void prisma.device
        .update({ where: { deviceId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
      // Çalışma oturumu canlılığı — aynı throttle'a piggyback (okuma yok, timer yok).
      // Tembel IDLE kapatma (work-session.helper) bu alanın eskiliğine bakar.
      void prisma.workSession
        .updateMany({
          where: { deviceId: device.id, endedAt: null },
          data: { lastActivityAt: new Date() },
        })
        .catch(() => undefined);
    }
    return device;
  }
}
