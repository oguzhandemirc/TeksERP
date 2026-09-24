import { useEffect, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAuthStore } from "@/store/auth";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type FeatureFlags } from "@/services/featureFlagService";
import { systemSettingService } from "@/services/systemSettingService";
import type {
  EnumFlagDef,
  TextFlagDef,
  FlagDef,
  NumberFlagDef,
  NumberFlagKey,
  SettingFieldDef,
} from "./settings-config";
import { InfoPopover, Vurgu } from "./SettingHint";
import { FlagToggle, ReadOnlyRow, SettingMeta } from "./SettingRow";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { SettingsGroupCard } from "./SettingsGroupCard";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { isSettingRowVisible, type SettingsSearchHit } from "./settings-groups";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";

/**
 * Bir kategorinin özellik anahtarlarını config'ten render eder — TEK kaydetme
 * standardı: tüm toggle'lar TASLAK tutulur, alttaki "Kaydet" (SettingsSaveBar)
 * hepsini birden yazar (anında-kayıt YOK).
 *
 * ÜÇ ayrı yazma yolu tek Kaydet altında toplanır ve bu bilinçlidir — ayrı
 * "Kaydet" düğmeleri "hangisi neyi yazdı" karışıklığıydı:
 *   1) boolean feature-flag'ler  → PATCH /api/feature-flags
 *   2) sayısal feature-flag'ler  → aynı PATCH (tek istek)
 *   3) `settingFields`           → PUT /api/admin/settings/:key (feature-flag
 *      sözleşmesinin DIŞINDAKİ ham system-setting satırları; bkz.
 *      `SettingFieldDef` gerekçesi)
 */
export function FeatureFlagSection({
  flags,
  numberFlags = [],
  enumFlags = [],
  textFlags = [],
  settingFields = [],
  superadminOnly = false,
  writePermissions = [SETTINGS_ADMIN_PERMISSION],
  moduleClosed = false,
  moduleLabel,
  searchHit,
  searchQuery,
}: {
  flags: FlagDef[];
  /** Sekmeye gömülü SAYISAL feature-flag alanları — toggle'larla AYNI taslak +
   *  AYNI PATCH'te yazılır. */
  numberFlags?: NumberFlagDef[];
  /** Kapalı kümeli (enum) feature-flag satırları — toggle'larla AYNI taslak +
   *  AYNI PATCH. Ayrı bir kaydetme yolu açmak "iki Kaydet, hangisi neyi yazdı"
   *  karışıklığıydı (üç yazma yolunun tek Kaydet altında toplanma gerekçesi). */
  enumFlags?: EnumFlagDef[];
  textFlags?: TextFlagDef[];
  /** Ham system-setting sayısal alanları — aynı Kaydet, ayrı uç. */
  settingFields?: SettingFieldDef[];
  /** Kategori yalnız satıcı (süperadmin) hesabına YAZILIR — bkz.
   *  `SettingsCategory.superadminOnly`. Görünürlüğü etkilemez. */
  superadminOnly?: boolean;
  /** Yazma izni — kategorinin `permissionAny`si; verilmezse `admin:settings`. */
  writePermissions?: string[];
  /**
   * Bu kategorinin MODÜLÜ bu kurulumda kapalı → satırlar salt-okunur (bkz.
   * `SettingsCategory.moduleKey`).
   *
   * ⚠️ 2026-09-04 — BU BANDIN İZLEYİCİSİ ARTIK SATICIDIR. Fabrika yöneticisi
   * kapalı modülün satırlarını hiç görmez: süzgeç ÇAĞIRANDA
   * (`SettingsSurfacePage` → `filterCategoryByModules`) ve satırı olmayan
   * kategori hiç çizilmez. Buraya `moduleClosed` ile gelen bir kategori, ancak
   * satıcı görünümünde (`isSuperadminGateOpen`) çizilir — bant orada "dondu,
   * Sistem → Modüller'den açılır" der. Bileşen İÇİNDE ikinci bir görünürlük
   * süzgeci YOK: taslak/Kaydet gövdesi gelen dizilerden türetiliyor.
   */
  moduleClosed?: boolean;
  /** Bandın adıyla söyleyeceği modül ("Ticaret" · "Üretim" …). */
  moduleLabel?: string;
  /** Arama açıksa bu kategorinin eşleşme fotoğrafı; yoksa tüm satırlar çizilir. */
  searchHit?: SettingsSearchHit;
  /** Arama metni — eşleşen kelimeler satırlarda vurgulanır. */
  searchQuery?: string;
}) {
  const qc = useQueryClient();
  const { hasAnyPermission } = useRoleAccess();
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  // ⚠️ İZİN ve KİMLİK ÇARPILIR, birinin yerine geçmez: satıcı hesabı zaten
  // `["*"]` taşıdığı için `hasPermission` onda da true'dur, ama izinsiz bir
  // kullanıcının kimlik kapısından geçmesi diye bir şey olmamalı.
  //
  // ⚠️ SUPAP (`!systemAccountExists`) backend `flagWriteGuard`ın üçüncü dalıyla
  // AYNI kaynaktan beslenir: sistem hesabı HİÇ doğmamış bir kurulumda modül
  // anahtarları BUGÜNKÜ gibi `admin:settings` ile yazılır — yoksa süperadminsiz
  // her kurulum, kendi modüllerini bir daha açamayacak şekilde KİLİTLENİRDİ.
  // Ayrışırlarsa arıza sessizdir (panel yazılabilir çizer, sunucu 403 verir).
  const superadminGateOpen = isSuperadminGateOpen({ isSystemAccount, systemAccountExists });
  const hasSettingsPermission = hasAnyPermission(writePermissions);
  const canEdit = hasSettingsPermission && (!superadminOnly || superadminGateOpen) && !moduleClosed;
  /** Salt-okunur SEBEBİ kimlik kapısı mı (izin eksikliği değil)? */
  const lockedBySuperadmin = superadminOnly && !superadminGateOpen && hasSettingsPermission;
  /** …yoksa modülün kapalı olması mı? */
  const lockedByModule = moduleClosed && hasSettingsPermission;
  // ⚠️ BANT TEKİL DEĞİL LİSTE: iki sebep AYNI ANDA doğru olabilir (satıcıya ait
  // bir kategori + kapalı modül). Tek bant çizilseydi kullanıcı ilkini görüp
  // düzeltir, sonra ikincisine çarpardı — "sebebi hiçbir yerde yazmıyor"
  // arızasının taksitli hâli.
  const lockNotes: string[] = [];
  if (lockedBySuperadmin) {
    lockNotes.push(
      "Bu anahtarları yalnız sistem yöneticisi değiştirir. Modül açma/kapatma talebiniz için yazılım firmanıza başvurun.",
    );
  }
  // ⚠️ SUPAP DEVREDE — bilgi bandı (kilit DEĞİL, tersine: kilidin AÇIK olma
  //    sebebi). Sistem hesabı hiç kurulmamışsa satıcıya ait anahtarları
  //    fabrika yöneticisi yönetebilir; yoksa kurulum modülleri bir daha
  //    açamazdı. 2026-09-04'te modül anahtarları TEK ekrana taşındı (Sistem →
  //    Modüller) ve o ekranın GÖRÜNÜRLÜK kapısı da supaplı oldu — yani supap
  //    açıkken fabrika yöneticisi hem sayfayı görür hem yazar.
  if (superadminOnly && hasSettingsPermission && !isSystemAccount && !systemAccountExists) {
    lockNotes.push(
      "Sistem yöneticisi hesabı bu kurulumda henüz tanımlı değil — o güne kadar bu anahtarları yönetici değiştirebilir.",
    );
  }
  if (lockedByModule) {
    // ⚠️ METİN "ETKİSİZ" DEMEZ ve bu ÖLÇÜLMÜŞ bir kısıttır: tasarımın "modül
    // kapalıyken alt bayrak hiç okunmaz" tek-resolver kuralı (§3.6) backend'de
    // HENÜZ YOK — üretim kapalı bir kurulumda `kk1DuplicateGuardEnabled` hâlâ
    // `/api/rolls` üzerinden koşuyor. "Bu ayarın etkisi yok" cümlesi bugün bir
    // YALAN olurdu; bandın söylediği şey yalnız DONDUĞU ve nasıl çözüleceğidir.
    lockNotes.push(
      `${moduleLabel ?? "Bu"} modülü bu kurulumda kapalı — bu ayarlar dondu; modül açılınca yeniden düzenlenebilir. Sistem → Modüller ekranından açılır.`,
    );
  }

  const flagsQ = useFeatureFlags();
  const server = flagsQ.data?.data;

  // Ham system-setting alanları — yalnız bu kategoride varsa çekilir.
  const sysQ = useQuery({
    queryKey: ["system-settings"],
    queryFn: systemSettingService.list,
    staleTime: 60_000,
    enabled: settingFields.length > 0,
  });
  const serverFieldFor = useMemo(() => {
    const rows = sysQ.data?.data ?? [];
    return (f: SettingFieldDef): number => {
      const raw = rows.find((s) => s.key === f.key)?.value;
      const n = raw != null ? Number(raw) : NaN;
      // ÜST SINIR bilerek SORULMAZ: input `max` ile kırpar ama GÖSTERİM kırpmaz.
      // Sunucuda paneldeki tavanın üstünde bir değer varsa (ham uçtan yazılmış
      // olabilir) onu `fallback`e düşürmek, ekranda YANLIŞ bir sayı basmak olurdu
      // — "500 kayıtlı, ekran 5 diyor" sınıfı sessiz yalan. Aynı yazım, taşınan
      // termin alanlarının 2026-08-15 öncesindeki davranışıyla birebir.
      return Number.isFinite(n) && n >= f.min ? n : f.fallback;
    };
  }, [sysQ.data]);

  // Taslak: bu bölümdeki flag'ler + sayısal flag'ler + ham ayarlar. Sunucu değeri
  // değişince eşitlenir (kaydetme sonrası invalidate → taslak yeni değere döner).
  const flagKeys = flags.map((f) => f.key);
  const serverFlagStr = JSON.stringify(flagKeys.map((k) => server?.[k] ?? false));
  const [flagDraft, setFlagDraft] = useState<Record<string, boolean>>({});
  // ⚠️ İKİ SAYISAL MEKANİZMA YAN YANA (merge, 2026-09-01) ve ikisi de KULLANIMDA:
  //  ① `FlagDef.numberField` — bir bayrağın İÇİNE gömülü eşik (bayrak açıksa
  //     anlamlı olan sayı; boş = "eşik yok" → null). Taslağı METİN tutulur.
  //  ② `numberFlags` / `settingFields` — bağımsız sayısal satırlar (sayı taslağı).
  // Termin alanının HEAD'deki özel kodu (`deadlineDraft`) DÜŞTÜ: `settingFields`
  // onu genelleştirdi ve `serverDeadline`/`meta` artık tanımlı değil.
  // `numberField` taşıyan flag'lerin sayısal taslağı — METİN olarak tutulur:
  // kullanıcı alanı boşaltırken ara durumda sayıya zorlamak imleci zıplatır.
  // Boş metin = "eşik girilmemiş" (null) demektir ve backend'e null gider.
  const numberKeys = flags.map((f) => f.numberField?.numberKey).filter(Boolean) as NumberFlagKey[];
  const serverNumberStr = JSON.stringify(numberKeys.map((k) => server?.[k] ?? null));
  const [numberDraft, setNumberDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const k of numberKeys) {
      const v = server?.[k] ?? null;
      next[k] = v == null ? "" : String(v);
    }
    setNumberDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverNumberStr]);
  /** Taslak metni sunucu sözleşmesine çevirir: boş/geçersiz → null (kural inert). */
  const parseNumberDraft = (raw: string | undefined): number | null => {
    const n = parseFloat((raw ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const k of flagKeys) next[k] = server?.[k] ?? false;
    setFlagDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFlagStr]);

  const serverNumFor = (f: NumberFlagDef): number => {
    const v = server?.[f.key];
    return typeof v === "number" && Number.isFinite(v) ? v : f.fallback;
  };
  const serverNumStr = JSON.stringify(numberFlags.map((f) => serverNumFor(f)));
  const [numDraft, setNumDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const f of numberFlags) next[f.key] = serverNumFor(f);
    setNumDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverNumStr]);

  // ENUM taslağı — sunucudaki metin doğrudan tutulur. `?? defaultValue` yazımı
  // load-bearing: bayrak henüz yüklenmemişken (ilk render) boş string seçilirse
  // <select> "kontrolsüz→kontrollü" uyarısı verir ve daha kötüsü, kullanıcı hiç
  // dokunmadan "değişti" sayılıp yanlış bir değer kaydedilebilirdi.
  const serverEnumFor = (f: EnumFlagDef): string => {
    const v = server?.[f.enumKey];
    return typeof v === "string" && f.options.some((o) => o.value === v) ? v : f.defaultValue;
  };
  // SERBEST METİN taslağı (2026-09-22) — enum ile aynı kalıp, ayrı küme.
  const serverTextFor = (f: TextFlagDef): string => {
    const v = server?.[f.textKey];
    return typeof v === "string" ? v : f.defaultValue;
  };
  const serverTextStr = JSON.stringify(textFlags.map((f) => serverTextFor(f)));
  const [textDraft, setTextDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of textFlags) next[f.textKey] = serverTextFor(f);
    setTextDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTextStr]);
  const textDirty = textFlags.some((f) => (textDraft[f.textKey] ?? serverTextFor(f)) !== serverTextFor(f));
  // Sınırı aşan metin Kaydet'i kapatır (sunucu zod'u ikinci kapı).
  const freeTextValid = textFlags.every((f) => {
    const v = textDraft[f.textKey] ?? "";
    return v.length <= f.maxLength && f.pattern.test(v);
  });
  const serverEnumStr = JSON.stringify(enumFlags.map((f) => serverEnumFor(f)));
  const [enumDraft, setEnumDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of enumFlags) next[f.enumKey] = serverEnumFor(f);
    setEnumDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverEnumStr]);

  const serverFieldStr = JSON.stringify(settingFields.map((f) => serverFieldFor(f)));
  const [fieldDraft, setFieldDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const f of settingFields) next[f.key] = serverFieldFor(f);
    setFieldDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFieldStr]);

  const flagsDirty = flagKeys.some((k) => (flagDraft[k] ?? false) !== (server?.[k] ?? false));
  const numbersDirty = numberKeys.some(
    (k) => parseNumberDraft(numberDraft[k]) !== (server?.[k] ?? null),
  );
  // Sayısal alan aralık DIŞINDAysa kaydetme kapanır (backend zaten 400 verir —
  // kullanıcıyı sunucuya kadar götürmeden söyle).
  const numbersValid = flags.every((f) => {
    if (!f.numberField) return true;
    const v = parseNumberDraft(numberDraft[f.numberField.numberKey]);
    return v === null || (v >= f.numberField.min && v <= f.numberField.max);
  });
  const numDirty = numberFlags.some((f) => (numDraft[f.key] ?? serverNumFor(f)) !== serverNumFor(f));
  const fieldDirty = settingFields.some(
    (f) => (fieldDraft[f.key] ?? serverFieldFor(f)) !== serverFieldFor(f),
  );
  const enumDirty = enumFlags.some(
    (f) => (enumDraft[f.enumKey] ?? serverEnumFor(f)) !== serverEnumFor(f),
  );
  const dirty = flagsDirty || numbersDirty || numDirty || enumDirty || fieldDirty || textDirty;
  const numValid = numberFlags.every((f) => {
    const v = numDraft[f.key];
    return v === undefined || (Number.isFinite(v) && v >= f.min && v <= f.max);
  });
  const fieldValid = settingFields.every((f) => {
    const v = fieldDraft[f.key];
    return v === undefined || (Number.isFinite(v) && v >= f.min && v <= f.max);
  });
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: async () => {
      const patch: Partial<FeatureFlags> = {};
      for (const k of flagKeys) {
        const v = flagDraft[k] ?? false;
        if (v !== (server?.[k] ?? false)) (patch as Record<string, boolean>)[k] = v;
      }
      // Sayısal alanlar AYNI PATCH'e girer (ayrı istek değil): tek Kaydet, tek
      // yazım — bayrak yazılıp eşik yazılamazsa "açık ama etkisiz" ara durum
      // kalıcı olurdu.
      for (const k of numberKeys) {
        const v = parseNumberDraft(numberDraft[k]);
        if (v !== (server?.[k] ?? null)) (patch as Record<string, number | null>)[k] = v;
      }
      for (const f of numberFlags) {
        const v = numDraft[f.key];
        if (v !== undefined && v !== serverNumFor(f)) {
          (patch as Record<string, number>)[f.key] = v;
        }
      }
      for (const f of enumFlags) {
        const v = enumDraft[f.enumKey];
        if (v !== undefined && v !== serverEnumFor(f)) {
          (patch as Record<string, string>)[f.enumKey] = v;
        }
      }
      for (const f of textFlags) {
        const v = textDraft[f.textKey];
        if (v !== undefined && v !== serverTextFor(f)) {
          (patch as Record<string, string>)[f.textKey] = v;
        }
      }
      if (Object.keys(patch).length > 0) await featureFlagService.update(patch);
      for (const f of settingFields) {
        const v = fieldDraft[f.key];
        if (v !== undefined && v !== serverFieldFor(f)) {
          await systemSettingService.upsert(f.key, String(v), f.savedDesc);
        }
      }
    },
    onSuccess: () => {
      toast.success("Ayarlar kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      if (settingFields.length > 0) void qc.invalidateQueries({ queryKey: ["system-settings"] });
    },
  });

  const reset = () => {
    const next: Record<string, boolean> = {};
    for (const k of flagKeys) next[k] = server?.[k] ?? false;
    setFlagDraft(next);
    const nextNums: Record<string, string> = {};
    for (const k of numberKeys) {
      const v = server?.[k] ?? null;
      nextNums[k] = v == null ? "" : String(v);
    }
    setNumberDraft(nextNums);
    const nextNum: Record<string, number> = {};
    for (const f of numberFlags) nextNum[f.key] = serverNumFor(f);
    setNumDraft(nextNum);
    const nextEnum: Record<string, string> = {};
    for (const f of enumFlags) nextEnum[f.enumKey] = serverEnumFor(f);
    setEnumDraft(nextEnum);
    const nextText: Record<string, string> = {};
    for (const f of textFlags) nextText[f.textKey] = serverTextFor(f);
    setTextDraft(nextText);
    const nextField: Record<string, number> = {};
    for (const f of settingFields) nextField[f.key] = serverFieldFor(f);
    setFieldDraft(nextField);
  };

  if (flagsQ.isLoading || (settingFields.length > 0 && sysQ.isLoading)) {
    return <Skeleton className="h-12 w-full" />;
  }

  // Arama açıkken yalnız eşleşen satırlar çizilir; kategori kimliği eşleştiyse
  // (`wholeCategory`) hepsi görünür — yüklem saf katmanda, bkz. settings-groups.
  const shownFlags = flags.filter((f) => isSettingRowVisible(searchHit, f.key));
  const shownNumberFlags = numberFlags.filter((f) => isSettingRowVisible(searchHit, f.key));
  const shownEnumFlags = enumFlags.filter((f) => isSettingRowVisible(searchHit, f.enumKey));
  const shownSettingFields = settingFields.filter((f) => isSettingRowVisible(searchHit, f.key));
  const shownTextFlags = textFlags.filter((f) => isSettingRowVisible(searchHit, f.textKey));

  // GRUPLAMA (2026-09-22): aç/kapa · seçim · sayı satırları TEK listede, `group` adına
  // göre kümelenir (ilk görülme sırası); grupsuz satırlar "Genel" altında. Her grup
  // katlanabilir bir kart — kullanıcı "bayraklar çok fazla" dedi.
  type Row = { kind: "flag"; def: FlagDef } | { kind: "enum"; def: EnumFlagDef } | { kind: "text"; def: TextFlagDef } | { kind: "number"; def: NumberFlagDef } | { kind: "field"; def: SettingFieldDef };
  const groups: { name: string; items: Row[] }[] = [];
  const grubaKoy = (name: string | undefined, item: Row) => {
    const ad = name ?? "Genel";
    const g = groups.find((x) => x.name === ad);
    if (g) g.items.push(item);
    else groups.push({ name: ad, items: [item] });
  };
  for (const f of shownFlags) grubaKoy(f.group, { kind: "flag", def: f });
  for (const f of shownEnumFlags) grubaKoy(f.group, { kind: "enum", def: f });
  for (const f of shownTextFlags) grubaKoy(f.group, { kind: "text", def: f });
  for (const f of shownNumberFlags) grubaKoy(undefined, { kind: "number", def: f });
  for (const f of shownSettingFields) grubaKoy(undefined, { kind: "field", def: f });

  /** Salt-okunur satırın altına yazılacak SEBEP — bant ile aynı sırayla. */
  const readOnlyReason: string | undefined = lockedByModule
    ? `${moduleLabel ?? "Bu"} modülü kapalı — ayar dondu.`
    : lockedBySuperadmin
      ? "Bu anahtarı yalnız sistem yöneticisi değiştirir."
      : undefined;

  const renderRow = (flag: FlagDef) => {
    const checked = flagDraft[flag.key] ?? server?.[flag.key] ?? false;
    return (
      <div key={flag.key} className="py-3 first:pt-0 last:pb-0">
        {canEdit ? (
          <FlagToggle
            title={flag.title}
            summary={flag.summary}
            highlight={searchQuery}
            desc={flag.desc}
            defaultOn={flag.defaultOn}
            audience={flag.audience}
            checked={checked}
            disabled={mut.isPending}
            onChange={(v) => setFlagDraft((d) => ({ ...d, [flag.key]: v }))}
            compact
          />
        ) : (
          <ReadOnlyRow
            title={flag.title}
            enabled={server?.[flag.key] ?? false}
            // ⚠️ Satır ile bant AYNI teşhisi basar; sabit izin cümlesi burada
            // üçüncü bir yalan olurdu (bkz. `ReadOnlyRow` gerekçesi).
            reason={readOnlyReason}
          />
        )}
        {/* Canlı bilgi bloğu (opsiyonel) — statik `desc`'ten farkı sunucudan okunan
            bir DEĞERİ göstermesi. Bileşen gösterecek şey yoksa kendisi null döner.
            TASLAK değil SUNUCU değerine bakar: gösterge kaydedilmiş durumu anlatır,
            kaydedilmemiş bir toggle'ın vaadini değil. */}
        {flag.hint && (server?.[flag.key] ?? false) ? <flag.hint /> : null}
        {/* Sayısal eşik — TASLAK toggle'a bakar (sunucuya değil): kullanıcı
            anahtarı açar açmaz eşiği girebilmeli, önce kaydetmek zorunda
            kalmamalı. Kapalıyken çizilmez (kullanılmayan alan gürültüdür). */}
        {flag.numberField && checked ? (
          canEdit ? (
            <div className="mt-3 space-y-1.5 pl-1">
              <label className="text-xs font-medium">{flag.numberField.label}</label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={flag.numberField.min}
                  max={flag.numberField.max}
                  value={numberDraft[flag.numberField.numberKey] ?? ""}
                  disabled={mut.isPending}
                  onChange={(e) =>
                    setNumberDraft((d) => ({
                      ...d,
                      [flag.numberField!.numberKey]: e.target.value,
                    }))
                  }
                  className="w-28 text-center tabular-nums"
                />
                <span className="text-xs text-muted-foreground">{flag.numberField.unit}</span>
              </div>
              {parseNumberDraft(numberDraft[flag.numberField.numberKey]) === null ? (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {flag.numberField.emptyWarning}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 pl-1 text-sm">
              <span className="text-xs text-muted-foreground">{flag.numberField.label}: </span>
              <span className="font-semibold">
                {server?.[flag.numberField.numberKey] ?? "—"} {flag.numberField.unit}
              </span>
            </div>
          )
        ) : null}
      </div>
    );
  };

  /**
   * ENUM satırı — başlık + tek cümle özet + <select> + seçili seçeneğin gerekçesi.
   *
   * Salt-okunur dalda düğme DEĞİL DEĞER basılır: gri bir <select> "değiştirilebilir"
   * vaat eder (belge tasarım izni dersinin ikizi — olmayan bir yolu gösterme).
   */
  const renderEnum = (f: EnumFlagDef) => {
    const value = enumDraft[f.enumKey] ?? serverEnumFor(f);
    const selected = f.options.find((o) => o.value === value);
    const defaultLabel =
      f.options.find((o) => o.value === f.defaultValue)?.label ?? f.defaultValue;
    return (
      <div key={f.enumKey} className="flex items-center justify-between gap-4">
        {/* Uzun açıklama + künye (i) balonunda (2026-09-07 / 2026-09-22): satırda yalnız
            başlık + tek cümle; seçim sağda, iOS anahtarla aynı hizada. */}
        <div className="min-w-0 space-y-0.5 text-sm">
          <div className="flex items-center gap-1.5 font-medium">
            <span><Vurgu text={f.title} query={searchQuery} /></span>
            <InfoPopover
              desc={
                <div className="space-y-2">
                  <SettingMeta defaultLabel={`Varsayılan: ${defaultLabel}`} audience={f.audience} />
                  {f.desc ? <div>{f.desc}</div> : null}
                  {selected?.hint ? <p className="text-xs"><span className="font-medium">Seçili:</span> {selected.hint}</p> : null}
                </div>
              }
            />
          </div>
          <p className="text-xs text-muted-foreground"><Vurgu text={f.summary} query={searchQuery} /></p>
        </div>
        {canEdit ? (
          <select
            value={value}
            disabled={mut.isPending}
            onChange={(e) => setEnumDraft((d) => ({ ...d, [f.enumKey]: e.target.value }))}
            className="h-9 w-56 shrink-0 rounded-md border bg-background px-2 text-sm"
            aria-label={f.title}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="shrink-0 text-sm font-semibold">{selected?.label ?? value}</div>
        )}
      </div>
    );
  };

  /** SERBEST METİN satırı — başlık + özet, sağda <input>; sınır aşılırsa uyarı ve Kaydet kapalı. */
  const renderText = (f: TextFlagDef) => {
    const value = textDraft[f.textKey] ?? serverTextFor(f);
    const valid = value.length <= f.maxLength && f.pattern.test(value);
    return (
      <div key={f.textKey} className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-0.5 text-sm">
          <div className="flex items-center gap-1.5 font-medium">
            <span><Vurgu text={f.title} query={searchQuery} /></span>
            <InfoPopover
              desc={
                <div className="space-y-2">
                  <SettingMeta defaultLabel={`Varsayılan: ${f.defaultValue || "boş"}`} audience={f.audience} />
                  <div>{f.desc}</div>
                </div>
              }
            />
          </div>
          <p className="text-xs text-muted-foreground"><Vurgu text={f.summary} query={searchQuery} /></p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <Input
              value={value}
              maxLength={f.maxLength}
              placeholder={f.placeholder}
              disabled={mut.isPending}
              onChange={(e) => setTextDraft((d) => ({ ...d, [f.textKey]: e.target.value }))}
              className="h-9 w-56 font-mono"
              aria-label={f.title}
            />
            {!valid && <span className="text-[11px] text-destructive">{f.invalidHint}</span>}
          </div>
        ) : (
          <div className="shrink-0 font-mono text-sm font-semibold">{value || "—"}</div>
        )}
      </div>
    );
  };

  const renderNumber = (
    f: NumberFlagDef | SettingFieldDef,
    value: number,
    serverValue: number,
    onChange: (n: number) => void,
  ) => (
    <div key={f.key} className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <span><Vurgu text={f.title} query={searchQuery} /></span>
        <InfoPopover
          desc={
            <div className="space-y-2">
              <SettingMeta defaultLabel={`Varsayılan: ${f.fallback}${f.unit ? ` ${f.unit}` : ""}`} audience={f.audience} />
              {f.desc ? <div>{f.desc}</div> : null}
            </div>
          }
        />
      </div>
      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            type="number"
            min={f.min}
            max={f.max}
            step={"step" in f ? (f.step ?? 1) : 1}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(f.max, Math.max(f.min, n)));
            }}
            className="w-24 text-center tabular-nums"
          />
          {f.unit && <span className="text-xs text-muted-foreground">{f.unit}</span>}
        </div>
      ) : (
        <div className="shrink-0 text-sm font-semibold">
          {serverValue}
          {f.unit ? ` ${f.unit}` : ""}
        </div>
      )}
    </div>
  );

  const nothingShown =
    shownFlags.length === 0 &&
    shownTextFlags.length === 0 &&
    shownNumberFlags.length === 0 &&
    shownEnumFlags.length === 0 &&
    shownSettingFields.length === 0;

  return (
    <div>
      {/* Kilit BANTLARI — "değişiklik neden kaydedilmiyor" sorusunun tek cevabı
          bunlar. Sadece disabled toggle çizmek sebebi hiçbir yerde söylemezdi.
          LİSTE olması load-bearing: iki sebep aynı anda doğru olabilir. */}
      {lockNotes.map((note) => (
        <div
          key={note}
          role="note"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {note}
        </div>
      ))}
      {nothingShown && (
        <p className="text-sm text-muted-foreground">Bu bölümde arama ile eşleşen ayar yok.</p>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <SettingsGroupCard
            key={g.name}
            name={g.name}
            highlight={searchQuery}
            count={g.items.length}
            // Aramada eşleşen grup HEP açık; aramasız açılış durumu kartın kendi hafızasında.
            forceOpen={!!searchHit}
          >
            {g.items.map((it) =>
              it.kind === "flag"
                ? renderRow(it.def)
                : it.kind === "enum"
                  ? <div key={it.def.enumKey} className="py-3 first:pt-0 last:pb-0">{renderEnum(it.def)}</div>
                  : it.kind === "text"
                    ? <div key={it.def.textKey} className="py-3 first:pt-0 last:pb-0">{renderText(it.def)}</div>
                  : it.kind === "number"
                    ? <div key={it.def.key} className="py-3 first:pt-0 last:pb-0">{renderNumber(it.def, numDraft[it.def.key] ?? serverNumFor(it.def), serverNumFor(it.def), (n) => setNumDraft((d) => ({ ...d, [it.def.key]: n })))}</div>
                    : <div key={it.def.key} className="py-3 first:pt-0 last:pb-0">{renderNumber(it.def, fieldDraft[it.def.key] ?? serverFieldFor(it.def), serverFieldFor(it.def), (n) => setFieldDraft((d) => ({ ...d, [it.def.key]: n })))}</div>,
            )}
          </SettingsGroupCard>
        ))}
      </div>

      {/* Arama tüm satırları gizlese bile KAYDEDİLMEMİŞ taslak varsa bar durur:
          aksi halde kullanıcı bir ayarı değiştirip arama yazınca Kaydet düğmesi
          kaybolur ve değişiklik sessizce çöpe giderdi. */}
      {canEdit && (!nothingShown || dirty) && (
        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          canSave={numbersValid && numValid && fieldValid && freeTextValid}
          onSave={() => mut.mutate()}
          onReset={reset}
          /* Kapı AÇIKSA kullanıcı bunu KAYDET'e basmadan bilmeli — yoksa
             beklenmedik bir şifre sorusu "hata mı aldım?" diye okunur.
             Bilgi sunucudan gelir (`settingsPasswordRequired`); kapıyı
             uygulayan yine sunucudur, bu satır yalnız haber verir. */
          note={
            server?.settingsPasswordRequired ? (
              <span className="inline-flex items-center gap-1">
                <KeyRound className="h-3 w-3" /> Kaydederken ayar şifresi sorulur
              </span>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
