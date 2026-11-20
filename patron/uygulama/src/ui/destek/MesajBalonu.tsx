// Talep yazışması: CUSTOMER sağda (tema rengi), AGENT_REPLY solda (kart), SYSTEM ortada küçük. Ekler: görselin önizlemesi
// (`variant=thumb`, 5 dk geçerli bağlantı — oturumsuz `Image` kaynağı), dokununca tam ekran (`original`); PDF ve
// önizlemesi alınamayan ek ad + boyutla; silinmiş ekte bağlantı İSTENMEZ, "Ek süresi dolduğu için silindi" yazar.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DestekEk, DestekEkBaglantisi, DestekMesaj } from "../../api/destek-wire";
import { boyutMetni, destekHataMetni, silinmisEkMetni } from "../../destek/metin";
import { formatDateTime } from "../../lib/format";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, space, typography, radius } from "../tokens";

export type EkBaglantisiAl = (id: string, variant: "original" | "thumb") => Promise<DestekEkBaglantisi>;

const ONIZLEME = 160;

function gorselMi(ek: DestekEk): boolean {
  return ek.mime.startsWith("image/");
}

/** Ek bağlantısını bir kez ister; hata metni döner (410 → silindi cümlesi). */
function useEkBaglantisi(ek: DestekEk, variant: "original" | "thumb", al: EkBaglantisiAl, etkin: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  useEffect(() => {
    if (!etkin || ek.deleted) return;
    let canli = true;
    setUrl(null);
    setHata(null);
    al(ek.id, variant).then(
      (b) => canli && setUrl(b.url),
      (e: unknown) => canli && setHata(destekHataMetni(e)),
    );
    return () => {
      canli = false;
    };
  }, [ek.id, ek.deleted, variant, al, etkin]);
  return { url, hata };
}

function TamEkran({ ek, al, onKapat }: { readonly ek: DestekEk; readonly al: EkBaglantisiAl; readonly onKapat: () => void }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { url, hata } = useEkBaglantisi(ek, "original", al, true);
  return (
    <Modal visible animationType="fade" onRequestClose={onKapat} supportedOrientations={["portrait", "landscape"]}>
      <View style={s.tamEkran} testID="ek-tam-ekran">
        {url ? <Image source={{ uri: url }} style={s.tamGorsel} resizeMode="contain" accessibilityLabel={ek.name} /> : hata ? <Text style={s.tamHata}>{hata}</Text> : <ActivityIndicator color="white" />}
        <Pressable onPress={onKapat} accessibilityRole="button" accessibilityLabel="Kapat" hitSlop={12} style={[s.kapat, { top: insets.top + space.s }]} testID="ek-kapat">
          <Ionicons name="close" size={28} color="white" />
        </Pressable>
      </View>
    </Modal>
  );
}

export function EkOnizleme({ ek, al }: { readonly ek: DestekEk; readonly al: EkBaglantisiAl }) {
  const t = useTokens();
  const s = useStyles();
  const [acik, setAcik] = useState(false);
  const gorsel = gorselMi(ek);
  const { url, hata } = useEkBaglantisi(ek, "thumb", al, gorsel);
  if (ek.deleted) {
    return (
      <View style={s.ekSatir} testID={`ek-${ek.id}-silindi`}>
        <Ionicons name="time-outline" size={16} color={t.textSecondary} />
        <Text style={s.ekMetin}>{silinmisEkMetni(ek)}</Text>
      </View>
    );
  }
  if (gorsel && !hata) {
    return (
      <>
        <Pressable onPress={() => setAcik(true)} accessibilityRole="imagebutton" accessibilityLabel={`${ek.name}, büyütmek için dokunun`} testID={`ek-${ek.id}`}>
          <View style={s.onizleme}>{url ? <Image source={{ uri: url }} style={s.onizlemeGorsel} resizeMode="cover" /> : <ActivityIndicator />}</View>
        </Pressable>
        {acik ? <TamEkran ek={ek} al={al} onKapat={() => setAcik(false)} /> : null}
      </>
    );
  }
  return (
    <View style={s.ekSatir} testID={`ek-${ek.id}`}>
      <Ionicons name={gorsel ? "image-outline" : "document-outline"} size={16} color={t.textSecondary} />
      <Text style={s.ekMetin} numberOfLines={2}>{hata ?? `${ek.name} · ${boyutMetni(ek.size)}`}</Text>
    </View>
  );
}

export function MesajBalonu({ mesaj, al }: { readonly mesaj: DestekMesaj; readonly al: EkBaglantisiAl }) {
  const s = useStyles();
  if (mesaj.kind === "SYSTEM") {
    return (
      <Text style={s.sistem} testID={`mesaj-${mesaj.id}`} maxFontSizeMultiplier={FONT_SCALE.title}>
        {mesaj.body} · {formatDateTime(mesaj.createdAt)}
      </Text>
    );
  }
  const biz = mesaj.kind === "CUSTOMER";
  const kim = biz ? (mesaj.authorName ?? "Siz") : (mesaj.authorName ?? "Destek ekibi");
  return (
    <View style={[s.sira, biz ? s.sag : s.sol]} testID={`mesaj-${mesaj.id}`}>
      <Text style={s.kim} maxFontSizeMultiplier={FONT_SCALE.title}>{biz ? kim : `${kim} · Destek`} · {formatDateTime(mesaj.createdAt)}</Text>
      <View style={[s.balon, biz ? s.balonBiz : s.balonEkip]}>
        {mesaj.body ? <Text style={[s.govde, biz && s.govdeBiz]} selectable>{mesaj.body}</Text> : null}
        {mesaj.attachments.length > 0 ? (
          <View style={s.ekler}>
            {mesaj.attachments.map((ek) => <EkOnizleme key={ek.id} ek={ek} al={al} />)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  sira: { maxWidth: "86%" as const, gap: 2, marginBottom: space.m },
  sag: { alignSelf: "flex-end" as const, alignItems: "flex-end" as const },
  sol: { alignSelf: "flex-start" as const, alignItems: "flex-start" as const },
  kim: { ...typography.caption, color: t.textSecondary },
  balon: { borderRadius: radius.card, paddingHorizontal: space.m, paddingVertical: space.s, gap: space.s },
  balonBiz: { backgroundColor: t.tint },
  balonEkip: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.separator },
  govde: { ...typography.body, color: t.text },
  govdeBiz: { color: t.onTint },
  sistem: { ...typography.caption, color: t.textSecondary, textAlign: "center" as const, marginBottom: space.m },
  ekler: { gap: space.s },
  ekSatir: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, backgroundColor: t.surfaceAlt, borderRadius: radius.control, padding: space.s },
  ekMetin: { ...typography.caption, color: t.text, flexShrink: 1 },
  onizleme: { width: ONIZLEME, height: ONIZLEME, borderRadius: radius.control, overflow: "hidden" as const, backgroundColor: t.surfaceAlt, alignItems: "center" as const, justifyContent: "center" as const },
  onizlemeGorsel: { width: ONIZLEME, height: ONIZLEME },
  tamEkran: { flex: 1, backgroundColor: "black", alignItems: "center" as const, justifyContent: "center" as const },
  tamGorsel: { width: "100%" as const, height: "100%" as const },
  tamHata: { ...typography.body, color: "white", padding: space.xl, textAlign: "center" as const },
  kapat: { position: "absolute" as const, right: space.l, width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const },
}));
