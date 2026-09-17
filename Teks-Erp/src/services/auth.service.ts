// =============================================================================
// TeksERP - Auth Service
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma, ClientType } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, randomInt, randomUUID } from "crypto";
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

/** Login çağrılarının istemci bağlamı — Session registry + aynı-tip politika için.
 *  clientType body'den (default 'mobile'); deviceId x-device-id/req.device'den;
 *  confirmKick 'notify' politikasında "ikisi de açık kalsın" onayı. */
export interface LoginContext {
  clientType?: LoginClientType;
  deviceId?: string | null;
  confirmKick?: boolean;
  /**
   * İstek TÜNEL dinleyicisinden mi geldi (`req.isRemote`). ⚠️ Gövdeden DEĞİL,
   * `remote-access.middleware` tarafından soket portundan çözülür — istemci
   * uyduramaz. `true` ise ikinci faktör (TOTP) ZORUNLUDUR.
   */
  isRemote?: boolean;
  /** Uzak girişte TOTP kodu ya da kurtarma kodu. */
  totpCode?: string;
  /**
   * İstemcinin künye başlığında bildirdiği kendi sürümü — `Session.clientVersion`e
   * yazılır. ⚠️ `isRemote`in TERSİ bir sınıftır: bu değer İSTEMCİDEN gelir ve
   * uydurulabilir, o yüzden hiçbir kapıya/politikaya girmez. Yalnız "sahada
   * hangi sürümler görülüyor" sorusunu cevaplayan bir GÖZLEMdir.
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

/** Personel kartı QR içeriği: TEKSU:<userId>:<32-hex token>. Makine QR'ı ham
 *  makine kodu (MAK-...) taşıdığından prefix çakışması yok. */
const CARD_CODE_RE = /^TEKSU:([0-9a-fA-F-]{36}):([0-9a-fA-F]{32})$/;

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

    // ⚠️ SIRA LOAD-BEARING: ikinci faktör `issueToken`den ÖNCE. `issueToken`
    // oturum kaydı AÇAR ve `kick` politikasında kullanıcının DİĞER oturumlarını
    // düşürür — sonraya bırakılsaydı yalnız parolayı ele geçiren biri, TOTP'yi
    // hiç geçemese bile meşru kullanıcıyı oturumundan atabilirdi.
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
    this.assertNotRemote(ctx);
    const methods = await readLoginMethods();
    if (!methods.enabled.includes("card")) {
      throw AppError.forbidden(
        "Kartla giriş kapalı — Genel Ayarlar'dan giriş yöntemlerine 'QR kart' eklenebilir"
      );
    }
    const m = CARD_CODE_RE.exec((cardCode ?? "").trim());
    if (!m) throw AppError.unauthorized("Geçersiz personel kartı");
    const user = await prisma.user.findFirst({
      where: { id: m[1], cardToken: m[2].toLowerCase(), isActive: true },
      select: { id: true, username: true, tokenVersion: true },
    });
    if (!user) {
      throw AppError.unauthorized("Kart geçersiz veya iptal edilmiş — yöneticiden yeni kart isteyin");
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
    this.assertNotRemote(ctx);
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
    const user = await prisma.user.findFirst({
      where: { quickPin: normalized, isActive: true },
      select: { id: true, username: true, tokenVersion: true },
    });
    if (!user) throw AppError.unauthorized("PIN tanınmadı — yöneticinizden hızlı PIN isteyin");
    return this.issueToken(user, ctx);
  }

  /**
   * Admin: kullanıcıya hızlı PIN ata. `pin` verilirse (6 hane) o kullanılır —
   * BAŞKASINDA varsa 409 (benzersizlik kimliğin temeli); verilmezse çakışmayan
   * rastgele 6 hane üretilir. Düz döner (admin operatöre iletir). Açık oturumlar
   * etkilenmez. `clear=true` → PIN kaldırılır (salt-PIN girişi kapanır).
   */
  static async setQuickPin(
    userId: string,
    input: { pin?: string; clear?: boolean },
    actorUserId?: string
  ): Promise<{ pin: string | null }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isActive: true, quickPin: true },
    });
    if (!user || !user.isActive) throw AppError.notFound("Kullanıcı bulunamadı veya pasif");

    if (input.clear) {
      await prisma.user.update({ where: { id: userId }, data: { quickPin: null } });
      await AuditService.log({
        userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
        recordId: userId, newData: { username: user.username, cleared: true },
      }).catch(() => undefined);
      return { pin: null };
    }

    if (input.pin !== undefined) {
      const manual = input.pin.trim();
      if (!/^\d{6}$/.test(manual)) throw AppError.badRequest("Hızlı PIN 6 haneli rakam olmalı");
      try {
        await prisma.user.update({ where: { id: userId }, data: { quickPin: manual } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict(
            "Bu PIN başka bir kullanıcıda tanımlı — hızlı PIN benzersiz olmalı (farklı bir PIN girin veya rastgele üretin)"
          );
        }
        throw e;
      }
      await AuditService.log({
        userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
        recordId: userId, newData: { username: user.username, rotated: user.quickPin != null },
      }).catch(() => undefined);
      return { pin: manual };
    }

    // Rastgele üret — P2002'de yeniden dene (1M kombinasyonda çakışma nadir).
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = String(randomInt(0, 1_000_000)).padStart(6, "0");
      try {
        await prisma.user.update({ where: { id: userId }, data: { quickPin: candidate } });
        await AuditService.log({
          userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
          recordId: userId, newData: { username: user.username, rotated: user.quickPin != null },
        }).catch(() => undefined);
        return { pin: candidate };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    throw AppError.internal("Benzersiz PIN üretilemedi — tekrar deneyin");
  }

  /**
   * Admin: personel kartı sırrını üret/YENİLE (rotasyon). Yeni 32-hex token yazılır;
   * dönen cardCode QR olarak basılır. Eski kart anında geçersiz. Açık JWT oturumları
   * ETKİLENMEZ (tokenVersion bump yok — yalnız kart kimliği değişir).
   */
  static async rotateCardToken(
    userId: string,
    actorUserId?: string
  ): Promise<{ cardCode: string; rotated: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isActive: true, cardToken: true },
    });
    if (!user || !user.isActive) throw AppError.notFound("Kullanıcı bulunamadı veya pasif");
    const token = randomBytes(16).toString("hex"); // 32-hex
    await prisma.user.update({ where: { id: userId }, data: { cardToken: token } });
    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "USER_CARD_TOKEN",
      recordId: userId,
      newData: { username: user.username, rotated: user.cardToken != null },
    }).catch(() => undefined);
    return { cardCode: `TEKSU:${user.id}:${token}`, rotated: user.cardToken != null };
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
   * Admin: kullanıcının mobil kimlik bilgilerini OKU — hızlı PIN + QR kart kodu.
   * Panel bunları HER ZAMAN gösterir (kart QR sürekli görünür, mevcut PIN görünür).
   * GÜVENLİK: her ikisi de düz saklandığından geri okunabilir; bu uç yalnız
   * admin:users yetkisiyle çağrılır ("bu ekranı yalnız yönetici görür" kararı).
   */
  static async getUserCredentials(
    userId: string
  ): Promise<{ quickPin: string | null; cardCode: string | null }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, quickPin: true, cardToken: true },
    });
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");
    return {
      quickPin: user.quickPin,
      cardCode: user.cardToken ? `TEKSU:${user.id}:${user.cardToken}` : null,
    };
  }

  /** JWT üretimi — login/loginWithCard/loginWithQuickPin'in ortak çıkışı. Session
   *  registry'ye kayıt açar (aynı-tip politikası burada uygulanır) ve jti'yi jwtid
   *  olarak token'a gömer → middleware anlık iptal kontrolü yapabilir. 'notify'
   *  politikası + onaysız çakışma → openLoginSession 409 SESSION_EXISTS fırlatır. */
  /**
   * UZAK GİRİŞTE İKİNCİ FAKTÖR KAPISI. LAN'da tam no-op.
   *
   * Üç sonuç, üçü de FARKLI HTTP kodu — çünkü giriş kilidi yalnız **401**'i
   * kaba kuvvet sayar (`auth.controller` F49 kuralı):
   *   • 403 TOTP_ENROLLMENT_REQUIRED → kurulum yok. Kimlik denemesi DEĞİL.
   *   • 409 TOTP_REQUIRED → kod istendi. Kimlik denemesi DEĞİL (istemci kodu
   *     ekleyip aynı uca tekrar POST eder).
   *   • 401 TOTP_INVALID → yanlış kod. Kaba kuvvet SAYILIR ve sayılmalıdır:
   *     TOTP uzayı yalnız 10^6'dır, kilit olmadan çevrimiçi tahmin edilebilirdi.
   */
  private static async assertSecondFactor(userId: string, ctx?: LoginContext): Promise<void> {
    if (!ctx?.isRemote) return;

    const status = await TotpAccountService.getStatus(userId);
    if (!status.enabled) {
      throw AppError.forbidden(
        "Uzaktan erişim için iki adımlı doğrulama kurulmalı. " +
          "Yöneticinizden kurulum bağlantısı isteyin.",
        { code: "TOTP_ENROLLMENT_REQUIRED" },
      );
    }

    const code = (ctx.totpCode ?? "").trim();
    if (!code) {
      throw AppError.conflict("Doğrulama kodu gerekli.", { code: "TOTP_REQUIRED" });
    }
    if (!(await TotpAccountService.verifySecondFactor(userId, code))) {
      throw AppError.unauthorized("Doğrulama kodu geçersiz.", { code: "TOTP_INVALID" });
    }
  }

  /**
   * PIN/kart girişini uzakta reddet — `remote-access.middleware`in İKİNCİ HATTI.
   *
   * Kenar denylist'i (middleware) birincil kapıdır; burası, o kapı bir refactor
   * ya da yanlış mount sırası yüzünden düşerse devreye girer. `notFound`
   * seçilmesi bilinçli: middleware ile AYNI cevabı vererek "bu uç uzakta var mı"
   * sorusunu cevapsız bırakır.
   */
  private static assertNotRemote(ctx?: LoginContext): void {
    if (ctx?.isRemote) throw AppError.notFound("Kaynak bulunamadı");
  }

  private static async issueToken(
    user: {
      id: string;
      username: string;
      tokenVersion: number;
    },
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const permissions = await this.getEffectivePermissions(user.id);

    // Masaüstü (Electron VE web paneli) girişi: kullanıcının en az bir MASAÜSTÜ
    // (mobil-olmayan) izni olmalı. Yalnız mobil izinli (mobile:*) hesap panele
    // giremez → 403, token BİLE üretilmez. Mobil girişte bu kısıt yok.
    if (
      isDesktopClient(ctx?.clientType) &&
      !permissions.some((p) => !p.startsWith("mobile:"))
    ) {
      throw AppError.forbidden(
        "Bu hesabın masaüstü paneline erişimi yok. Yalnızca mobil uygulamada kullanılabilir.",
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
    return prisma.user.findMany({
      // Satıcı hesabı tablet giriş listesinde GÖRÜNMEZ. Bugün zaten görünmezdi
      // (mobil GRANT satırı doğmuyor, `["*"]` koddan geliyor) — ama kural
      // "grant'ı yok" değil "sistem hesabı" olmalı: teşhis için tek bir mobil
      // izin verilse liste anında sızardı.
      where: ({
        isActive: true,
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
