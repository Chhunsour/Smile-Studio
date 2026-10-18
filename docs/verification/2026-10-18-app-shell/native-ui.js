/* Inject only after shell verification is ready. Runs handlers in the actual native app. */
(() => {
  globalThis.__shellModule = (part) => {
    const matches = [];
    __r.getModules().forEach((module, id) => {
      if ((module.verboseName || '').includes(part)) matches.push(id);
    });
    if (matches.length !== 1) throw new Error(`Expected one module for ${part}; got ${matches.length}`);
    return __r(matches[0]);
  };
  globalThis.__shellFibers = () => {
    const fibers = [], seen = new Set();
    const visit = (fiber) => {
      if (!fiber || seen.has(fiber) || seen.size > 50000) return;
      seen.add(fiber);
      fibers.push(fiber);
      visit(fiber.child);
      visit(fiber.sibling);
    };
    __REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.forEach((renderer, id) => {
      __REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(id).forEach(root => visit(root.current));
    });
    return fibers;
  };
  globalThis.__shellWords = (node) => typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node) ? node.map(__shellWords).join('') : node?.props ? __shellWords(node.props.children) : '';
  globalThis.__shellPress = (label) => {
    const fiber = __shellFibers().find(({ memoizedProps: props }) => props && !props.disabled &&
      typeof props.onPress === 'function' &&
      (props.accessibilityLabel === label || props.label === label || __shellWords(props.children) === label));
    if (!fiber) throw new Error(`Action not found: ${label}`);
    fiber.memoizedProps.onPress();
    return { pressed: label };
  };
  globalThis.__shellInput = (label, value) => {
    const fiber = __shellFibers().find(({ memoizedProps: props }) => props?.accessibilityLabel === label &&
      typeof props.onChangeText === 'function');
    if (!fiber) throw new Error(`Input not found: ${label}`);
    fiber.memoizedProps.onChangeText(value);
    return { input: label, value };
  };
  globalThis.__shellUi = () => {
    const unique = new Map();
    for (const { memoizedProps: props } of __shellFibers()) {
      if (!props) continue;
      const label = props.accessibilityLabel || props.label || __shellWords(props.children);
      if (typeof props.onPress === 'function' && label && label.length < 200) unique.set(`button:${label}`, {
        kind: 'button', label, disabled: !!props.disabled, state: props.accessibilityState,
      });
      if (typeof props.onChangeText === 'function') unique.set(`input:${props.accessibilityLabel}`, {
        kind: 'input', label: props.accessibilityLabel, value: props.secureTextEntry ? '[hidden]' : props.value,
      });
    }
    return [...unique.values()];
  };
  return { ready: true, nativeFibers: __shellFibers().length, controls: __shellUi() };
})()
