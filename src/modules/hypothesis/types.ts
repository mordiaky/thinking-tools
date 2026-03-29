export interface HypothesisRecord {
  id: string;
  title: string;
  description: string;
  confidence: number;
  status: "active" | "confirmed" | "rejected";
  tags: string[];
  context: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution: "confirmed" | "rejected" | null;
  final_evidence: string | null;
}

export interface EvidenceRecord {
  id: string;
  hypothesis_id: string;
  type: "supporting" | "contradicting" | "neutral";
  description: string;
  weight: number;
  source: string | null;
  confidence_before: number;
  confidence_after: number;
  created_at: string;
}

export interface ConfidenceHistoryEntry {
  id: string;
  hypothesis_id: string;
  confidence: number;
  reason: string;
  created_at: string;
}

export interface HypothesisWithCounts extends HypothesisRecord {
  evidence_count: number;
  supporting_count: number;
  contradicting_count: number;
}

export interface HypothesisHistoryEvent {
  timestamp: string;
  event_type: "created" | "evidence_added" | "confidence_changed" | "resolved";
  details: Record<string, unknown>;
}
