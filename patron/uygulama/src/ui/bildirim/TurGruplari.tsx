// Telefon bildirimi türleri: arama + departman başına katlanır grup (başlıkta "x/y açık"); açık grupta "hepsi" anahtarı
// ve tür anahtarları. Arama doluyken eşleşen gruplar açık çizilir. Yazmayı çağıran yapar (`onGrup`, `onTur`).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { erpBildirimGorunusu } from "../../lib/erp-bildirim";
import { ToggleRow } from "../diger/parts";
import { ListGroup } from "../ListRow";
import { makeStyles, useTokens } from "../theme-context";
import { TOUCH, radius, space, tabularNums, typography } from "../tokens";
import { grupOzeti, turGruplariniSuz, type TurGrubu } from "./tur-gruplari-model";

export function TurGruplari(p: {
  readonly gruplar: readonly TurGrubu[];
  readonly ad: ReadonlyMap<string, string>;
  readonly disabled: boolean;
  readonly onGrup: (g: TurGrubu, acik: boolean) => void;
  readonly onTur: (tur: string, acik: boolean) => void;
}) {
  const t = useTokens();
  const s = useStyles();
  const [sorgu, setSorgu] = useState("");
  const [acikGruplar, setAcikGruplar] = useState<ReadonlySet<string>>(new Set());
  const araniyor = sorgu.trim().length > 0;
  const gorunen = turGruplariniSuz(p.gruplar, p.ad, sorgu);
  const cevir = (g: string) => setAcikGruplar((o) => {
    const n = new Set(o);
    if (!n.delete(g)) n.add(g);
    return n;
  });
  return (
    <View>
      <View style={s.ara}>
        <Ionicons name="search" size={16} color={t.textMuted} />
        <TextInput value={sorgu} onChangeText={setSorgu} placeholder="Bildirim türü ara…" placeholderTextColor={t.textMuted}
          style={s.araGiris} accessibilityLabel="Bildirim türü ara" autoCorrect={false} testID="telefon-tur-ara" />
        {araniyor ? (
          <Pressable onPress={() => setSorgu("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Aramayı temizle" testID="telefon-tur-ara-temizle">
            <Ionicons name="close-circle" size={18} color={t.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {araniyor && gorunen.length === 0 ? <Text style={s.bos} testID="telefon-tur-ara-bos">{`“${sorgu.trim()}” ile eşleşen bildirim türü yok.`}</Text> : null}
      {gorunen.map((g) => {
        const tam = p.gruplar.find((x) => x.grup === g.grup) ?? g;
        const oz = grupOzeti(tam);
        const acik = araniyor || acikGruplar.has(g.grup);
        return (
          <View key={g.grup} style={{ marginBottom: space.s }}>
            <Pressable onPress={() => cevir(g.grup)} disabled={araniyor} style={({ pressed }) => [s.baslik, pressed && { opacity: 0.7 }]}
              accessibilityRole="button" accessibilityState={{ expanded: acik }} accessibilityLabel={`${g.grup}, ${oz.metin}`} testID={`telefon-grup-baslik-${g.grup}`}>
              <Ionicons name={acik ? "chevron-down" : "chevron-forward"} size={16} color={t.textSecondary} />
              <Text style={s.baslikMetin}>{g.grup}</Text>
              <Text style={[s.sayac, oz.acik === 0 && { color: t.textMuted }]} testID={`telefon-grup-ozet-${g.grup}`}>{oz.metin}</Text>
            </Pressable>
            {acik ? (
              <ListGroup testID={`telefon-grup-${g.grup}`}>
                {araniyor ? null : (
                  <ToggleRow label={`${g.grup} bildirimlerinin hepsi`} hint={oz.metin} value={oz.acik === oz.toplam} disabled={p.disabled}
                    onChange={(v) => p.onGrup(tam, v)} testID={`telefon-grup-ac-${g.grup}`} />
                )}
                {g.hucreler.map((h) => (
                  <ToggleRow key={h.tur} label={p.ad.get(h.tur) ?? h.tur} value={h.acik} disabled={p.disabled}
                    icon={erpBildirimGorunusu(h.tur).icon} domain={erpBildirimGorunusu(h.tur).domain}
                    onChange={(v) => p.onTur(h.tur, v)} testID={`telefon-tercih-${h.tur}`} />
                ))}
              </ListGroup>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  ara: {
    flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, minHeight: TOUCH, paddingHorizontal: space.m,
    marginBottom: space.s, borderRadius: radius.chip, borderWidth: 1, borderColor: t.separator, backgroundColor: t.surface,
  },
  araGiris: { flex: 1, ...typography.subhead, color: t.text, paddingVertical: space.s },
  bos: { ...typography.footnote, color: t.textMuted, textAlign: "center" as const, paddingVertical: space.l },
  baslik: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, minHeight: TOUCH, paddingHorizontal: space.l },
  baslikMetin: { flex: 1, ...typography.subhead, fontWeight: "600" as const, color: t.text },
  sayac: { ...typography.footnote, ...tabularNums, color: t.textSecondary },
}));
