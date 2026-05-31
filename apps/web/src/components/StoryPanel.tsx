import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { StoryNode } from '../types';

interface StoryPanelProps {
  log: StoryNode[];
}

export function StoryPanel({ log }: StoryPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [log]);

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 md:px-12 py-8 scroll-smooth"
    >
      <div className="max-w-2xl mx-auto space-y-8 pb-12">
        <AnimatePresence initial={false}>
          {log.map((node, index) => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: index === log.length - 1 ? 0.1 : 0 }}
              className={`flex flex-col gap-1 ${
                node.type === 'player_input' ? 'items-end' : 'items-start'
              }`}
            >
              {node.type === 'narrative' && (
                <div className="w-full">
                  {node.timestamp && (
                    <div className="text-zinc-600 font-mono text-[10px] md:text-xs mb-3 tracking-widest">— {node.timestamp}</div>
                  )}
                  <p className="font-serif text-[#d6d6d6] text-lg md:text-[22px] leading-[1.8] md:leading-[2] tracking-wide whitespace-pre-wrap">
                    {node.content}
                  </p>
                </div>
              )}
              
              {node.type === 'player_input' && (
                <div className="max-w-[82%] bg-zinc-900/90 border border-white/10 rounded-lg px-5 py-3 text-zinc-200 font-sans text-sm md:text-base shadow-lg mr-2">
                  <div className="font-mono text-[10px] text-zinc-500 tracking-[0.18em] uppercase mb-1">你发出</div>
                  <div className="leading-relaxed whitespace-pre-wrap">“{node.content}”</div>
                </div>
              )}

              {node.type === 'action_result' && (
                <div className="pl-4 border-l border-zinc-700/50 mt-2">
                  <p className="font-mono text-zinc-400 text-sm">{node.content}</p>
                </div>
              )}

              {node.type === 'system' && (
                <div className="w-full text-center my-4">
                  <span className="font-mono text-xs text-zinc-600 tracking-[0.2em] uppercase">
                    [ {node.content} ]
                  </span>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
