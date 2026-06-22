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
}
