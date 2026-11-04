// Belgeden kendiliğinden dolan değerin "fosforlu kalem" vurgusu; İE formu ve şablon ekranı aynı stili kullanır.
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export const DOC_HIGHLIGHT_BG = "#FFF59D";

export function DocHighlight({ active, style, children }: { active: boolean; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return <View style={[active ? { backgroundColor: DOC_HIGHLIGHT_BG, borderRadius: 6 } : null, style]}>{children}</View>;
}
