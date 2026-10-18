export function createToolHandoff() {
  let pending: (() => void) | undefined;
  return {
    queue(action: () => void) { pending = action; },
    cancel() { pending = undefined; },
    flush() {
      const action = pending;
      pending = undefined;
      if (!action) return false;
      action();
      return true;
    },
  };
}
