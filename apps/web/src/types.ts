export type GamePhase = 
  | 'intro'
  | 'loop_started'
  | 'investigating'
  | 'killer_pressure'
  | 'death'
  | 'survived';

export type EndingId =
  | 'default_murder'
  | 'opened_to_fake_police'
  | 'window_route_death'
  | 'hidden_inside_death'
  | 'framed_survivor'
  | 'escaped_without_truth'
  | 'survived_with_evidence'
  | 'perfect_truth';

export interface StoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string; // e.g. "23:00"
}

export interface Clue {
  id: string;
  name: string;
  description: string;
  status: 'new' | 'known' | 'lost';
}

export interface DirectorScore {
  slot: 'action' | 'ambient';
  total: number;
  pace: number;
  infoSafety: number;
  ruleConsistency: number;
  prose: number;
  verdict: 'pass' | 'rewrite';
  issues: string[];
  rewriteBrief: string;
  source: 'heuristic' | 'ai' | 'ai_rewrite';
}

export interface CoordinationState {
  warnings: string[];
  facts?: unknown;
  directorScores?: DirectorScore[];
  trace?: Array<{
    taskId: string;
    source: string;
    decision?: string;
    warnings: string[];
    durationMs: number;
  }>;
  judgements?: Record<string, unknown>;
}

export interface GameState {
  time: string; // "23:00"
  location: string;
  phase: GamePhase;
  storyLog: StoryNode[];
  clues: Clue[];
  isParsing: boolean;
  isParsingAction: boolean;
  actionConfirmation: string | null;
  coreState?: unknown;
  ending?: EndingId | null;
  deathTitle?: string | null;
  deathSummary?: string | null;
  deathMethod?: string | null;
  coordination?: CoordinationState;
}
