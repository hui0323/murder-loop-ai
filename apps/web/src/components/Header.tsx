import { Clock, MapPin, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { VolumeControl } from './VolumeControl';

interface HeaderProps {
  time: string;
  location: string;
  onRestart?: () => void;
}

export function Header({ time, location, onRestart }: HeaderProps) {
  const [confirming, setConfirming] = useState(false);

  const handleRestartClick = () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setConfirming(false);
    onRestart?.();
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-20">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-zinc-300 font-mono text-lg tracking-wider">
          <Clock className="w-4 h-4 text-zinc-500" />
          <motion.span
            key={time}
            initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
          >
            {time}
          </motion.span>
        </div>
        <div className="h-4 w-px bg-white/10 hidden sm:block" />
        <div className="hidden sm:flex items-center gap-2 text-zinc-400 font-sans text-sm">
          <MapPin className="w-3.5 h-3.5" />
          {location}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <VolumeControl />
        {onRestart && (
          <button
            type="button"
            onClick={handleRestartClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              confirming
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-white/10'
            }`}
            title="清除游戏上下文，重新开始"
            aria-label="重新开始游戏"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {confirming ? '确认重置？' : '重新开始'}
          </button>
        )}
      </div>
    </header>
  );
}
