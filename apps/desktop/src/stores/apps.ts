/**
 * Which of the shared activities has the voice stage.
 *
 * A flag, and nothing else. The stage is the big rectangle in the middle of a
 * voice channel - the tiles, or a shared video, or a board - and everything two
 * people do together in a call is drawn there rather than in a popover hanging
 * off a button. That was tried and it was wrong twice: a games library is too
 * big for a popover, and a popover over a call is a thing that covers the faces
 * it is supposed to sit beside.
 *
 * So the Apps button opens an *Apps screen* on the stage, and picking something
 * there replaces it with that activity's own panel. One more screen, on the
 * surface everything else already uses.
 *
 * Local, like the other two panel flags: which screen one person is looking at
 * is not a thing to broadcast to the call.
 *
 * This store deliberately imports nothing. The three panels are mutually
 * exclusive, and that is enforced where the switching happens - `VoiceControls`
 * and `AppsPanel` - because a store that closed the other two would have to
 * import them, and they would have to import it back.
 */
import { create } from 'zustand';

interface AppsState {
  /** True while the chooser has the stage. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useAppsStore = create<AppsState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
