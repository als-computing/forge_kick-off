export interface TreeNode {
  key: string;
  path: string;
  name: string;
  node_type: 'container' | 'dataset';
  metadata: Record<string, unknown>;
  children_count: number;
  specs: string[];
  structure_family: string | null;
}

export interface GraphNode {
  id: string;
  label: string;
  node_type: 'sample' | 'property' | 'parameter' | 'technique' | 'ontology_class' | 'phase'
    | 'material' | 'publication' | 'dataset';
  metadata: Record<string, unknown>;
  path?: string;
  // D3 simulation fields (added at runtime)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

/** Metadata-derived edge types (auto-computed from Tiled metadata) */
export type MetadataEdgeType =
  | 'has_property'
  | 'shared_param'
  | 'similar'
  | 'measured_by'
  | 'is_a'
  | 'co_measured'
  // Semantic similarity edges (new)
  | 'chemical_similarity'   // Tanimoto SMILES fingerprint similarity
  | 'grazing_angle_match'   // incident_angle_deg within ±ANGLE_TOLERANCE_DEG
  | 'temperature_match'     // AnnealingTemp within ±TEMP_TOLERANCE_C
  | 'cross_beamline'        // same sample measured at different beamlines / energies
  | 'pattern_similarity';   // vision-classified scattering patterns match

/** Persisted relationship types (stored in splash_links) */
export type SplashLinksEdgeType =
  | 'temperature_series'
  | 'composition_series'
  | 'processed_into'
  | 'repeat_of'
  | 'same_material'
  | 'aged_to'
  | 'similar_to'
  | 'flagged_as'
  | 'published_in'
  | 'reference_for'
  | 'contains_phase'
  | 'used_for';

export type AllEdgeType = MetadataEdgeType | SplashLinksEdgeType | string;

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  edge_type: AllEdgeType;
  weight: number;
  label: string;
  /** Whether this edge comes from auto-derived metadata or persisted splash_links */
  link_source?: 'metadata' | 'splash_links';
  /** splash_links link ID, if applicable */
  link_id?: string;
  /** Extra properties stored on the link */
  link_properties?: Record<string, unknown>;
}

export interface GraphStats {
  total_entries: number;
  graph_nodes: number;
  graph_edges: number;
  node_types: Record<string, number>;
  edge_types: Record<string, number>;
  reasoning?: string;
  facets_count?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export type ViewMode = 'tree' | 'graph' | 'split';

export type ConnectionStatus = 'loading' | 'connected' | 'mock' | 'disconnected';

export type Technique = 'All' | 'GIWAXS' | 'RSoXS';

export type GroupBy = string;

export type GraphMode = 'overview' | 'detail' | 'llm';

export type FilterMode = 'AND' | 'OR';

export interface GraphFilter {
  nodeTypes: string[];
  edgeTypes: string[];
}

export interface ServerInfo {
  name: string;
  uri: string;
  has_api_key: boolean;
  api_key?: string;
}
