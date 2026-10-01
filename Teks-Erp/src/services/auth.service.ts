// =============================================================================
// TeksERP - Auth Service
// =============================================================================

import prisma from "../lib/prisma";
import { ClientType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readPatronCloudUserId } from "./helpers/patron-cloud-user.helper";
import jwt from "jsonwebtoken";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { JwtPayload } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  readSessionDurationMinutes,
  readAutoLogoutOnExpiry,
  readLoginMethods,
  readSameTypeSessionPolicy,
  readAbsoluteSessionCapDays,
} from "./system-setting.service";
import { SessionRegistryService } from "./session-registry.service";
import { TotpAccountService } from "./totp-account.service";
import { getShortCredentialKeyRing, ringKeyByKid } from "../lib/short-credential/keyring";
import {
  CARD_SECRET_BYTES,
  digestCardSecret,
  digestKid,
  digestQuickPin,
  digestsEqual,
  parseCardCode,
} from "../lib/short-credential/digest";
import { countForeignDigests, requireKeyRing, ShortCredentialService } from "./short-credential.service";
import {
  forgetIssuedPin,
  readIssued,
  rememberIssuedCard,
  rememberIssuedPin,
} from "./helpers/credential-reveal.helper";

/** Login çağrılarının istemci bağlamı — Session registry + aynı-tip politika için.
 *  clientType body'den (default 'mobile'); deviceId x-device-id/req.device'den;
 *  confirmKick 'notify' politikasında "ikisi de açık kalsın" onayı. */
export interface LoginContext {
  clientType?: LoginClientType;
  deviceId?: string | null;
  confirmKick?: boolean;
  /** Parolalı girişte ikinci faktör: TOTP kodu ya da kurtarma kodu (ayrımı servis yapar). */
  totpCode?: string;
  /**
   * İstemcinin künye başlığında bildirdiği kendi sürümü — `Session.clientVersion`e
   * yazılır. ⚠️ Bu değer İSTEMCİDEN gelir ve uydurulabilir, o yüzden hiçbir
   * kapıya/politikaya girmez. Yalnız "sahada hangi sürümler görülüyor" sorusunu
   * cevaplayan bir GÖZLEMdir.
   */
  clientVersion?: string | null;
}

/** Gövdeden gelen istemci türü. `undefined` = mobil (tarihsel varsayılan). */
export type LoginClientType = "electron" | "mobile" | "web";

/**
 * MASAÜSTÜ SINIFI istemci mi (Electron paneli ya da tarayıcıdaki web paneli)?
 *
 * İkisi AYNI React kodudur, yalnız kabuğu farklıdır — dolayısıyla "bu hesabın
 * masaüstü paneline erişimi var mı" kuralı ikisine de uygulanır.
 *
 * ⚠️ `!== "mobile"` YAZILMAZ: `clientType` opsiyoneldir ve `undefined` tarihsel
 * olarak MOBİL demektir. Negatif yazım, alanı hiç göndermeyen eski mobil
 * istemcileri masaüstü sayıp hepsini 403'e düşürürdü.
 */
function isDesktopClient(clientType: LoginClientType | undefined): boolean {
  return clientType === "electron" || clientType === "web";
}

/** Gövde değeri → `Session.deviceType`. Bilinmeyen/eksik → MOBILE (tarihsel varsayılan). */
function resolveDeviceType(clientType: LoginClientType | undefined): ClientType {
  if (clientType === "electron") return ClientType.ELECTRON;
  if (clientType === "web") return ClientType.WEB;
  return ClientType.MOBILE;
}

/** Eski panel için "PIN tanımlı ama gösterilemez" yer tutucusu (düz değer DB'de yok). */
export const HIDDEN_PIN_PLACEHOLDER = "••••••";

/** Anahtar uyuşmazlığı: özet, bu sunucunun anahtar halkasında olmayan bir anahtarla yazılmış. */
function keyMismatchError(kind: "pin" | "card"): AppError {
  const ne = kind === "pin" ? "hızlı PIN" : "personel kartı";
  return AppError.unauthorized(
    `Bu ${ne} doğrulanamıyor: kısa kimlik anahtarı bu veritabanıyla uyuşmuyor (yedek başka bir sunucudan geri yüklenmiş). ` +
      "Yönetici: Kullanıcılar → Kısa Kimlikler'den anahtarı yedek parolasıyla geri yükleyin ya da PIN'leri toplu sıfırlayın. " +
      "Şimdilik kullanıcı adı ve şifreyle giriş yapın.",
    { code: "SHORT_CREDENTIAL_KEY_MISMATCH" },
  );
}

function plainEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET environment variable zorunlu ve en az 32 karakter olmalı. " +
        ".env dosyanızı kontrol edin."
    );
  }
  return secret;
}
const JWT_SECRET: string = loadJwtSecret();

export class AuthService {
  /**
   * Authenticate user and return JWT token.
   * Efektif yetki = UserPermission tablosundan validFrom/validUntil filtreli okuma.
   * Roller yok — yetki kişiye doğrudan atanır.
   */
  static async login(
    username: string,
    password: string,
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        isActive: true,
        tokenVersion: true,
      },
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    // ⚠️ SIRA: ikinci faktör `issueToken`den ÖNCE — `issueToken` oturum açar ve
    // `kick` politikasında diğer oturumları düşürür; yalnız parolayı bilen biri
    // meşru kullanıcıyı oturumundan atamamalı.
    await this.assertSecondFactor(user.id, ctx);

    return this.issueToken(
      { id: user.id, username: user.username, tokenVersion: user.tokenVersion },
      ctx
    );
  }

  /**
   * QR personel kartıyla giriş — YALNIZ auth.loginMethods "card" içerirken
   * (kapalıyken kart altyapısı saldırı yüzeyi açmaz; klasik login HEP açık).
   * Kart içeriği "TEKSU:<userId>:<token>"; token users.cardToken'daki 32-hex sır.
   * Kart kaybolursa admin ROTASYON yapar (yeni token) → eski kart anında ölür.
   */
  static async loginWithCard(
    cardCode: string,
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const methods = await readLoginMethods();
    if (!methods.enabled.includes("card")) {
      throw AppError.forbidden(
        "Kartla giriş kapalı — Genel Ayarlar'dan giriş yöntemlerine 'QR kart' eklenebilir"
      );
    }
    const parsed = parseCardCode(cardCode);
    if (!parsed) throw AppError.unauthorized("Geçersiz personel kartı");
    const row = await prisma.user.findUnique({
      where: { id: parsed.userId },
      select: {
        id: true, username: true, tokenVersion: true, isActive: true,
        cardTokenDigest: true, cardToken: true,
      },
    });
    const user = row && row.isActive ? { id: row.id, username: row.username, tokenVersion: row.tokenVersion } : null;
    let ok = false;
    if (row && row.isActive && row.cardTokenDigest) {
      const ring = getShortCredentialKeyRing();
      const kid = digestKid(row.cardTokenDigest);
      const key = ring.ok && kid ? ringKeyByKid(ring.ring, kid) : null;
      if (!key) throw keyMismatchError("card");
      ok = digestsEqual(row.cardTokenDigest, digestCardSecret(key, row.id, parsed.secret));
    } else if (row && row.isActive && row.cardToken) {
      // Dönüşüm koşulana dek düz kolon SALT OKUNUR (geçiş yedeği); yazılmaz.
      ok = plainEquals(row.cardToken.toLowerCase(), parsed.secret);
    }
    if (!ok || !user) {
      throw AppError.unauthorized("Kart geçersiz veya iptal edilmiş — yöneticiden yeni kart isteyin");
    }
    const legacyCard = row?.cardTokenDigest ? null : (row?.cardToken ?? null);
    if (legacyCard) {
      const result = await this.issueToken(user, ctx);
      await ShortCredentialService.convertOnLogin(user.id, "card", legacyCard).catch(() => false);
      return result;
    }
    return this.issueToken(user, ctx);
  }

  /**
   * SALT hızlı-PIN ile giriş — YALNIZ auth.loginMethods "pin" içerirken. Kullanıcı
   * seçme/ID yok: PIN sistem genelinde BENZERSİZ (users.quickPin @unique) olduğundan
   * tek başına kimliği belirler (findUnique). Şifreden AYRI alandır.
   */
  static async loginWithQuickPin(
    pin: string,
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const methods = await readLoginMethods();
    if (!methods.enabled.includes("pin")) {
      throw AppError.forbidden(
        "Hızlı PIN ile giriş kapalı — Genel Ayarlar'dan giriş yöntemlerine 'Hızlı PIN' eklenebilir"
      );
    }
    const normalized = (pin ?? "").trim();
    if (!/^\d{6}$/.test(normalized)) {
      throw AppError.unauthorized("Geçersiz PIN");
    }
    const ring = getShortCredentialKeyRing();
    const candidates = ring.ok ? ring.ring.keys.map((k) => digestQuickPin(k, normalized)) : [];
    if (candidates.length > 0) {
      const hit = await prisma.user.findFirst({
        where: { quickPinDigest: { in: candidates }, isActive: true },
        select: { id: true, username: true, tokenVersion: true, quickPinDigest: true },
      });
      if (hit && candidates.some((c) => digestsEqual(c, hit.quickPinDigest ?? ""))) {
        return this.issueToken({ id: hit.id, username: hit.username, tokenVersion: hit.tokenVersion }, ctx);
      }
    }
    // Dönüşüm koşulana dek düz kolon SALT OKUNUR (geçiş yedeği); yazılmaz.
    const legacy = await prisma.user.findFirst({
      where: { quickPin: normalized, isActive: true },
      select: { id: true, username: true, tokenVersion: true },
    });
    if (legacy) {
      const result = await this.issueToken(legacy, ctx);
      await ShortCredentialService.convertOnLogin(legacy.id, "pin", normalized).catch(() => false);
      return result;
    }
    if (ring.ok && (await countForeignDigests("quickPinDigest", ring.ring.keys.map((k) => k.kid))) > 0) {
      throw keyMismatchError("pin");
    }
    if (!ring.ok && (await prisma.user.count({ where: { quickPinDigest: { not: null } } })) > 0) {
      throw AppError.unauthorized(
        "Hızlı PIN şu an doğrulanamıyor: kısa kimlik anahtarı okunamadı. Kullanıcı adı ve şifreyle giriş yapın; yöneticiye haber verin.",
        { code: "SHORT_CREDENTIAL_KEY_UNAVAILABLE" },
      );
    }
    throw AppError.unauthorized("PIN tanınmadı — yöneticinizden hızlı PIN isteyin");
  }

  /**
   * Admin: kullanıcıya hızlı PIN ata. `pin` verilirse (6 hane) o kullanılır — BAŞKASINDA varsa
   * 409; verilmezse çakışmayan rastgele 6 hane. DB'ye yalnız ÖZET yazılır; düz PIN bu cevapta
   * ve kısa basım penceresinde (`credential-reveal`) döner. `clear=true` → PIN kaldırılır.
   */
  static async setQuickPin(
    userId: string,
    input: { pin?: string; clear?: boolean },
    actorUserId?: string
  ): Promise<{ pin: string | null }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isActive: true, quickPin: true, quickPinDigest: true },
    });
    if (!user || !user.isActive) throw AppError.notFound("Kullanıcı bulunamadı veya pasif");
    const hadPin = user.quickPin != null || user.quickPinDigest != null;

    if (input.clear) {
      await prisma.user.update({
        where: { id: userId },
        data: { quickPin: null, quickPinDigest: null, quickPinSetAt: null },
      });
      forgetIssuedPin(userId);
      await AuditService.log({
        userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
        recordId: userId, newData: { username: user.username, cleared: true },
      }).catch(() => undefined);
      return { pin: null };
    }

    const pin = await ShortCredentialService.assignQuickPin(
      userId,
      input.pin !== undefined ? input.pin.trim() : null,
    );
    rememberIssuedPin(userId, pin);
    await AuditService.log({
      userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
      recordId: userId, newData: { username: user.username, rotated: hadPin },
    }).catch(() => undefined);
    return { pin };
  }

  /**
   * Admin: personel kartı sırrını üret/YENİLE (rotasyon). 256 bit yeni sır; DB'ye yalnız ÖZETİ
   * yazılır, dönen cardCode QR olarak basılır (kısa basım penceresinde yeniden okunabilir).
   * Eski kart anında geçersiz. Açık JWT oturumları ETKİLENMEZ.
   */
  static async rotateCardToken(
    userId: string,
    actorUserId?: string
  ): Promise<{ cardCode: string; rotated: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isActive: true, cardToken: true, cardTokenDigest: true },
    });
    if (!user || !user.isActive) throw AppError.notFound("Kullanıcı bulunamadı veya pasif");
    const ring = requireKeyRing();
    const secret = randomBytes(CARD_SECRET_BYTES).toString("hex");
    await prisma.user.update({
      where: { id: userId },
      data: {
        cardTokenDigest: digestCardSecret(ring.active, user.id, secret),
        cardIssuedAt: new Date(),
        cardTokenLegacy: false,
        cardToken: null,
      },
    });
    const rotated = user.cardToken != null || user.cardTokenDigest != null;
    const cardCode = `TEKSU:${user.id}:${secret}`;
    rememberIssuedCard(userId, cardCode);
    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "USER_CARD_TOKEN",
      recordId: userId,
      newData: { username: user.username, rotated },
    }).catch(() => undefined);
    return { cardCode, rotated };
  }

  /**
   * Hedef kullanıcı EN YETKİLİ HESAP mı? (kimlik-bilgisi kapısının yüklemi)
   * NEDEN SERVİSTE: route/controller katmanı `lib/prisma`ya inmez (katman kuralı,
   * ESLint `no-restricted-imports`). Kapının kendisi çağıranda kalır — bu yalnız
   * tek alanlık okumadır; kullanıcı yoksa `false` (varlık kararını çağıran verir).
   */
  static async isSystemAccountUser(userId: string): Promise<boolean> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAccount: true },
    });
    return row?.isSystemAccount === true;
  }

  /**
   * Admin: kullanıcının mobil kimlik DURUMU. Düz değer YALNIZ yeni verildiyse (kısa basım
   * penceresi) ya da henüz dönüştürülmemiş düz kolondan döner; özetli PIN için yer tutucu
   * (eski panel "tanımlı" görsün), özetli kart için null. Yeni alanlar durumu taşır.
   */
  static async getUserCredentials(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, quickPin: true, cardToken: true,
        quickPinDigest: true, quickPinSetAt: true,
        cardTokenDigest: true, cardIssuedAt: true, cardTokenLegacy: true,
      },
    });
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");
    const issued = readIssued(userId);
    const ring = getShortCredentialKeyRing();
    const ringKids = ring.ok ? ring.ring.keys.map((k) => k.kid) : [];
    const keyOk = (d: string | null) => d === null || ringKids.includes(digestKid(d) ?? "");
    const quickPinSet = user.quickPinDigest !== null || user.quickPin !== null;
    const cardSet = user.cardTokenDigest !== null || user.cardToken !== null;
    const legacyCardCode = user.cardToken ? `TEKSU:${user.id}:${user.cardToken}` : null;
    return {
      quickPin: issued.pin?.value ?? user.quickPin ?? (quickPinSet ? HIDDEN_PIN_PLACEHOLDER : null),
      cardCode: issued.card?.value ?? legacyCardCode,
      quickPinSet,
      quickPinSetAt: user.quickPinSetAt,
      quickPinRevealed: issued.pin !== null,
      quickPinKeyOk: keyOk(user.quickPinDigest),
      quickPinStorage: user.quickPinDigest !== null ? ("OZET" as const) : user.quickPin !== null ? ("DUZ" as const) : null,
      cardSet,
      cardIssuedAt: user.cardIssuedAt,
      cardRevealed: issued.card !== null,
      cardKeyOk: keyOk(user.cardTokenDigest),
      cardLegacy: user.cardToken !== null || (user.cardTokenDigest !== null && user.cardTokenLegacy),
      revealExpiresAt: (() => {
        const t = Math.max(issued.pin?.until ?? 0, issued.card?.until ?? 0);
        return t > 0 ? new Date(t).toISOString() : null;
      })(),
    };
  }

  /** JWT üretimi — login/loginWithCard/loginWithQuickPin'in ortak çıkışı. Session
   *  registry'ye kayıt açar (aynı-tip politikası burada uygulanır) ve jti'yi jwtid
   *  olarak token'a gömer → middleware anlık iptal kontrolü yapabilir. 'notify'
   *  politikası + onaysız çakışma → openLoginSession 409 SESSION_EXISTS fırlatır. */
  /**
   * İKİNCİ FAKTÖR KAPISI — yalnız PAROLALI giriş, yalnız kullanıcı TOTP'yi AÇTIYSA
   * (ağdan bağımsız; açmayana hiç sorulmaz). Kart/PIN/cihaz girişleri buradan geçmez.
   * Kodlar giriş kilidine göre seçildi (yalnız 401 kaba kuvvet sayılır):
   *   • 409 TOTP_REQUIRED → kod istendi; kimlik denemesi DEĞİL (istemci kodu ekleyip tekrar POST eder).
   *   • 401 TOTP_INVALID  → yanlış kod; SAYILIR (TOTP uzayı 10^6, kilitsiz tahmin edilirdi).
   */
  private static async assertSecondFactor(userId: string, ctx?: LoginContext): Promise<void> {
    const status = await TotpAccountService.getStatus(userId);
    if (!status.enabled) return;

    const code = (ctx?.totpCode ?? "").trim();
    if (!code) {
      // Tablet uygulamasında kod adımı yok: kullanıcıyı PIN/kart yoluna yönlendir.
      const message = isDesktopClient(ctx?.clientType)
        ? "Doğrulama kodu gerekli."
        : "Bu hesapta iki adımlı doğrulama açık — tablette PIN ya da kartla giriş yapın.";
      throw AppError.conflict(message, { code: "TOTP_REQUIRED" });
    }
    if (!(await TotpAccountService.verifySecondFactor(userId, code))) {
      throw AppError.unauthorized("Doğrulama kodu geçersiz.", { code: "TOTP_INVALID" });
    }
  }

  private static async issueToken(
    user: {
      id: string;
      username: string;
      tokenVersion: number;
    },
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    // Patron bulutu teknik kullanıcısının GİRİŞ YÖNTEMİ YOKTUR: parolası panelden sıfırlansa ya da PIN/kart verilse
    // bile oturum açılmaz (tek token üreticisi burası; mesaj genel — hesabın varlığını doğrulamaz).
    if (user.id === (await readPatronCloudUserId())) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }
    const permissions = await this.getEffectivePermissions(user.id);

    // Masaüstü (Electron VE web paneli) girişi: kullanıcının en az bir MASAÜSTÜ
    // (mobil-olmayan) izni olmalı. Yalnız mobil izinli (mobile:*) hesap panele
    // giremez → 403, token BİLE üretilmez. Mobil girişte bu kısıt yok.
    if (
      isDesktopClient(ctx?.clientType) &&
      !permissions.some((p) => !p.startsWith("mobile:"))
    ) {
      // Kanal reddi izin reddinden AYRI kod: istemci "yetki iste" değil "doğru uygulamayı aç" der.
      throw AppError.forbidden(
        "Bu hesabın masaüstü paneline erişimi yok. Yalnızca mobil uygulamada kullanılabilir.",
        { code: "CHANNEL_DENIED", channel: "desktop" },
      );
    }

    // Oturum zaman aşımı TEK ayar: auth.autoLogoutOnExpiry.
    //  • Açık (varsayılan): token auth.sessionDurationMinutes (default 480) sonra dolar;
    //    süre bitince client otomatik çıkar, sunucu da 401 verir.
    //  • Kapalı: token yine de MUTLAK oturum tavanına (auth.absoluteSessionCapDays,
    //    default 30 gün) kadar geçerlidir — sızan token sonsuza kadar yaşamasın.
    //    Tavan 0 ise gerçekten SÜRESİZ imzalanır (exp claim YOK). Oturum yine
    //    tokenVersion / session iptali / logout ile sonlandırılabilir.
    // (Dakika ayarı yoksa reader eski saat ayarına ×60 düşer — geriye-uyum.)
    const timeoutEnabled = await readAutoLogoutOnExpiry();
    const sessionMinutes = await readSessionDurationMinutes();
    const capDays = await readAbsoluteSessionCapDays();

    // jti = Session satırı anahtarı. Taban (mutlak) son-kullanma:
    //   • zaman aşımı açık → now + oturum süresi (dakika)
    //   • kapalı + cap>0 → now + cap gün (arka plan tavanı)
    //   • kapalı + cap=0 → uzak gelecek (gerçekten süresiz; exp claim yok)
    const jti = randomUUID();
    const nowMs = Date.now();
    const FAR_FUTURE = new Date("9999-12-31T23:59:59.000Z");
    let hasExp: boolean;
    let effectiveExpiresAt: Date;
    if (timeoutEnabled) {
      hasExp = true;
      effectiveExpiresAt = new Date(nowMs + sessionMinutes * 60 * 1000);
    } else if (capDays > 0) {
      hasExp = true;
      effectiveExpiresAt = new Date(nowMs + capDays * 24 * 60 * 60 * 1000);
    } else {
      hasExp = false;
      effectiveExpiresAt = FAR_FUTURE;
    }

    // Part C — süreli izinler: kullanıcının EN YAKIN gelecekteki validUntil'i tabanla
    // min'lenir. Süreli izin verilmişse (grant tokenVersion++ ile re-login zorlar)
    // yeni token bu tarihe kadar geçerli → izin süresi bitince oturum sunucu-tarafında
    // ölür (401) ve re-login'de getEffectivePermissions o izni zaten hariç tutar.
    // Nearest varsa exp HER durumda konur (süresiz taban bile bu tarihe kırpılır).
    // F51: iki aday sınır — (a) EFEKTİF (validFrom geçmiş/boş) grant'ın en yakın
    // validUntil'i (kapanış); (b) henüz BAŞLAMAMIŞ (validFrom gelecekte) grant'ın
    // en yakın validFrom'u (açılış → re-login'de token o izni alsın). Eski sorgu
    // yalnız validUntil>now bakıyordu: henüz-başlamamış grant'ın validUntil'i
    // oturumu gereksiz kırpıyor, açılış anı ise hiç yakalanmıyordu.
    const nowDate = new Date(nowMs);
    const [nearestExpiry, nearestOpening] = await Promise.all([
      prisma.userPermission.findFirst({
        where: {
          userId: user.id,
          validUntil: { gt: nowDate },
          OR: [{ validFrom: null }, { validFrom: { lte: nowDate } }],
        },
        orderBy: { validUntil: "asc" },
        select: { validUntil: true },
      }),
      prisma.userPermission.findFirst({
        where: { userId: user.id, validFrom: { gt: nowDate } },
        orderBy: { validFrom: "asc" },
        select: { validFrom: true },
      }),
    ]);
    for (const boundary of [nearestExpiry?.validUntil, nearestOpening?.validFrom]) {
      if (boundary && (!hasExp || boundary.getTime() < effectiveExpiresAt.getTime())) {
        effectiveExpiresAt = boundary;
        hasExp = true;
      }
    }

    // Session expiresAt: JWT exp ile HİZALI (kapalı+cap=0 → uzak gelecek; notify
    // 'aktif oturum' kontrolü expiresAt>now'a bakar).
    const expiresAt = effectiveExpiresAt;
    // ⚠️ WEB kendi yuvasını alır — ELECTRON'a katlanmaz. Katlansaydı aynı kişinin
    // telefon tarayıcısındaki oturumu masaüstü panelini düşürürdü (politika
    // varsayılanı `kick`), ki uzaktan takip senaryosunun tam tersi olurdu.
    const deviceType: ClientType = resolveDeviceType(ctx?.clientType);
    const policy = await readSameTypeSessionPolicy();

    // Oturum kaydını AÇ (token imzalanmadan önce — notify çakışmasında token üretilmez).
    await SessionRegistryService.openLoginSession({
      userId: user.id,
      deviceType,
      deviceId: ctx?.deviceId ?? null,
      jti,
      expiresAt,
      policy,
      confirmKick: ctx?.confirmKick,
      clientVersion: ctx?.clientVersion ?? null,
    });

    // jti token'a jwt.sign jwtid ile eklenir — sign payload'ında jti TUTMUYORUZ
    // (jsonwebtoken "jti already present" hatası verir). Dönen JwtPayload jti taşır.
    const signPayload = {
      userId: user.id,
      username: user.username,
      permissions,
      tokenVersion: user.tokenVersion,
    };
    const signOptions: jwt.SignOptions = { jwtid: jti };
    // exp claim = effectiveExpiresAt'a göre saniye (aynı nowMs tabanı → Session.expiresAt
    // ile birebir hizalı). hasExp=false ise exp claim konmaz (gerçekten süresiz).
    if (hasExp) {
      signOptions.expiresIn = Math.max(
        1,
        Math.floor((effectiveExpiresAt.getTime() - nowMs) / 1000),
      );
    }
    const token = jwt.sign(signPayload, JWT_SECRET, signOptions);

    const payload: JwtPayload = { ...signPayload, jti };
    return { token, user: payload };
  }

  /**
   * Verify and decode a JWT token.
   */
  static verifyToken(token: string): JwtPayload {
    try {
      // F22: algorithms sabitle (HS256) — algoritma-karışıklığı/none saldırısına karşı.
      return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
    } catch {
      throw AppError.unauthorized("Geçersiz veya süresi dolmuş token");
    }
  }

  /**
   * Hash a plain-text password.
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /**
   * Mobil login ekranı için aktif mobil kullanıcı listesi —
   * yalnız `mobile:*`/`mobile:<ekran>` yetkisi olanlar (web kullanıcıları sızdırılmaz).
   */
  static async listMobileUsers(): Promise<
    Array<{ id: string; username: string; fullName: string }>
  > {
    // Emniyet tavanı: mobil login ekranının kullanıcı seçicisi — gerçekte onlarca
    // operatör. `take` ile sınırsız okumayı kapatıyoruz (pratikte hiç dolmaz).
    // F55: getEffectivePermissions ile aynı geçerlilik penceresi — süresi geçmiş/henüz
    // başlamamış mobil izin sahibi listede görünüp login olup 403 (boş izin) almasın.
    const now = new Date();
    // BEYANLI HARİÇ: patron bulutu teknik kullanıcısı (giriş yöntemi yok) kimliksiz listede görünmez — bugün mobil izni
    // taşımadığı için zaten düşer; ama kural "izni yok" değil "teknik hesap" (bekçi `test_bulut_gelen_kutusu`).
    const patronCloudUserId = await readPatronCloudUserId();
    return prisma.user.findMany({
      // Satıcı hesabı tablet giriş listesinde GÖRÜNMEZ. Bugün zaten görünmezdi
      // (mobil GRANT satırı doğmuyor, `["*"]` koddan geliyor) — ama kural
      // "grant'ı yok" değil "sistem hesabı" olmalı: teşhis için tek bir mobil
      // izin verilse liste anında sızardı.
      where: ({
        isActive: true,
        ...(patronCloudUserId ? { NOT: { id: patronCloudUserId } } : {}),
        permissions: {
          some: {
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
            ],
            permission: { code: { startsWith: "mobile:" } },
          },
        },
      }),
      select: { id: true, username: true, fullName: true },
      orderBy: { fullName: "asc" },
      take: 500,
    });
  }

  /**
   * GET /api/auth/me için aktif kullanıcı özeti — pasif/yok ise null.
   */
  static async getActiveUserSummary(
    userId: string
  ): Promise<{ id: string; username: string; fullName: string } | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, fullName: true, isActive: true },
    });
    if (!user || !user.isActive) return null;
    return { id: user.id, username: user.username, fullName: user.fullName };
  }

  /**
   * Bir kullanıcının şu an geçerli efektif permission code'larını döner.
   * validFrom/validUntil pencereleri filtrelenir.
   */
  static async getEffectivePermissions(userId: string): Promise<string[]> {
    // ── SATICI (süperadmin) BYPASS'I — TEK NOKTA ─────────────────────────────
    // Süperadmin bir ROL DEĞİLDİR: rol şablonu uygulaması izinleri kullanıcıya
    // KOPYALAR (`UserPermission` satırı doğar) ve panelin yetki sayacı gizli
    // hesabı sızdırırdı; ayrıca izin kataloğunda `code: "*"` satırı YOKTUR,
    // yani bu değer hiçbir panelden atanamaz — YALNIZ kod üretir.
    //
    // Erken dönüş grant sorgusundan ÖNCE: DB'ye hiç satır yazılmaz, okunmaz.
    // `matchesPermission` (`rbac.middleware.ts`) `*`i ZATEN ilk satırda tanır →
    // bütün `requirePermission`/`requireAnyPermission` kapıları maliyetsiz geçer.
    // Tek çağıran `issueToken` olduğu için bu bir GİRİŞ başına maliyettir.
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAccount: true },
    });
    if (owner?.isSystemAccount) return ["*"];

    const now = new Date();
    const grants = await prisma.userPermission.findMany({
      where: {
        userId,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
      select: { permission: { select: { code: true } } },
    });
    const set = new Set<string>();
    for (const g of grants) set.add(g.permission.code);
    return Array.from(set);
  }
}
