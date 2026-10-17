// The only bridge between the card page and the Rust side (src-tauri/src/card.rs): puts
// window.ginoApi on the page when it runs in the app. Imported first by card.ts, so the API is
// there before the card looks for it. Anywhere else (the dev pages, the screens report) it does
// nothing, and the card runs without window.ginoApi.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { IPC } from './ipc';
import type { ActionReply, GinoApi, ShowPayload } from './types';

if ('__TAURI_INTERNALS__' in window) {
  const report = (e: unknown) => console.error(e);

  const api: GinoApi = {
    onShow(cb) {
      // Say we're ready only once the listener is in place: Rust holds a card back until
      // then, so a show can't arrive while nobody is listening.
      getCurrentWebviewWindow()
        .listen<ShowPayload>(IPC.show, (e) => cb(e.payload))
        .then(() => invoke(IPC.ready))
        .catch(report);
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

  // No web view menu on right-click (Back, Refresh, Save as, Print...): Refresh would reload
  // the card, and Print or Save as would take the focus the card never takes.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // The card never takes keyboard focus, so keys shouldn't reach it at all. If one ever does,
  // it can't run a web view shortcut either (F5 reloads, Ctrl+P prints, Alt+Left goes back):
  // the card has nothing to type into, and plain Tab, Enter, Space and Esc still work.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || /^(F\d+|Browser\w+)$/.test(e.key)) e.preventDefault();
  });
}
