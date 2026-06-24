// Wire shapes returned by the gateway intents the dashboard reads. (The gateway owns the source
// of truth; these mirror its JSON responses for type-safe rendering.)

export interface Milestone {
  id: string;
  title: string;
  status: string;
  metric_target: number | null;
  metric_current: number | null;
  metric_direction: string | null;
  progress: number;
}

export interface ObjectiveNode {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  weight: number | null;
  target_completion: string | null;
  progress: number;
  milestones: Milestone[];
  children: ObjectiveNode[];
}

export interface ActivityItem {
  type: "checkin" | "fact" | "learning" | "milestone";
  summary: string;
  agent_id: string | null;
  bd_id: string | null;
  created_at: string;
}

export interface AgentContext {
  agent_id: string;
  scopes: string[];
  team_id: string | null;
  org_id: string | null;
  role: "member" | "manager" | "ceo";
}

export interface ProvNode {
  id: string;
  type: "learning" | "artifact" | "run" | "objective" | "agent";
  label: string;
}
export interface ProvEdge {
  from: string;
  to: string;
  label: string;
}

export interface LearningListItem {
  id: string;
  claim: string;
  confidence: string;
  applies_to: string[];
  reuse_success_count: number;
  has_evidence: boolean;
}

export interface LeaderboardRow {
  agent_id: string;
  display_name: string;
  trust_score: number;
  learnings_authored: number;
}

export interface BriefRow {
  id: string;
  title: string;
  body: string;
  target_kind: string;
  target_id: string;
  effective_from: string;
  created_at: string;
}
