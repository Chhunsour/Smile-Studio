import { StyleSheet, View } from 'react-native';

import { type AppColors, useThemedStyles, useAppTheme } from './theme';

/** Smile Studio mark: a sunny tile with a smile. Drawn with views so it stays crisp at any size. */
export function Logo({ size = 32 }: { size?: number }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const u = size / 32;
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: 9 * u }]}>
      <View style={{ flexDirection: 'row', gap: 8 * u, marginTop: 2 * u }}>
        <View style={[styles.eye, { width: 4 * u, height: 4 * u, borderRadius: 2 * u }]} />
        <View style={[styles.eye, { width: 4 * u, height: 4 * u, borderRadius: 2 * u }]} />
      </View>
      <View
        style={{
          width: 16 * u,
          height: 8 * u,
          marginTop: 3 * u,
          borderWidth: 2.6 * u,
          borderTopWidth: 0,
          borderColor: colors.accentInk,
          borderBottomLeftRadius: 8 * u,
          borderBottomRightRadius: 8 * u,
        }}
      />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  tile: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  eye: { backgroundColor: colors.accentInk },
});
