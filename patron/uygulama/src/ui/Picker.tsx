// Seçici: dokununca doğrudan tam liste modalı açılır (sayfalı; "Daha fazla" ile devam).
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { recordTitle } from "../lib/present";
import { ProjectionList } from "./data";
import { Button } from "./kit";
import { TOUCH, color, space } from "./theme";

export interface Picked {
  readonly id: string;
  readonly title: string;
}

export function Picker(p: { label: string; projection: string; value: Picked | null; onChange: (v: Picked | null) => void; optional?: boolean; testID?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: space.m }}>
      <Text style={{ fontSize: 14, fontWeight: "600", marginBottom: space.xs }}>{p.label}</Text>
      <Pressable accessibilityRole="button" testID={p.testID} onPress={() => setOpen(true)}
        style={{ minHeight: TOUCH, borderWidth: 1, borderColor: color.line, borderRadius: 8, justifyContent: "center", paddingHorizontal: space.m, backgroundColor: color.card }}>
        <Text style={{ fontSize: 16, color: p.value ? color.text : color.muted }}>{p.value?.title ?? (p.optional ? "Seçilmedi (isteğe bağlı)" : "Seçin")}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: color.bg, paddingTop: space.xl }}>
          <View style={{ flexDirection: "row", paddingHorizontal: space.l, gap: space.s }}>
            <View style={{ flex: 1 }}><Button label="Kapat" tone="plain" onPress={() => setOpen(false)} /></View>
            {p.optional && p.value ? <View style={{ flex: 1 }}><Button label="Temizle" tone="plain" onPress={() => { p.onChange(null); setOpen(false); }} /></View> : null}
          </View>
          <ScrollView contentContainerStyle={{ padding: space.l }}>
            <ProjectionList projection={p.projection} onOpen={(r) => { p.onChange({ id: r.id, title: recordTitle(r.kayit) }); setOpen(false); }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
