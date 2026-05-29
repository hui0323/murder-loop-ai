import { Clock, MapPin } from 'lucide-react';
import { motion } from 'motion/react';

interface HeaderProps {
  time: string;
  location: string;
}

export function Header({ time, location }: HeaderProps) {
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
    </header>
  );
}
