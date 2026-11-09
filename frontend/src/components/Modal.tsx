import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

interface ModalProps {
  /** id of the element that names the dialog (usually its heading). */
  labelledBy: string;
  describedBy?: string;
  /** Element focused when the dialog opens. */
  initialFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Accessible modal dialog: focus moves into it on open and back to the previously focused
 * element on close, and Escape closes it.
 */
export function Modal({ labelledBy, describedBy, initialFocusRef, onClose, children }: ModalProps) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Layout effect: focus and the Escape handler are in place before the dialog is painted.
  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [initialFocusRef]);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </div>
    </div>
  );
}
