// Boş/hata ekranları liste değil düz görünümdü: aşağı çekip yenilenemiyordu. ScrollView + RefreshControl kısa içerikte
// de çekilebilir (flexGrow:1 ekranı doldurur); liste ekranlarında boş/hata dallarını bununla sar.
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme';

interface Props {
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
  testID?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export default function PullToRefreshView({ refreshing, onRefresh, children, testID, contentContainerStyle }: Props) {
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.grow, contentContainerStyle]}
      testID={testID}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brand]} tintColor={colors.brand} />}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
});
