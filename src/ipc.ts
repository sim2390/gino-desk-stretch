// The names the card page and the Rust side use to talk (see bridge.ts and src-tauri/src/card.rs).
export const IPC = {
  // Rust → card: events

  /** show this (a ShowPayload). There's no hide: Rust closes the card's window instead. */
  show: 'show',

  // card → Rust: commands

  /** the page is listening: send the card that's waiting, if any */
  ready: 'card_ready',
  /** a CardAction, as { name, data }; answers with an ActionReply */
  action: 'card_action',
  /** the window needs to be this tall, as { height } (CSS px, shadow room included) */
  resize: 'card_resize',
  /** the close animation finished */
  closed: 'card_closed',
} as const;
