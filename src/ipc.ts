// The message channels between the main process and the card window (see preload.ts).
export const IPC = {
  /** main → card: show this (a ShowPayload) */
  show: 'show',
  /** main → card: put the card away now */
  hide: 'hide',
  /** card → main: a CardAction; answers with an ActionReply */
  action: 'card:action',
  /** card → main: the window needs to be this tall */
  resize: 'card:resize',
  /** card → main: the close animation finished */
  closed: 'card:closed',
} as const;
