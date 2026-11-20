// Ortak veri tablosu (D7) — A UI kitiyle: telefonda ekranın kendi kart satırları (ListRow), geniş ekranda (≥ WIDE_MIN)
// sütunlu tablo (başlığa dokun → sırala, "Sütunlar" ile görünen sütun). Sıralama çipi iki boyda da var; sıralama
// SUNUCUDA, yalnız sunucunun beyan ettiği alanlar seçilebilir (eski sunucu: çip yok, en yeni önce).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { FilterChip } from "../FilterChip";
import { useWide } from "../Frame";
import { ChoiceSheet } from "../siparis/ChoiceSheet";
import { makeStyles, useTokens } from "../theme-context";
import { TOUCH, radius, space, tabularNums, typography } from "../tokens";
import { basligaDokun, gorunenSutunlar, secenekAnahtari, secenektenTercih, siralamaEtiketi, siralamaSecenekleri, VARSAYILAN_TERCIH, type TabloSutunu } from "./model";
import type { TabloTercihiDurumu } from "./useTabloTercihi";

/** Liste araç şeridine konan sıralama (+ geniş ekranda sütun) çipleri. */
export function TabloAraclari<R>(p: { readonly sutunlar: readonly TabloSutunu<R>[]; readonly durum: TabloTercihiDurumu; readonly testID: string }) {
  const wide = useWide();
  const s = useStyles();
  const [acik, setAcik] = useState<"sirala" | "sutun" | null>(null);
  const { tercih, siralanabilir, degistir } = p.durum;
  const gizlenebilir = p.sutunlar.filter((c) => !c.sabit);
  if (siralanabilir.length === 0 && !(wide && gizlenebilir.length > 0)) return null;
  return (
    <View style={s.tools}>
      {siralanabilir.length > 0 ? (
        <FilterChip label="Sırala" value={siralamaEtiketi(tercih, p.sutunlar)} selected={tercih.sirala !== null} onPress={() => setAcik("sirala")} testID={`${p.testID}-sirala`} />
      ) : null}
      {wide && gizlenebilir.length > 0 ? (
        <FilterChip label="Sütunlar" value={`${gorunenSutunlar(p.sutunlar, tercih).length}/${p.sutunlar.length}`} selected={tercih.gizli.length > 0} onPress={() => setAcik("sutun")} testID={`${p.testID}-sutunlar`} />
      ) : null}
      {tercih.sirala !== null || tercih.gizli.length > 0 ? (
        <Pressable onPress={() => degistir(VARSAYILAN_TERCIH)} hitSlop={8} accessibilityRole="button" style={s.reset} testID={`${p.testID}-varsayilan`}>
          <Text style={s.resetText}>Varsayılana dön</Text>
        </Pressable>
      ) : null}
      <ChoiceSheet
        visible={acik === "sirala"}
        title="Sıralama"
        choices={siralamaSecenekleri(p.sutunlar, siralanabilir)}
        value={secenekAnahtari(tercih)}
        onSelect={(k) => degistir(secenektenTercih(tercih, k))}
        onClose={() => setAcik(null)}
        testIDPrefix={`${p.testID}-sira-`}
      />
      <ChoiceSheet
        visible={acik === "sutun"}
        title="Görünen sütunlar"
        choices={gizlenebilir.map((c) => ({ key: c.anahtar, label: c.etiket }))}
        value=""
        isOn={(k) => !tercih.gizli.includes(k)}
        onSelect={(k) => degistir({ ...tercih, gizli: tercih.gizli.includes(k) ? tercih.gizli.filter((x) => x !== k) : [...tercih.gizli, k] })}
        onClose={() => setAcik(null)}
        testIDPrefix={`${p.testID}-sutun-`}
      />
    </View>
  );
}

/** Kayıtlar: geniş ekranda tablo, telefonda `kart` ile ekranın kendi satırları. */
export function VeriTablosu<R extends { readonly id: string }>(p: {
  readonly sutunlar: readonly TabloSutunu<R>[];
  readonly kayitlar: readonly R[];
  readonly durum: TabloTercihiDurumu;
  readonly onPress: (r: R) => void;
  /** Telefon görünümü (ekranın mevcut ListGroup/ListRow çizimi). */
  readonly kart: (kayitlar: readonly R[]) => ReactNode;
  readonly testID: string;
}) {
  const wide = useWide();
  const t = useTokens();
  const s = useStyles();
  if (!wide) return <>{p.kart(p.kayitlar)}</>;
  if (p.kayitlar.length === 0) return null;
  const { tercih, siralanabilir, degistir } = p.durum;
  const cols = gorunenSutunlar(p.sutunlar, tercih);
  return (
    <ScrollView horizontal contentContainerStyle={s.scroll} testID={p.testID}>
      <View style={s.table}>
        <View style={[s.row, s.head]} accessibilityRole="header">
          {cols.map((c) => {
            const can = siralanabilir.includes(c.anahtar);
            const on = tercih.sirala === c.anahtar;
            return (
              <Pressable
                key={c.anahtar}
                disabled={!can}
                onPress={() => degistir(basligaDokun(tercih, c.anahtar))}
                accessibilityRole={can ? "button" : undefined}
                accessibilityLabel={can ? `${c.etiket} sütununa göre sırala` : c.etiket}
                style={[s.cell, { flex: c.genislik ?? 1 }, c.tur === "sayi" && s.right]}
                testID={`${p.testID}-baslik-${c.anahtar}`}
              >
                <Text style={[s.headText, on && { color: t.tint }]} numberOfLines={1}>{c.etiket}</Text>
                {on ? <Ionicons name={tercih.yon === "artan" ? "arrow-up" : "arrow-down"} size={14} color={t.tint} /> : null}
              </Pressable>
            );
          })}
        </View>
        {p.kayitlar.map((r) => (
          <Pressable key={r.id} onPress={() => p.onPress(r)} accessibilityRole="button" style={({ pressed }) => [s.row, s.bodyRow, pressed && { backgroundColor: t.surfaceAlt }]} testID={`${p.testID}-satir-${r.id}`}>
            {cols.map((c) => (
              <View key={c.anahtar} style={[s.cell, { flex: c.genislik ?? 1 }, c.tur === "sayi" && s.right]}>
                <Text style={[s.cellText, c.tur !== "metin" && tabularNums]} numberOfLines={1}>{c.deger(r) || "—"}</Text>
              </View>
            ))}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  tools: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: space.s },
  reset: { minHeight: 36, justifyContent: "center" as const, paddingHorizontal: space.s },
  resetText: { ...typography.subhead, color: t.tint, fontWeight: "600" as const },
  scroll: { flexGrow: 1 },
  table: { flex: 1, minWidth: "100%" as const, backgroundColor: t.surface, borderRadius: radius.card, overflow: "hidden" as const, borderWidth: 1, borderColor: t.separator },
  row: { flexDirection: "row" as const, alignItems: "center" as const, minHeight: TOUCH, paddingHorizontal: space.m },
  head: { backgroundColor: t.surfaceAlt },
  bodyRow: { borderTopWidth: 1, borderTopColor: t.separator },
  cell: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, paddingHorizontal: space.s, minWidth: 96 },
  right: { justifyContent: "flex-end" as const },
  headText: { ...typography.footnote, color: t.textSecondary, fontWeight: "600" as const },
  cellText: { ...typography.subhead, color: t.text },
}));
