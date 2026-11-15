// Telefon bildirimi profilleri (fabrika `tercihler/profiller`, kanal PATRON_PUSH): yatay çipler (hazır + kişisel), etkin
// profil adı ya da "Özel", "Profili kaydet". Kişisel çipe uzun basınca satır içi eylemler (seçimle güncelle · yeniden
// adlandır · sil). Karar ve eşleşme sunucuda; şerit yalnız çizer ve çağıranın eylemini tetikler.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { etkinProfilAdi, hazirAnahtar, kisiselAnahtar, type ProfilGorunumu } from "../../api/bildirim";
import { haptic } from "../haptics";
import { Button, ConfirmButton, Field } from "../kit";
import { makeStyles, useTokens } from "../theme-context";
import { radius, space, typography } from "../tokens";

/** Fabrika `name VarChar(60)`. */
export const PROFIL_AD_UZUNLUK = 60;

type Kip = { readonly tur: "kaydet" } | { readonly tur: "menu"; readonly id: string } | { readonly tur: "adlandir"; readonly id: string };

export function ProfilSeridi(p: {
  readonly gorunum: ProfilGorunumu;
  readonly busy: string | null;
  readonly disabled: boolean;
  readonly onUygula: (secim: { hazir: string } | { kisisel: string }, anahtar: string) => void;
  readonly onKaydet: (ad: string) => Promise<boolean>;
  readonly onGuncelle: (id: string, b: { ad?: string; seciminiGuncelle?: boolean }) => Promise<boolean>;
  readonly onSil: (id: string) => Promise<boolean>;
}) {
  const s = useStyles();
  const [kip, setKip] = useState<Kip | null>(null);
  const [ad, setAd] = useState("");
  const etkin = new Set(p.gorunum.etkin);
  const kapat = () => {
    setKip(null);
    setAd("");
  };
  const bitir = (ok: boolean) => ok && kapat();
  const secili = kip && kip.tur !== "kaydet" ? p.gorunum.kisisel.find((k) => k.id === kip.id) : undefined;
  const adGecerli = ad.trim().length > 0 && ad.trim().length <= PROFIL_AD_UZUNLUK;
  const kilitli = p.disabled || p.busy !== null;

  return (
    <View style={s.kutu} testID="telefon-profil-seridi">
      <View style={s.ust}>
        <Text style={s.etiket}>Profil: <Text style={s.etkin} testID="telefon-profil-etkin">{etkinProfilAdi(p.gorunum)}</Text></Text>
        <Button label="Profili kaydet" tone="plain" icon="bookmark-outline" disabled={kilitli} onPress={() => { setAd(""); setKip({ tur: "kaydet" }); }} testID="telefon-profil-kaydet" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cipler} keyboardShouldPersistTaps="handled">
        {p.gorunum.hazir.map((h) => (
          <Cip key={h.kod} ad={h.ad} secili={etkin.has(hazirAnahtar(h.kod))} busy={p.busy === hazirAnahtar(h.kod)} disabled={kilitli}
            onPress={() => p.onUygula({ hazir: h.kod }, hazirAnahtar(h.kod))} ipucu={h.aciklama} testID={`telefon-profil-hazir-${h.kod}`} />
        ))}
        {p.gorunum.kisisel.map((k) => (
          <Cip key={k.id} ad={k.ad} kisisel secili={etkin.has(kisiselAnahtar(k.id))} busy={p.busy === kisiselAnahtar(k.id)} disabled={kilitli}
            onPress={() => p.onUygula({ kisisel: k.id }, kisiselAnahtar(k.id))} onLongPress={() => setKip({ tur: "menu", id: k.id })}
            ipucu="Uygula; uzun basınca düzenle" testID={`telefon-profil-kisisel-${k.id}`} />
        ))}
      </ScrollView>
      {kip?.tur === "kaydet" || kip?.tur === "adlandir" ? (
        <View style={s.panel} testID="telefon-profil-ad-paneli">
          <Field label={kip.tur === "kaydet" ? "Profil adı (şimdiki seçim kaydedilir)" : "Yeni ad"} value={ad} onChangeText={setAd} maxLength={PROFIL_AD_UZUNLUK}
            autoFocus placeholder="Ör. Hafta sonu" testID="telefon-profil-ad" />
          <View style={s.satir}>
            <View style={s.esnek}><Button label="Vazgeç" tone="plain" onPress={kapat} testID="telefon-profil-vazgec" /></View>
            <View style={s.esnek}>
              <Button label="Kaydet" disabled={!adGecerli || kilitli} busy={p.busy === "profil-ad"} testID="telefon-profil-ad-kaydet"
                onPress={() => void (kip.tur === "kaydet" ? p.onKaydet(ad.trim()) : p.onGuncelle(kip.id, { ad: ad.trim() })).then(bitir)} />
            </View>
          </View>
        </View>
      ) : null}
      {kip?.tur === "menu" && secili ? (
        <View style={s.panel} testID="telefon-profil-menu">
          <Text style={s.menuBaslik}>{secili.ad}</Text>
          <Button label="Şimdiki seçimle güncelle" tone="secondary" icon="refresh-outline" disabled={kilitli} busy={p.busy === "profil-guncelle"}
            onPress={() => void p.onGuncelle(secili.id, { seciminiGuncelle: true }).then(bitir)} testID="telefon-profil-guncelle" />
          <Button label="Yeniden adlandır" tone="secondary" icon="create-outline" disabled={kilitli}
            onPress={() => { setAd(secili.ad); setKip({ tur: "adlandir", id: secili.id }); }} testID="telefon-profil-adlandir" />
          <ConfirmButton label="Profili sil" question={`“${secili.ad}” silinsin mi? Uygulanmış seçim yerinde kalır.`} disabled={kilitli}
            busy={p.busy === "profil-sil"} onConfirm={() => void p.onSil(secili.id).then(bitir)} testID="telefon-profil-sil" />
          <Button label="Kapat" tone="plain" onPress={kapat} testID="telefon-profil-menu-kapat" />
        </View>
      ) : null}
    </View>
  );
}

function Cip(p: { ad: string; secili: boolean; busy: boolean; disabled: boolean; kisisel?: boolean; ipucu: string; onPress: () => void; onLongPress?: () => void; testID: string }) {
  const t = useTokens();
  const s = useStyles();
  const fg = p.secili ? t.tint : t.text;
  return (
    <Pressable
      onPress={() => { haptic("selection"); p.onPress(); }}
      onLongPress={p.onLongPress ? () => { haptic("selection"); p.onLongPress!(); } : undefined}
      disabled={p.disabled}
      testID={p.testID}
      accessibilityRole="button"
      accessibilityLabel={`${p.ad} profili`}
      accessibilityHint={p.ipucu}
      accessibilityState={{ selected: p.secili, disabled: p.disabled, busy: p.busy }}
      hitSlop={4}
      style={({ pressed }) => [s.cip, p.secili && { backgroundColor: t.tintContainer, borderColor: t.tint }, p.disabled && !p.secili && { opacity: 0.55 }, pressed && { opacity: 0.8 }]}
    >
      {p.secili ? <Ionicons name="checkmark" size={14} color={fg} /> : p.kisisel ? <Ionicons name="bookmark-outline" size={13} color={fg} /> : null}
      <Text style={[s.cipMetin, { color: fg }]} numberOfLines={1}>{p.busy ? `${p.ad}…` : p.ad}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  kutu: { marginBottom: space.m },
  ust: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: space.s, paddingHorizontal: space.l },
  etiket: { flex: 1, ...typography.subhead, color: t.textSecondary },
  etkin: { fontWeight: "600" as const, color: t.text },
  cipler: { gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s },
  cip: {
    minHeight: 36, flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, paddingHorizontal: space.m,
    borderRadius: radius.chip, borderWidth: 1, borderColor: t.separator, backgroundColor: t.surface,
  },
  cipMetin: { ...typography.subhead, fontWeight: "600" as const },
  panel: { gap: space.s, marginHorizontal: space.l, marginTop: space.xs, padding: space.m, borderRadius: radius.card, backgroundColor: t.surface },
  menuBaslik: { ...typography.headline, color: t.text },
  satir: { flexDirection: "row" as const, gap: space.s },
  esnek: { flex: 1 },
}));
