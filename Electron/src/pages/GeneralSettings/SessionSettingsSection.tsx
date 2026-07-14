import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { SAME_TYPE_SESSION_POLICY_OPTIONS } from "@/lib/session-auth";
import { DurationField } from "./DurationField";
import { NumberField, FlagToggle } from "./SettingRow";
import { HintIcon, HintBody, type HintVariant } from "./SettingHint";
import { LoginMethodsField } from "./LoginMethodsField";
import { SessionSettingsReadOnly } from "./SessionSettingsReadOnly";
import {
  MAX_SESSION_MINUTES,
  MAX_IDLE_MINUTES,
  MIN_MOBILE_IDLE_LOCK_MIN,
  MAX_MOBILE_IDLE_LOCK_MIN,
  MAX_ABSOLUTE_CAP_DAYS,
  MIN_PIN_LOCKOUT_ATTEMPTS,
  MAX_PIN_LOCKOUT_ATTEMPTS,
  MIN_PIN_LOCKOUT_PENALTY_SEC,
  MAX_PIN_LOCKOUT_PENALTY_SEC,
  MIN_PIN_LOCKOUT_ESCALATE_AFTER,
  MAX_PIN_LOCKOUT_ESCALATE_AFTER,
  MIN_PIN_LOCKOUT_LONG_PENALTY_MIN,
  MAX_PIN_LOCKOUT_LONG_PENALTY_MIN,
  useSessionSettingsForm,
} from "./useSessionSettingsForm";

/**
 * Oturum & Güvenlik paneli — TEKDÜZE dakika modeli (durum/mantık
 * `useSessionSettingsForm`'da). Yukarıdan aşağı:
 *  1) Oturum süresi (dakika) — DurationField, backend `sessionDurationMinutes`.
 *  2) Token dolunca otomatik çıkış (switch) — client ENFORCE.
 *  3) Panel hareketsizlik çıkışı (bu bilgisayar) — DurationField toggle (0=kapalı).
 *  4) Mobil hareketsizlik kilidi — DurationField toggle (ayrı switch + dakika).
 *  5) Çalışma oturumu zaman aşımı — saha — DurationField toggle (0=kapalı).
 *  6) Aynı tip oturum politikası (select) — backend (login) ENFORCE.
 *  7) Mobil giriş yöntemleri.
 * Tek Kaydet + admin:settings yetkisi ister.
 */
const POLICY_DESC =
  "Aynı kullanıcı aynı tip cihazda (ör. iki bilgisayar ya da iki telefon) ikinci kez giriş yaptığında ne olacağı. Farklı tipler (1 bilgisayar + 1 telefon) her zaman serbesttir. Değişiklik sonraki girişlerde geçerli olur.";

export function SessionSettingsSection() {
  const s = useSessionSettingsForm();
  useRegisterSettingsDirty(s.dirty);
  // Açıklamalar her yerde (i) info balonunda gösterilir.
  const hint: HintVariant = "popover";
  if (s.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <SessionSettingsReadOnly
          sessionMinutes={s.current.sessionMin}
          idleMinutes={s.current.idle}
          autoLogout={s.current.autoLogout}
          policy={s.current.policy}
          workIdleMinutes={s.current.workIdle}
          mobileLock={s.current.mobileLock}
          mobileLockMinutes={s.current.mobileLockMin}
          mobileLockBg={s.current.mobileLockBg}
          methods={s.current.methods}
          absoluteCapDays={s.current.capDays}
          pinLockoutEnabled={s.current.pinEnabled}
          pinLockoutAttempts={s.current.pinAttempts}
          pinLockoutPenaltySec={s.current.pinPenaltySec}
          pinLockoutEscalateAfter={s.current.pinEscalate}
          pinLockoutLongPenaltyMin={s.current.pinLongMin}
        />
      }
    >
      <div className="space-y-5">
        {/* 1) Oturum zaman aşımı — TEK ayar: aç/kapa + süre. Açık: süre dolunca
            sistem OTOMATİK çıkarır. Kapalı: oturum süresiz (zaman aşımı yok);
            toggle kapalıyken dakika input'u da pasifleşir. */}
        <DurationField
          hint={hint}
          label="Oturum zaman aşımı — token ömrü (dakika)"
          desc="Açıkken oturum bu kadar dakika sonra dolar ve sistem kullanıcıyı OTOMATİK çıkarır (mobil + bu bilgisayar). Kapalıyken oturum süresiz olur — zaman aşımıyla çıkış yok (yönetici yine iptal edebilir). Değişiklik yalnızca sonraki girişlere uygulanır; şu an açık oturumlar mevcut süreleriyle devam eder."
          valueMinutes={s.sessionMin}
          onChangeMinutes={s.setSessionMin}
          maxMinutes={MAX_SESSION_MINUTES}
          minMinutes={1}
          toggle={{
            enabled: s.autoLogout,
            onToggle: s.setAutoLogout,
            label: "Token dolunca otomatik çıkış",
          }}
          error={
            s.autoLogout && !s.sessionValid
              ? `1–${MAX_SESSION_MINUTES} arası bir dakika girin.`
              : undefined
          }
        />

        {/* 2) Mutlak oturum tavanı — birim GÜN (dakika değil → NumberField). Zaman
            aşımı kapalı olsa bile token en fazla bu kadar gün yaşar; 0 = süresiz. */}
        <div className="border-t pt-4">
          <NumberField
            hint={hint}
            id="absolute-session-cap-days"
            label="Mutlak oturum tavanı (gün, 0 = süresiz)"
            desc="Oturum zaman aşımı kapalı olsa bile bir token en fazla bu kadar gün geçerli kalır — çalınan/sızan bir token sonsuza kadar kullanılamasın diye. 0 girilirse arka plan tavanı da kalkar (token gerçekten süresiz). Değişiklik yalnızca sonraki girişlere uygulanır."
            value={s.capDays}
            min={0}
            max={MAX_ABSOLUTE_CAP_DAYS}
            onChange={s.setCapDays}
            error={
              !s.capDaysValid ? `0–${MAX_ABSOLUTE_CAP_DAYS} arası bir gün sayısı girin.` : undefined
            }
          />
        </div>

        {/* 3) Panel hareketsizlik çıkışı */}
        <div className="border-t pt-4">
          <DurationField
            hint={hint}
            label="Yönetim paneli hareketsizlik çıkışı süresi"
            desc="Bu bilgisayarda (hangi program açık olursa olsun) bu kadar dakika hiç fare/klavye hareketi olmazsa yönetim paneli oturumu kapanır. Sistem-geneli sayılır: başka programla çalışırken de sayaç sıfırlanır, yalnız kimse bilgisayara hiç dokunmadığında çıkış olur. Ayar tüm panel bilgisayarları için geçerlidir ama her bilgisayar kendi boşta süresini kendi sayar (ayar ortak, çıkış her bilgisayara özeldir). Kapalıyken hareketsizlikle çıkış olmaz. Açık paneller yeni ayarı kısa sürede otomatik alır."
            valueMinutes={s.idleMin}
            onChangeMinutes={s.setIdleMin}
            maxMinutes={MAX_IDLE_MINUTES}
            minMinutes={1}
            toggle={{
              enabled: s.idleEnabled,
              onToggle: s.toggleIdle,
              label: "Yönetim paneli hareketsizlik çıkışı",
            }}
            error={
              s.idleEnabled && !s.idleValid
                ? `1–${MAX_IDLE_MINUTES} arası bir dakika girin.`
                : undefined
            }
          />
        </div>

        {/* 4) Mobil hareketsizlik kilidi */}
        <div className="border-t pt-4">
          <DurationField
            hint={hint}
            label="Mobil kilit süresi"
            desc="Açıkken (varsayılan) tablet/telefon bu kadar dakika kullanılmazsa kilit ekranı gelir; iş oturumu açık kalır, operatör kart/PIN ile hızlıca devam eder. Kapalıyken mobilde hareketsizlik kilidi hiç devreye girmez. Açık tabletler yeni ayarı kısa sürede otomatik alır (uygulama öne gelince); yeni girişlerde hemen geçerli."
            valueMinutes={s.mobileLockMin}
            onChangeMinutes={s.setMobileLockMin}
            maxMinutes={MAX_MOBILE_IDLE_LOCK_MIN}
            minMinutes={MIN_MOBILE_IDLE_LOCK_MIN}
            toggle={{
              enabled: s.mobileLock,
              onToggle: s.setMobileLock,
              label: "Mobil hareketsizlik kilidi",
            }}
            error={
              s.mobileLock && !s.mobileLockMinValid
                ? `${MIN_MOBILE_IDLE_LOCK_MIN}–${MAX_MOBILE_IDLE_LOCK_MIN} arası bir dakika girin.`
                : undefined
            }
          />
        </div>

        {/* 4b) Mobil arka-plan kilidi — uygulamadan çıkınca anında kilit (idle'dan bağımsız) */}
        <div className="border-t pt-4">
          <FlagToggle
            hint={hint}
            title="Uygulamadan çıkınca kilitle (mobil)"
            desc="Açıkken (varsayılan) operatör uygulamadan çıktığı anda (ana ekran / başka uygulama) tablet hemen kilit ekranına geçer — iş oturumu açık kalır, kart/PIN ile devam edilir. Hareketsizlik kilidinden BAĞIMSIZ: kapatırsan uygulamadan çıkınca kilitlenmez, yalnız (açıksa) hareketsizlik süresi dolunca kilitlenir. Uygulamanın kendi açtığı sistem diyalogları (Bluetooth/kamera izni) kilit tetiklemez. Açık tabletler yeni ayarı öne gelince otomatik alır."
            checked={s.mobileLockBg}
            disabled={s.isSaving}
            onChange={s.setMobileLockBg}
          />
        </div>

        {/* 5) Çalışma oturumu zaman aşımı — saha */}
        <div className="border-t pt-4">
          <DurationField
            hint={hint}
            label="Çalışma oturumu zaman aşımı süresi — saha"
            desc="Bir tablet bu kadar dakika hiç kullanılmazsa oradaki iş oturumu otomatik kapanır ve makine yeniden boşa düşer. Operatör bir sonraki işlemde yeniden yer onayı verir. Kapalıyken saha oturumu hareketsizlikle kapanmaz. Değişiklik hemen geçerli — açık oturumlar da yeni süreye göre değerlendirilir."
            valueMinutes={s.workMin}
            onChangeMinutes={s.setWorkMin}
            maxMinutes={MAX_IDLE_MINUTES}
            minMinutes={1}
            toggle={{
              enabled: s.workEnabled,
              onToggle: s.toggleWork,
              label: "Çalışma oturumu zaman aşımı (saha)",
            }}
            error={
              s.workEnabled && !s.workValid
                ? `1–${MAX_IDLE_MINUTES} arası bir dakika girin.`
                : undefined
            }
          />
        </div>

        {/* 6) Aynı tip oturum politikası */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-1.5">
            <label htmlFor="same-type-policy" className="text-sm font-medium">
              Aynı hesap aynı cihaz tipinde ikinci kez açılırsa
            </label>
            <HintIcon variant={hint} desc={POLICY_DESC} />
          </div>
          <HintBody variant={hint} desc={POLICY_DESC} />
          <select
            id="same-type-policy"
            className="mt-2 flex h-9 w-80 max-w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            value={s.policy}
            onChange={(e) => s.setPolicy(e.target.value as SameTypeSessionPolicy)}
          >
            {SAME_TYPE_SESSION_POLICY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* 7) Hızlı PIN + kart deneme kilidi — mobil hızlı giriş (PIN/kart) brute-force
            koruması. Toggle + 4 sayı alanı (adet/sn/tur/dk → NumberField). */}
        <div className="space-y-3 border-t pt-4">
          <FlagToggle
            hint={hint}
            title="Hızlı PIN / kart deneme kilidi"
            desc="Açıkken (varsayılan) sahadaki hızlı PIN veya QR kart girişinde arka arkaya çok sayıda yanlış deneme yapılırsa o cihaz/IP geçici olarak bloklanır — 6 haneli PIN'in denenerek kırılmasını önler. Klasik kullanıcı adı + şifre girişini etkilemez. Kapalıyken deneme kilidi hiç uygulanmaz."
            checked={s.pinEnabled}
            disabled={s.isSaving}
            onChange={s.setPinEnabled}
          />
          {s.pinEnabled && (
            <div className="grid gap-4 pl-1 sm:grid-cols-2">
              <NumberField
                hint={hint}
                id="pin-lockout-attempts"
                label="İzin verilen yanlış deneme"
                desc="Kilit devreye girene kadar art arda kaç yanlış denemeye izin verilir."
                value={s.pinAttempts}
                min={MIN_PIN_LOCKOUT_ATTEMPTS}
                max={MAX_PIN_LOCKOUT_ATTEMPTS}
                onChange={s.setPinAttempts}
                error={
                  !s.pinAttemptsValid
                    ? `${MIN_PIN_LOCKOUT_ATTEMPTS}–${MAX_PIN_LOCKOUT_ATTEMPTS} arası bir sayı girin.`
                    : undefined
                }
              />
              <NumberField
                hint={hint}
                id="pin-lockout-penalty-sec"
                label="Ceza süresi (saniye)"
                desc="Eşik aşılınca cihaz/IP bu kadar saniye bloklanır."
                value={s.pinPenaltySec}
                min={MIN_PIN_LOCKOUT_PENALTY_SEC}
                max={MAX_PIN_LOCKOUT_PENALTY_SEC}
                onChange={s.setPinPenaltySec}
                error={
                  !s.pinPenaltyValid
                    ? `${MIN_PIN_LOCKOUT_PENALTY_SEC}–${MAX_PIN_LOCKOUT_PENALTY_SEC} arası saniye girin.`
                    : undefined
                }
              />
              <NumberField
                hint={hint}
                id="pin-lockout-escalate-after"
                label="Uzun ceza eşiği (tur)"
                desc="Bu kadar kısa ceza turundan sonra uzun cezaya geçilir (ısrarlı deneme)."
                value={s.pinEscalate}
                min={MIN_PIN_LOCKOUT_ESCALATE_AFTER}
                max={MAX_PIN_LOCKOUT_ESCALATE_AFTER}
                onChange={s.setPinEscalate}
                error={
                  !s.pinEscalateValid
                    ? `${MIN_PIN_LOCKOUT_ESCALATE_AFTER}–${MAX_PIN_LOCKOUT_ESCALATE_AFTER} arası tur girin.`
                    : undefined
                }
              />
              <NumberField
                hint={hint}
                id="pin-lockout-long-penalty-min"
                label="Uzun ceza süresi (dakika)"
                desc="Uzun ceza eşiğine varınca cihaz/IP bu kadar dakika bloklanır."
                value={s.pinLongMin}
                min={MIN_PIN_LOCKOUT_LONG_PENALTY_MIN}
                max={MAX_PIN_LOCKOUT_LONG_PENALTY_MIN}
                onChange={s.setPinLongMin}
                error={
                  !s.pinLongValid
                    ? `${MIN_PIN_LOCKOUT_LONG_PENALTY_MIN}–${MAX_PIN_LOCKOUT_LONG_PENALTY_MIN} arası dakika girin.`
                    : undefined
                }
              />
            </div>
          )}
        </div>

        {/* 8) Mobil giriş yöntemleri */}
        <LoginMethodsField
          enabled={s.enabledMethods}
          primary={s.primaryMethod}
          valid={s.methodsValid}
          onToggle={s.toggleMethod}
          onPrimaryChange={s.setPrimaryMethod}
        />

        <SettingsSaveBar
          dirty={s.dirty}
          saving={s.isSaving}
          canSave={s.allValid}
          onSave={s.save}
          onReset={s.reset}
          note="Oturum süresi + same-type politikası backend tarafından uygulanır; panel hareketsizlik çıkışı her panel bilgisayarında kendi başına, mobil kilit sahadaki cihazlarda çalışır. Çalışma oturumu zaman aşımı tüm saha cihazları için backend tarafından uygulanır."
        />
      </div>
    </PermissionGate>
  );
}
