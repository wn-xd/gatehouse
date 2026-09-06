/**
 * Terminal control sequences for entering and leaving the full-screen UI.
 *
 * Colour, styling and layout all live in the cell buffer now (see buffer.ts and
 * theme.ts), which resolves styles per cell and emits them as part of a diffed
 * frame. What remains here is only the session-level control the app needs when
 * it starts and stops.
 */

const ESC = '\x1b[';

/**
 * The alternate screen buffer: the UI draws on a separate surface, so quitting
 * restores the user's scrollback and prompt exactly as they left it.
 */
export const ALT_SCREEN_ON = `${ESC}?1049h`;
export const ALT_SCREEN_OFF = `${ESC}?1049l`;

/** Hide the cursor while painting; a blinking cursor in a rendered UI is noise. */
export const HIDE_CURSOR = `${ESC}?25l`;
export const SHOW_CURSOR = `${ESC}?25h`;
