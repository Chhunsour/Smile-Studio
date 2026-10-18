import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

const MotionContext = createContext(false);

/** One live system subscription for every control, including controls inside native modals. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const initialPreference = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialPreference);
  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReducedMotion(value);
    }).catch(() => {});
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return <MotionContext.Provider value={reducedMotion}>{children}</MotionContext.Provider>;
}

export const useMotionPreferences = () => useContext(MotionContext);
