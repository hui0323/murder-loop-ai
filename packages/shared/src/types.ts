export type GamePhase =
  | 'intro'
  | 'loop_started'
  | 'investigating'
  | 'killer_pressure'
  | 'police_called'
  | 'false_police_arrived'
  | 'pre_2347_countdown'
  | 'post_2347_escalation'
  | 'escape_attempt'
  | 'confrontation'
  | 'death'
  | 'survived'
  | 'ending';

export type KillerPhase =
  | 'confirming_package'
  | 'package_recovery'
  | 'soft_pressure'
  | 'deception'
  | 'forced_entry'
  | 'evidence_erasure'
  | 'framing'
  | 'violence'
  | 'retreat'
  | 'exposed';

export type PolicePhase =
  | 'not_contacted'
  | 'call_started'
  | 'verifying_report'
  | 'dispatch_pending'
  | 'real_police_en_route'
  | 'delayed'
  | 'arrived'
  | 'misled';

export type LinYuePhase =
  | 'unaware'
  | 'received_photo'
  | 'worried'
  | 'calling_player'
  | 'calling_police'
  | 'coming_to_apartment'
  | 'endangered'
  | 'safe'
  | 'injured'
  | 'dead';

export type EvidencePhase =
  | 'package_unnoticed'
  | 'package_seen'
  | 'package_opened'
  | 'package_photographed'
  | 'evidence_shared'
  | 'evidence_backed_up'
  | 'evidence_hidden'
  | 'evidence_destroyed'
  | 'evidence_submitted';

export type StoryTone = 'neutral' | 'memory' | 'clue' | 'threat' | 'death' | 'win' | 'system';
export type StoryChannel = 'ambient' | 'action' | 'memory' | 'system';

export type EndingId =
  | 'default_murder'
  | 'opened_to_fake_police'
  | 'window_route_death'
  | 'hidden_inside_death'
  | 'framed_survivor'
  | 'escaped_without_truth'
  | 'survived_with_evidence'
  | 'perfect_truth';

export type ScoreRank = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export type ActionIntent =
  | 'inspect'
  | 'secure_entry'
  | 'record'
  | 'communicate'
  | 'call_police'
  | 'verify_identity'
  | 'deceive'
  | 'hide_evidence'
  | 'preserve_evidence'
  | 'open_door'
  | 'self_care'
  | 'wait'
  | 'escape'
  | 'unknown';

export type ActionTarget =
  | 'package'
  | 'phone'
  | 'front_door'
  | 'window'
  | 'closet'
  | 'bed'
  | 'bathroom'
  | 'chair'
  | 'linyue'
  | 'chen_huaimin'
  | 'police'
  | 'room'
  | 'self'
  | 'unknown';

export interface ParsedAction {
  id: string;
  raw: string;
  intent: ActionIntent;
  target: ActionTarget;
  method?: string;
  confidence: number;
  timeCost: number;
  noise: number;
  risk: 'low' | 'medium' | 'high';
}

export interface ActionPlan {
  id: string;
  raw: string;
  summary: string;
  actions: ParsedAction[];
  confidence: number;
  warnings: string[];
}

export interface StoryLogEntry {
  id: string;
  run: number;
  minute: number;
  title: string;
  text: string;
  tone: StoryTone;
  channel?: StoryChannel;
  isAiNarration?: boolean;
}

export interface MemoryFragment {
  id: string;
  run: number;
  title: string;
  text: string;
}

export interface ClueRecord {
  id: string;
  title: string;
  detail: string;
  source: string;
  weight: number;
}

export interface RoomObjectState {
  id: string;
  name: string;
  location: string;
  visible: boolean;
  inspected: boolean;
  state: Record<string, boolean | number | string | null>;
}

export interface KillerKnowledge {
  knowsPackageAt503: boolean;
  knowsPlayerOpenedPackage: boolean | 'uncertain';
  knowsPlayerPhotographedPackage: boolean;
  knowsPlayerContactedLinYue: boolean;
  knowsDoorBarricaded: boolean;
  knowsWindowLocked: boolean;
  knowsPoliceCalled: boolean;
  suspectsPlayerIsAlert: boolean;
  knowsEvidenceLocation: string | null;
}

export interface PlayerCondition {
  injury: 'none' | 'minor' | 'bleeding' | 'leg_injured' | 'critical';
  stress: number;
  hidden: boolean;
}

export interface GameState {
  run: number;
  minute: number;
  phase: GamePhase;
  killerPhase: KillerPhase;
  policePhase: PolicePhase;
  linYuePhase: LinYuePhase;
  evidencePhase: EvidencePhase;
  threat: number;
  suspicion: number;
  player: PlayerCondition;
  clues: string[];
  room: Record<string, RoomObjectState>;
  killerKnowledge: KillerKnowledge;
  memory: MemoryFragment[];
  log: StoryLogEntry[];
  ending: EndingId | null;
  score: ScoreResult | null;
}

export interface RuleEvent {
  kind: 'action' | 'clue' | 'state_change' | 'sound' | 'message' | 'threat' | 'ending';
  subject: string;
  summary: string;
  sensoryHints: string[];
  visibility: 'player' | 'killer' | 'hidden';
}

export interface RuleResult {
  title: string;
  text: string;
  tone: StoryTone;
  addedClues: string[];
  timePassed: number;
  threatDelta: number;
  events: RuleEvent[];
  state: GameState;
}

export interface NarrationContext {
  run: number;
  minute: number;
  turnIndex: number;
  playerActionSummary: string;
  events: RuleEvent[];
  stateSnapshot: {
    phase: GamePhase;
    killerPhase: KillerPhase;
    policePhase: PolicePhase;
    linYuePhase: LinYuePhase;
    evidencePhase: EvidencePhase;
    threat: number;
    suspicion: number;
    injury: PlayerCondition['injury'];
    stress: number;
    clues: string[];
    ending: EndingId | null;
  };
  recentLog: Array<Pick<StoryLogEntry, 'minute' | 'title' | 'text' | 'channel'>>;
  forbiddenFacts: string[];
  styleGuide: string[];
}

export interface NpcReply {
  speaker: 'linyue' | 'police_dispatch' | 'chen_huaimin';
  text: string;
  intent: string;
  riskWarning: string;
  suggestedExternalAction: string;
}

export interface KillerStrategy {
  id: string;
  type:
    | 'phone_probe'
    | 'soft_knock'
    | 'landlord_excuse'
    | 'fake_police'
    | 'spare_key_entry'
    | 'window_route'
    | 'framing_pressure'
    | 'power_cut'
    | 'lure_linyue'
    | 'fake_neighbor'
    | 'fake_callback'
    | 'message_reply'
    | 'wait_for_fatigue'
    | 'retreat';
  title: string;
  rationale: string;
  responseHint?: string;
  visibleToPlayer: boolean;
  risk: 'low' | 'medium' | 'high';
}

export interface Narration {
  title: string;
  text: string;
}

export interface ScoreResult {
  total: number;
  rank: ScoreRank;
  survival: number;
  truth: number;
  evidence: number;
  npc: number;
  injury: number;
  riskControl: number;
  notes: string[];
}

export interface TurnResolution {
  plan: ActionPlan;
  playerResult: RuleResult;
  killerStrategy: KillerStrategy;
  killerResult: RuleResult;
  narration: Narration;
  actionNarration?: Narration;
  ambientNarration?: Narration;
  finalState: GameState;
}

export interface AmbientResolution {
  ambientResult: RuleResult;
  killerStrategy: KillerStrategy;
  killerResult: RuleResult;
  narration: Narration;
  finalState: GameState;
}
