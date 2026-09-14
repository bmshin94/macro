import type { ConfirmDialogProps } from '@ui/components/ConfirmDialog';
import { createSignal } from 'solid-js';
import { MobileConfirmationSheet } from './MobileConfirmationSheet';

/** Slide-out length; keep ≥ MobileDrawer's `duration-200` transition. */
const CLOSE_MS = 250;

/**
 * The mobile presentation of `confirmDialog`: the same confirmation contract
 * rendered as a bottom sheet. `position` and `class` are dialog-presentation
 * options and are ignored here.
 */
export function ConfirmDrawer(props: ConfirmDialogProps) {
  // A managed dismissal disposes the entry immediately, which would cut the
  // drawer's slide-out. Close internally first so the transition plays, then
  // hand the dismissal to the manager.
  const [internalOpen, setInternalOpen] = createSignal(true);
  const requestClose = () => {
    if (!internalOpen()) return;
    setInternalOpen(false);
    setTimeout(() => props.onOpenChange(false), CLOSE_MS);
  };
  const confirm = () => {
    if (!internalOpen()) return;
    setInternalOpen(false);
    setTimeout(() => props.onConfirm(), CLOSE_MS);
  };

  return (
    <MobileConfirmationSheet
      {...props}
      open={props.open && internalOpen()}
      onOpenChange={(open) => !open && requestClose()}
      onConfirm={confirm}
    />
  );
}
