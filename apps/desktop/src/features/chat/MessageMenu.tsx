import { useEffect, useRef } from 'react';
import { QUICK_REACTIONS } from './emoji';
import {
  CopyIcon,
  PencilIcon,
  PinIcon,
  SmileIcon,
  TrashIcon,
} from '../../components/icons';

export interface MessageMenuActions {
  onReact: (emoji: string) => void;
  /** Opens the full picker at the position the menu was standing in. */
  onMoreEmoji: (at: { x: number; y: number }) => void;
  onEdit?: () => void;
  onPin?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  pinned: boolean;
  /**
   * Why pinning is not on offer, when it is not. An item that is simply absent
   * looks like a missing feature; one that says which permission it wants is
   * something an administrator can act on.
   */
  pinDisabledReason?: string;
}

/**
 * The right-click menu on a message. It replaces the hover bin: hover controls
 * have to be discovered by accident and they cover the message they belong to,
 * while a context menu is where everybody already looks for "do something to
 * this thing" - and it has room for the actions a corner button never had.
 *
 * The first click on a destructive item arms it; the second confirms. Same
 * bargain the bin made, without a modal for a one-line message.
 */
export function MessageMenu({
  at,
  actions,
  armedDelete,
  onArmDelete,
  onClose,
}: {
  at: { x: number; y: number };
  actions: MessageMenuActions;
  armedDelete: boolean;
  onArmDelete: () => void;
  onClose: () => void;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  const width = 208;
  const rows = 1 + [actions.onEdit, actions.onPin, actions.onCopy, actions.onDelete].filter(Boolean).length;
  const height = 52 + rows * 34;
  const left = Math.min(at.x, window.innerWidth - width - 8);
  const top = Math.min(at.y, window.innerHeight - height - 8);

  return (
    <div
      ref={box}
      role="menu"
      aria-label="Message actions"
      style={{ left, top, width }}
      className="fixed z-50 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 py-1 shadow-pop"
    >
      <div className="flex items-center gap-1 border-b border-edge px-2 pb-2 pt-1">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="menuitem"
            onClick={() => {
              actions.onReact(emoji);
              onClose();
            }}
            aria-label={`React with ${emoji}`}
            className="cursor-pointer rounded p-1 text-lg leading-none transition-colors duration-150 hover:bg-white/[0.06]"
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            actions.onMoreEmoji(at);
            onClose();
          }}
          aria-label="More emoji"
          title="More emoji"
          className="ml-auto cursor-pointer rounded p-1 text-slate-300 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <SmileIcon className="h-4 w-4" />
        </button>
      </div>

      {actions.onEdit && (
        <Item icon={<PencilIcon className="h-4 w-4" />} label="Edit message" onClick={() => {
          actions.onEdit?.();
          onClose();
        }} />
      )}
      {actions.onPin ? (
        <Item
          icon={<PinIcon className="h-4 w-4" />}
          label={actions.pinned ? 'Unpin message' : 'Pin message'}
          onClick={() => {
            actions.onPin?.();
            onClose();
          }}
        />
      ) : (
        <Item
          icon={<PinIcon className="h-4 w-4" />}
          label="Pin message"
          hint={actions.pinDisabledReason}
          disabled
          onClick={() => undefined}
        />
      )}
      {actions.onCopy && (
        <Item icon={<CopyIcon className="h-4 w-4" />} label="Copy text" onClick={() => {
          actions.onCopy?.();
          onClose();
        }} />
      )}
      {actions.onDelete && (
        <Item
          icon={<TrashIcon className="h-4 w-4" />}
          label={armedDelete ? 'Click again to delete' : 'Delete message'}
          danger
          onClick={() => {
            if (!armedDelete) {
              onArmDelete();
              return;
            }
            actions.onDelete?.();
            onClose();
          }}
        />
      )}
    </div>
  );
}

function Item({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  hint,
}: {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150 ${
        disabled
          ? 'cursor-not-allowed text-slate-500'
          : danger
            ? 'cursor-pointer text-danger hover:bg-danger hover:text-white'
            : 'cursor-pointer text-slate-200 hover:bg-white/[0.07] hover:text-slate-100'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        {label}
        {disabled && hint && <span className="block text-xs text-slate-600">{hint}</span>}
      </span>
    </button>
  );
}
