import { createContext, type ReactNode } from 'react';

/**
 * The compact game navigation, rendered inside every modal `Dialog` while a game is open. Headless
 * UI makes the page behind a dialog inert, so the bar has to live in the dialog layer to stay
 * tappable; `null` outside a game.
 */
export const DialogNavContext = createContext<ReactNode>(null);
