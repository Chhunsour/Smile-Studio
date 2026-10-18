/** Local developer integration helper. Calls actual Hermes runtime; this is not touch automation. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export async function connectNativeRuntime({ port = 8081, appId = 'com.smilestudio.app' } = {}) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((entry) => entry.appId === appId);
  if (!target) throw new Error(`No native debugger target for ${appId}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl, { origin: new URL(target.webSocketDebuggerUrl).origin.replace(/^ws/, 'http') });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', (event) => reject(event.error ?? new Error(event.message ?? 'Native debugger socket failed')), { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  });
  function call(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return {
    target: { appId: target.appId, deviceName: target.deviceName, title: target.title },
    call,
    async evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value ?? result.result;
    },
    close() {
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error('Debugger closed'));
      }
      pending.clear();
      socket.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expressionFile = process.argv[2];
  if (!expressionFile) throw new Error('Usage: node cdp.mjs <expression-file.js>');
  const runtime = await connectNativeRuntime();
  try {
    console.log(JSON.stringify(await runtime.evaluate(await readFile(expressionFile, 'utf8')), null, 2));
  } finally {
    runtime.close();
  }
}
