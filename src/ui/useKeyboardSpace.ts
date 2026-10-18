import { useSyncExternalStore } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

const listeners = new Set<() => void>();
let keyboardTop: number | null = null;
let subscriptions: ReturnType<typeof Keyboard.addListener>[] = [];

function publish(top: number | null) {
  if (keyboardTop === top) return;
  keyboardTop = top;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    keyboardTop = Keyboard.metrics()?.screenY ?? null;
    subscriptions = [
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', event => publish(event.endCoordinates.screenY)),
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => publish(null)),
    ];
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { subscriptions.forEach(subscription => subscription.remove()); subscriptions = []; }
  };
}

const snapshot = () => listeners.size ? keyboardTop : Keyboard.metrics()?.screenY ?? null;
const emptySnapshot = () => null;
const noSubscription = () => () => {};

/** Keyboard overlap within the current viewport; Android adjustResize already removes that space. */
export function useKeyboardSpace(enabled: boolean) {
  const { height } = useWindowDimensions();
  const top = useSyncExternalStore(enabled ? subscribe : noSubscription, enabled ? snapshot : emptySnapshot, emptySnapshot);
  return top !== null ? Math.max(0, height - top) : 0;
}
