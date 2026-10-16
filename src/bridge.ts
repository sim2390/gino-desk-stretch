// The only bridge between the card page and the Rust side (src-tauri/src/card.rs): puts
// window.ginoApi on the page when it runs in the app. Imported first by card.ts, so the API is
// there before the card looks for it. Anywhere else (the dev pages, the screens report) it does
// nothing, and the card runs without window.ginoApi.
import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { IPC } from './ipc';
import type { ActionReply, GinoApi, ShowPayload } from './types';

if ('__TAURI_INTERNALS__' in window) {
  const page = getCurrentWebviewWindow();
  const report = (e: unknown) => console.error(e);

  // Listeners still being registered with the Rust side.
  const listening: Promise<UnlistenFn>[] = [];
  const listen = <T>(event: string, cb: (payload: T) => void) => {
    const p = page.listen<T>(event, (e) => cb(e.payload));
    listening.push(p);
    return p;
  };

  const api: GinoApi = {
    onShow(cb) {
      // Say we're ready only once the listener is in place: Rust holds a card back until
      // then, so a show can't arrive while nobody is listening. The wait also covers the
      // hide listener, which card.ts sets up straight after this one.
      (async () => {
        await listen<ShowPayload>(IPC.show, cb);
        await Promise.all(listening);
        await invoke(IPC.ready);
      })().catch(report);
    },
    onHide(cb) {
      listen<null>(IPC.hide, () => cb()).catch(report);
    },
    action: (name, data) => invoke<ActionReply>(IPC.action, { name, data: data ?? {} }),
    resize(height) {
      invoke(IPC.resize, { height }).catch(report);
    },
    closed() {
      invoke(IPC.closed).catch(report);
    },
  };
  window.ginoApi = api;

  // Drag the card anywhere by its body; Rust remembers the spot. WebView2 ignores
  // -webkit-app-region, so the drag is started by hand. Buttons and links still click.
  document.addEventListener('mousedown', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (e.button !== 0 || !t || !t.closest('.card') || t.closest('button, a')) return;
    e.preventDefault(); // no text cursor or selection while dragging
    getCurrentWindow().startDragging().catch(report);
  });
}
