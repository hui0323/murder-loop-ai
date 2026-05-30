import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getClueAsset } from '../clueAssets';
import type { Clue } from '../types';

interface ClueRevealModalProps {
  clue: Clue | null;
  open: boolean;
  onClose: () => void;
}

export function ClueRevealModal({ clue, open, onClose }: ClueRevealModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const asset = clue ? getClueAsset(clue.id) : null;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !clue || !asset) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 px-3 py-6 backdrop-blur-[3px] animate-[clueFade_160ms_ease-out]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`发现新线索：${clue.name}`}
        tabIndex={-1}
        className="relative w-[min(92vw,1180px)] max-h-[88vh] overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl outline-none animate-[clueRise_180ms_ease-out]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="关闭线索预览"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-xl leading-none text-zinc-200 transition-colors hover:border-white/35 hover:bg-zinc-900/80 focus:outline focus:outline-1 focus:outline-white/60"
        >
          ×
        </button>

        <figure className="relative flex h-[min(88vh,760px)] min-h-[420px] items-center justify-center bg-black">
          <img
            src={asset.imageUrl}
            alt={clue.name}
            className="h-full w-full object-cover"
            draggable={false}
          />

          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,.38)_0%,transparent_18%,transparent_58%,rgba(0,0,0,.68)_100%)]" />

          <div className="pointer-events-none absolute left-6 top-6 max-w-[50%]">
            <p className="truncate font-mono text-xs tracking-widest text-zinc-300/70">发现新线索</p>
            <h2 className="mt-2 truncate font-serif text-xl text-zinc-100/80">{clue.name}</h2>
          </div>

          <figcaption className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-6">
            <div className="flex max-w-[82%] items-center gap-3 rounded-full bg-black/10 px-4 py-2 text-center text-zinc-200/80 backdrop-blur-[1px]">
              <Search className="h-5 w-5 shrink-0 text-zinc-300/65" />
              <p className="truncate font-serif text-base tracking-wide md:text-lg">{clue.description}</p>
            </div>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
