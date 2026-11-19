/**
 * Minimal Chrome DevTools Protocol client (zero dependencies).
 *
 * Launches headless Chrome with a throwaway profile, reads the DevTools port from
 * `DevToolsActivePort`, opens one target and talks JSON over the built-in WebSocket.
 * Enough for the real-host smoke test: navigate, evaluate, wait for a selector, read
 * console errors, and shut everything down again.
 *
 * Requires a Node with a global `WebSocket` (Node 22+); the caller checks that.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Default Chrome binary on macOS; override with `CHROME_BIN`. */
export const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Kill a child together with everything it spawned.
 *
 * Children are started `detached`, so each one leads its own process group; signalling
 * `-pid` reaches the whole group (Chrome's renderer/GPU helpers, the host's node child).
 * Falls back to the single pid when the group is already gone (ESRCH).
 *
 * @param {import('node:child_process').ChildProcess} child - the detached child.
 * @param {NodeJS.Signals} [signal] - signal to send.
 * @returns {void}
 */
export function killTree(child, signal = 'SIGKILL') {
  if (child === null || child === undefined || typeof child.pid !== 'number') return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already reaped; nothing left to do.
    }
  }
}

/**
 * Start headless Chrome and bind one page.
 *
 * @param {{width?: number, height?: number, chrome?: string}} [options] - viewport and binary.
 * @returns {Promise<object>} the client bound to a single page.
 */
export async function launch(options = {}) {
  const binary = options.chrome ?? CHROME;
  if (!existsSync(binary)) throw new Error(`找不到 Chrome：${binary}（用 CHROME_BIN 指定）`);
  const profile = mkdtempSync(join(tmpdir(), 'skc-chrome-'));
  const child = spawn(binary, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${options.width ?? 1440},${options.height ?? 920}`,
    'about:blank',
  ], { stdio: 'ignore', detached: true });

  const portFile = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 200 && !existsSync(portFile); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!existsSync(portFile)) {
    killTree(child);
    throw new Error('Chrome 没有开出 DevTools 端口');
  }
  const [port] = readFileSync(portFile, 'utf8').split('\n');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method !== undefined) {
      for (const handler of listeners.get(message.method) ?? []) handler(message.params);
    }
  });

  /**
   * Send one protocol command.
   *
   * @param {string} method - CDP method, e.g. `Runtime.evaluate`.
   * @param {object} [params] - method parameters.
   * @returns {Promise<object>} the protocol result.
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: options.width ?? 1440,
    height: options.height ?? 920,
    deviceScaleFactor: 2,
    mobile: false,
  });

  const client = {
    send,
    /**
     * Subscribe to one CDP event.
     *
     * @param {string} method - event name, e.g. `Runtime.consoleAPICalled`.
     * @param {(params: object) => void} handler - callback.
     * @returns {void}
     */
    on(method, handler) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(handler);
    },
    /**
     * Navigate and wait until the document is complete.
     *
     * @param {string} url - target URL.
     * @returns {Promise<void>} resolves after load.
     */
    async goto(url) {
      await send('Page.navigate', { url });
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const { result } = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (result.value === 'complete') return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    /**
     * Evaluate an expression in the page.
     *
     * @param {string} expression - JS source; async sources are awaited.
     * @returns {Promise<unknown>} the value.
     */
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed');
      return result.value;
    },
    /**
     * Poll one boolean expression until it turns true.
     *
     * @param {string} expression - expression yielding a truthy value.
     * @param {{timeoutMs?: number, intervalMs?: number}} [options] - budget and poll step.
     * @returns {Promise<boolean>} `true` when it became truthy, `false` on timeout.
     */
    async waitFor(expression, options = {}) {
      const deadline = Date.now() + (options.timeoutMs ?? 20000);
      const interval = options.intervalMs ?? 300;
      while (Date.now() < deadline) {
        const value = await client.evaluate(`Boolean(${expression})`);
        if (value === true) return true;
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
      return false;
    },
    /** Close the browser and delete its throwaway profile. */
    async close() {
      try {
        await send('Browser.close');
      } catch {
        // Already gone; the kill below is the real backstop.
      }
      socket.close();
      killTree(child);
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // A leftover profile in the temp dir is harmless.
      }
    },
  };
  return client;
}
