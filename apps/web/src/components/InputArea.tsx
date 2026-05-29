import { useLayoutEffect, useRef, useState } from 'react';
import { Loader2, BrainCircuit } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface InputAreaProps {
  onActionSubmit: (action: string) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
  isParsing: boolean;
  confirmationText: string | null;
}

export function InputArea({ onActionSubmit, onConfirmAction, onCancelAction, isParsing, confirmationText }: InputAreaProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = input ? `${Math.min(textarea.scrollHeight, 112)}px` : '64px';
    textarea.scrollTop = textarea.scrollHeight;
  }, [input]);

  const submitCurrentInput = () => {
    if (!input.trim() || isParsing || confirmationText) return;
    onActionSubmit(input.trim());
    setInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCurrentInput();
  };

  // Keyboard shortcut hint logic could go here
  
  return (
    <div className="shrink-0 z-10 relative pb-10 pt-20 px-4 md:px-12 bg-gradient-to-t from-[#08080a] via-[#08080a] to-transparent">
      <div className="max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          {confirmationText ? (
            <motion.div
              key="confirmation"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="border-l border-indigo-900/40 pl-5 py-2 flex flex-col sm:flex-row gap-6 items-start sm:items-end justify-between relative"
            >
              <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gradient-to-b from-transparent via-indigo-500/30 to-transparent"></div>
              <div className="flex-1 flex gap-4 text-sm mt-1">
                <BrainCircuit className="w-5 h-5 text-indigo-500/60 shrink-0 mt-1" />
                <div>
                  <div className="text-zinc-600 font-mono text-[10px] mb-2 uppercase tracking-[0.2em]">系统解析 // System Parsing</div>
                  <div className="text-[#c9c9c9] font-serif text-base tracking-wide leading-relaxed">{confirmationText}</div>
                </div>
              </div>
              <div className="flex items-center gap-5 shrink-0 mb-1">
                <button 
                  onClick={onCancelAction}
                  className="font-mono text-xs text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest relative group"
                >
                  <span className="opacity-0 group-hover:opacity-100 absolute -left-3 transition-opacity">‹</span> 
                  重新选择 
                  <span className="text-[10px] text-zinc-600 ml-1">ESC</span>
                </button>
                <button 
                  onClick={onConfirmAction}
                  className="font-mono text-xs text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest relative group"
                >
                  执行抉择 
                  <span className="text-[10px] text-indigo-500/50 ml-1">ENT</span>
                  <span className="opacity-0 group-hover:opacity-100 absolute -right-3 transition-opacity">›</span>
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.form
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={handleSubmit}
              className="relative group w-full"
            >
              <div className="relative flex items-end justify-between transition-all duration-700 bg-gradient-to-r from-zinc-900/40 via-transparent to-transparent border-l-2 border-transparent group-focus-within:border-zinc-500/30 pl-6 py-3">
                
                {/* Subtle prompt marker */}
                <div className="absolute left-[-2px] top-1/2 -translate-y-1/2 w-[2px] h-0 bg-zinc-300 transition-all duration-700 group-focus-within:h-3/4"></div>

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="写下你的抉择..."
                  rows={1}
                  disabled={isParsing}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  className="flex-1 max-h-28 bg-transparent border-none outline-none resize-none font-serif text-[22px] md:text-3xl text-[#e2e2e2] placeholder:text-zinc-700/60 placeholder:font-serif py-2.5 md:py-3 transition-all duration-500 overflow-y-auto leading-[1.35] tracking-wide"
                  style={{ minHeight: '64px' }}
                />
                
                <div className="flex items-center pl-4 shrink-0 transition-opacity duration-500 opacity-0 group-focus-within:opacity-100 md:opacity-100">
                  <button
                    type="submit"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      submitCurrentInput();
                    }}
                    onClick={(event) => event.preventDefault()}
                    disabled={!input.trim() || isParsing}
                    className="w-12 h-12 rounded-full border border-zinc-800/50 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/30 disabled:opacity-30 disabled:hover:text-zinc-500 disabled:hover:border-zinc-800/50 disabled:hover:bg-transparent transition-all duration-500"
                  >
                    {isParsing ? <Loader2 className="w-5 h-5 animate-spin" /> : <span className="font-serif text-lg tracking-widest ml-1">写</span>}
                  </button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
