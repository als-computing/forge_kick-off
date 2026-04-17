/** GIWAXS frontend types matching gixsgui_api backend schemas */

export type DatasetStatus =
  | "loaded"
  | "params_set"
  | "q_converted"
  | "indexed"
  | "fitting"
  | "exported";

export interface DatasetFeatures {
  total_intensity: number;
  mean_intensity: number;
  max_intensity: number;
  std_intensity: number;
  min_intensity?: number | null;
  median_intensity?: number | null;
  p95_intensity?: number | null;
  q_centroid: number | null;
  qz_centroid: number | null;
  anisotropy: number | null;
  radial_width: number | null;
  peak_count: number;
  timestamp: number | null;
}

export interface Dataset {
  id: string;
  imageId: string;
  name: string;
  filename: string;
  detector: string;
  energy: number;
  status: DatasetStatus;
  createdAt: number;
  params?: GIXSParams;
  indexingPeaks?: IndexingResult["peaks"];
  detectedPeaks?: DetectedPeak[];
  /** When set and no imageId, viewer shows pre-computed Tiled qmap (write-back flow) */
  tiledQmapUrl?: string | null;
  /** Computed features for sorting/filtering/clustering in Explore tab */
  features?: DatasetFeatures;
  /** UMAP coordinates (2D projection for Explore map view) */
  umapCoords?: [number, number] | null;
  /** Extra metadata including pre-computed UMAP coordinates for different embedding types */
  extra_metadata?: Record<string, unknown>;
}

export interface GIXSParams {
  camera?: string;
  pixel_size?: [number, number];
  beam_position?: [number, number];
  sdd?: number;
  energy?: number;
  geometry?: number;
  incident_angle?: number;
  specular_position?: [number, number];
}

export interface ImageMetadata {
  image_id: string;
  im_dim: [number, number];
  camera: string;
  energy: number;
  filename?: string;
  beam_position?: [number, number] | null;
  sdd?: number | null;
  incident_angle?: number | null;
  specular_position?: [number, number] | null;
  geometry?: number;
  pixel_size?: [number, number];
  /** Persisted features from backend (Explore/sorting/clustering) */
  features?: DatasetFeatures;
  /** Extra metadata including UMAP coordinates, VAE embeddings, etc. */
  extra_metadata?: Record<string, unknown>;
  /** Tiled Q-map URL for write-back flow */
  tiled_qmap_url?: string | null;
}

export interface DisplayData {
  mode: string;
  data: number[][];
  im_dim: [number, number];
  xrange?: [number, number];
  yrange?: [number, number];
  xdata?: number[];
  ydata?: number[];
}

export interface Constraint {
  operator: number;
  flag: number;
  lower: number;
  upper: number;
}

export interface LinecutRequest {
  image_id: string;
  x_flag: number;
  constraints?: Constraint[];
  num_points?: number;
  data_flag?: number;
  include_mapdata?: boolean;
}

export interface LinecutResult {
  x: number[];
  y: number[];
  mapdata?: Record<string, number[]>;
}

export interface IndexingRequest {
  lattice: [number, number, number, number, number, number];
  space_group: number;
  orientation: [number, number, number];
  orientation_method?: number;
  h_range?: [number, number];
  k_range?: [number, number];
  l_range?: [number, number];
  energy?: number;
  incident_angle?: number;
  film_refractive_index_real?: number;
  film_refractive_index_imag?: number;
  qdeadband?: number;
  qcutoff?: number;
}

export interface IndexingResult {
  peaks?: Array<{
    kind: "BA" | "DWBA_T" | "DWBA_R";
    qxy: number;
    qz: number;
    label: string;
  }>;
  [key: string]: unknown;
}

export interface DetectedPeak {
  qxy: number;
  qz: number;
  intensity: number;
}

export interface DetectedPeaksResult {
  peaks: DetectedPeak[];
  coverage: {
    bins: [number, number];
    covered: number;
    total: number;
    ratio: number;
  };
  findpeaks_elapsed_s?: number;
}

export interface ScoreByOrientationsResult {
  peaks: DetectedPeak[];
  coverage: { bins: [number, number]; covered: number; total: number; ratio: number };
  findpeaks_elapsed_s?: number;
  by_orientation: Array<{
    orientation: [number, number, number];
    scores: SpaceGroupScore[];
    score_elapsed_s: number;
    best: SpaceGroupScore | null;
  }>;
}

export interface SpaceGroupScore {
  space_group: number;
  match_ratio: number;
  mean_distance: number;
  score: number;
}

export interface SpaceGroupScoreResult {
  scores: SpaceGroupScore[];
  peaks: DetectedPeak[];
  coverage: {
    bins: [number, number];
    covered: number;
    total: number;
    ratio: number;
  };
}

export interface FastSpaceGroupScore {
  space_group: number;
  orientation: [number, number, number];
  match_ratio: number;
  mean_distance: number;
  score: number;
}

export interface FastScoreResult {
  scores: FastSpaceGroupScore[];
  peaks: DetectedPeak[];
  coverage: {
    bins: [number, number];
    covered: number;
    total: number;
    ratio: number;
  };
  findpeaks_elapsed_s: number;
  ml_elapsed_s: number;
  refine_elapsed_s: number;
  total_elapsed_s: number;
  ml_candidates: number[];
  ml_available: boolean;
}

export interface FindPeakRequest {
  image_id: string;
  vertex: number[][];
  data_flag?: number;
  fit_flag?: number;
}

export interface PeakResult {
  x: number;
  y: number;
  Path?: { x: number; y: number };
}

export interface LineFitRequest {
  data: [number, number][];
  model?: string;
  background?: string;
  n_peaks?: number;
}

export interface FitResult {
  params?: Record<string, number>;
  fit?: number[];
  [key: string]: unknown;
}

export interface WorkflowState {
  activeTab: "workflow" | "wizard" | "panels";
  workflowNodes?: unknown;
  workflowEdges?: unknown;
}

export interface ClusterRequest {
  image_ids: string[];
  features: string[];
  n_clusters?: number;
  method?: "kmeans" | "dbscan" | "hierarchical";
}

export interface ClusterResponse {
  labels: number[];
  centroids: number[][];
  feature_matrix: number[][];
  feature_names: string[];
}

export interface UmapRequest {
  image_ids: string[];
  features: string[];
  n_neighbors?: number;
  min_dist?: number;
}

/** UMAP on flattened pixel arrays (each image resized to target_size x target_size). */
export interface UmapPixelsRequest {
  image_ids: string[];
  target_size?: number;
  n_neighbors?: number;
  min_dist?: number;
  use_log?: boolean;
}

export interface UmapResponse {
  embedding: number[][];
  image_ids: string[];
}

// =============================================================================
// Comprehensive Embedding API Types
// =============================================================================

export type EmbeddingMethod =
  | "features"
  | "pixels"
  | "qmap"
  | "radial"
  | "azimuthal"
  | "peaks"
  | "multiscale"
  | "polar"
  | "sectors";

export type ReductionMethod = "umap" | "tsne" | "pacmap" | "pca";

export type NormalizationMethod = "none" | "minmax" | "zscore" | "robust";

export interface PreprocessingOptions {
  use_log?: boolean;
  normalization?: NormalizationMethod;
  clip_percentile?: number | null;
  gaussian_sigma?: number | null;
  median_size?: number | null;
  mask_threshold?: number | null;
  q_range?: [number, number] | null;
}

export interface EmbeddingRequest {
  image_ids: string[];
  embedding_method?: EmbeddingMethod;
  reduction_method?: ReductionMethod;
  n_components?: 2 | 3;
  preprocessing?: PreprocessingOptions;
  // Method-specific
  target_size?: number;
  n_bins?: number;
  n_sectors?: number;
  scales?: number[];
  // Reduction params
  n_neighbors?: number;
  min_dist?: number;
  perplexity?: number;
  // Feature selection
  features?: string[];
}

export interface EmbeddingResponse {
  embedding: number[][];
  image_ids: string[];
  method: string;
  reduction: string;
  n_components: number;
  explained_variance?: number[] | null;
}

export type ClusteringMethod =
  | "kmeans"
  | "hdbscan"
  | "dbscan"
  | "spectral"
  | "gmm"
  | "hierarchical";

export interface ClusteringRequest2 {
  embedding: number[][];
  image_ids: string[];
  method?: ClusteringMethod;
  n_clusters?: number;
  min_cluster_size?: number;
  eps?: number;
  min_samples?: number;
  linkage?: "ward" | "complete" | "average" | "single";
}

export interface ClusteringResponse2 {
  labels: number[];
  image_ids: string[];
  n_clusters: number;
  method: string;
  silhouette_score?: number | null;
}

export type OutlierMethod = "isolation_forest" | "lof" | "distance";

export interface OutlierRequest {
  embedding: number[][];
  image_ids: string[];
  method?: OutlierMethod;
  contamination?: number;
  n_neighbors?: number;
  threshold_percentile?: number;
}

export interface OutlierResponse {
  outlier_scores: number[];
  is_outlier: boolean[];
  image_ids: string[];
  method: string;
  n_outliers: number;
}

export interface NearestNeighborsRequest {
  embedding: number[][];
  image_ids: string[];
  query_id: string;
  k?: number;
}

export interface NearestNeighborsResponse {
  query_id: string;
  neighbor_ids: string[];
  distances: number[];
}

export interface DensityRequest {
  embedding: number[][];
  grid_size?: number;
  bandwidth?: number | null;
}

export interface DensityResponse {
  x_grid: number[];
  y_grid: number[];
  density: number[][];
}

export interface UserFolder {
  id: string;
  name: string;
  parentId: string | null;  // null = root
  datasetIds: string[];     // manually assigned datasets
  isExpanded: boolean;
}

export type SmartFolderRuleType = 
  | "name_contains" | "name_starts" | "name_ends" | "name_regex"
  | "path_contains"
  | "status_equals" | "status_not"
  | "feature_gt" | "feature_lt" | "feature_eq" | "feature_between"
  | "has_peaks" | "no_peaks";

export interface SmartFolderRule {
  id: string;
  type: SmartFolderRuleType;
  field?: string;           // feature name or status value
  value?: string | number;
  value2?: number;          // for "between" ranges
}

export interface SmartFolder {
  id: string;
  name: string;
  icon?: string;            // emoji or icon name
  color?: string;           // accent color
  rules: SmartFolderRule[];
  matchMode: "all" | "any"; // AND vs OR
}
