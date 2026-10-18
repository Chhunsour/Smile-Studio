import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { effectPrimitives, effectSeed, type ClipEffects } from '@/core/effects';

const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;

/** Exactly the same normalized primitives carried by ExportClip.effects to both native exporters. */
export const EffectsOverlay = memo(function EffectsOverlay({ settings, seedId, width, height }: { settings?: ClipEffects; seedId: string; width: number; height: number }) {
  const primitives = useMemo(() => effectPrimitives(settings, effectSeed(seedId), width / height), [settings, seedId, width, height]);
  if (!primitives.length) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 1 }]}>
      {primitives.map((primitive, index) => {
        const style = { position: 'absolute' as const, left: primitive.x * width, top: primitive.y * height, width: primitive.w * width, height: primitive.h * height };
        return primitive.axis === 'solid' ? (
          <View key={index} style={[style, { backgroundColor: rgba(primitive.color, primitive.a0) }]} />
        ) : (
          <LinearGradient
            key={index}
            colors={[rgba(primitive.color, primitive.a0), rgba(primitive.color, primitive.a1)]}
            start={{ x: 0, y: 0 }}
            end={primitive.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 }}
            style={style}
          />
        );
      })}
    </View>
  );
});
