/** Zustand store for GIWAXS datasets and workflow state */

import { create } from "zustand";

/** Persist project name across tab switches and reloads so it survives backgrounding */
const GIWAXS_PROJECT_NAME_KEY = "giwaxs_project_name";
const GIWAXS_FOLDERS_KEY = "giwaxs_folders";
const GIWAXS_SMART_FOLDERS_KEY = "giwaxs_smart_folders";

function getStoredProjectName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const s = localStorage.getItem(GIWAXS_PROJECT_NAME_KEY);
    return s && s.trim() ? s.trim() : null;
  } catch {
    return null;
  }
}

function setStoredProjectName(name: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (name && name.trim()) {
      localStorage.setItem(GIWAXS_PROJECT_NAME_KEY, name.trim());
    } else {
      localStorage.removeItem(GIWAXS_PROJECT_NAME_KEY);
    }
  } catch {
    /* ignore */
  }
}

function getStoredFolders(): UserFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(GIWAXS_FOLDERS_KEY);
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
}

function setStoredFolders(folders: UserFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GIWAXS_FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    /* ignore */
  }
}

function getStoredSmartFolders(): SmartFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(GIWAXS_SMART_FOLDERS_KEY);
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
}

function setStoredSmartFolders(smartFolders: SmartFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GIWAXS_SMART_FOLDERS_KEY, JSON.stringify(smartFolders));
  } catch {
    /* ignore */
  }
}
import type {
  Dataset,
  GIXSParams,
  IndexingResult,
  IndexingRequest,
  SpaceGroupScore,
  FastSpaceGroupScore,
  UserFolder,
  SmartFolder,
} from "@/types/giwaxs";
import { giwaxsApi } from "@/lib/giwaxsApi";
import { db } from "@/lib/db";
import { friendlyApiError } from "@/lib/utils";

export type IndexingPeak = NonNullable<IndexingResult["peaks"]>[number];

/** API server base URL for proxied Tiled (avoids CORS and sends auth). */
function getTiledProxyBase(): string {
  if (typeof window === "undefined") return "";
  const env = (import.meta.env.VITE_TILED_AGENTIC_URL || import.meta.env.VITE_AI_API_URL || "").replace(/\/$/, "");
  return env || `${window.location.protocol}//${window.location.hostname}:8002`;
}


/** Convert a direct Tiled URL to use our proxy. Extracts dataset ID from URL and builds proxy URL. */
function tiledUrlToProxy(tiledUrl: string | null | undefined): string | undefined {
  if (!tiledUrl) return undefined;
  // Extract dataset ID from URL like "http://127.0.0.1:8010/api/v1/metadata/dataset_id"
  const match = tiledUrl.match(/\/api\/v1\/metadata\/([^/?#]+)/);
  if (!match) return undefined;
  const datasetId = match[1];
  const apiBase = getTiledProxyBase();
  if (!apiBase) return undefined;
  return `${apiBase}/api/tiled/metadata/${encodeURIComponent(datasetId)}`;
}

/** Helper: Create Dataset object from image metadata */
function createDatasetFromMetadata(
  imageId: string,
  name: string,
  meta: {
    camera: string;
    energy: number;
    beam_position?: [number, number];
    sdd?: number;
    incident_angle?: number;
    specular_position?: [number, number];
    geometry?: number;
    pixel_size?: [number, number];
    features?: Dataset["features"];
    extra_metadata?: Record<string, unknown>;
    tiled_qmap_url?: string | null;
  }
): Dataset {
  const tiledQmapUrl = tiledUrlToProxy(meta.tiled_qmap_url);
  
  // Extract UMAP coordinates from extra_metadata if they exist
  let umapCoords: [number, number] | null = null;
  if (meta.extra_metadata) {
    const umap_x = meta.extra_metadata.umap_x as number | undefined;
    const umap_y = meta.extra_metadata.umap_y as number | undefined;
    if (typeof umap_x === 'number' && typeof umap_y === 'number') {
      umapCoords = [umap_x, umap_y];
    }
  }
  
  return {
    id: `ds-${imageId}`,
    imageId,
    name,
    filename: name,
    detector: meta.camera,
    energy: meta.energy,
    status: "loaded",
    createdAt: Date.now(),
    params: {
      camera: meta.camera,
      energy: meta.energy,
      ...(meta.beam_position && { beam_position: meta.beam_position }),
      ...(meta.sdd !== null && meta.sdd !== undefined && { sdd: meta.sdd }),
      ...(meta.incident_angle !== null && meta.incident_angle !== undefined && { incident_angle: meta.incident_angle }),
      ...(meta.specular_position && { specular_position: meta.specular_position }),
      ...(meta.geometry !== undefined && { geometry: meta.geometry }),
      ...(meta.pixel_size && { pixel_size: meta.pixel_size }),
    },
    ...(meta.features && { features: meta.features }),
    ...(meta.extra_metadata && { extra_metadata: meta.extra_metadata }),
    ...(tiledQmapUrl && { tiledQmapUrl }),
    ...(umapCoords && { umapCoords }),
  };
}

export interface GIWAXSStore {
  datasets: Dataset[];
  activeDatasetId: string | null;
  selectedIds: Set<string>;
  isLoading: boolean;
  error: string | null;
  /** Space group number when user toggles "eye" overlay; null = show normal indexing peaks */
  overlaySpaceGroup: number | null;
  /** Predicted peaks for overlay space group (from indexing API) */
  overlaySpaceGroupPeaks: IndexingPeak[] | null;
  /** Show detected peaks on the Q-map */
  showDetectedPeaksOverlay: boolean;
  /** Show indexing / predicted peaks on the Q-map */
  showIndexingPeaksOverlay: boolean;
  /** Peak overlay opacity 0–1 (1 = opaque). Lets you see data behind peaks. */
  peaksOverlayOpacity: number;
  /** Display transform: log scale type */
  logScaleType: "none" | "log2" | "log10" | "ln";
  /** Display transform: histogram clip bottom percentile (0-50) */
  histEqBottom: number;
  /** Display transform: histogram clip top percentile (50-100) */
  histEqTop: number;
  /** Bump to force viewer to refetch image data (e.g. after gap fill) */
  imageDataVersion: number;
  /** When set, main viewer shows this instead of dataset image (e.g. HiPGISAXS simulation) */
  simulationDisplay: {
    data: number[][];
    xdata: number[];
    ydata: number[];
    xrange: [number, number];
    yrange: [number, number];
    /** If true, data is already log10 so viewer should not apply log scale again */
    alreadyLog?: boolean;
  } | null;
  /** Overlay dataset ID for image comparison */
  overlayDatasetId: string | null;
  /** Overlay opacity 0–1 (0 = transparent, 1 = opaque) */
  overlayOpacity: number;

  /** Current project name for Save / Restore (JSON + git) */
  projectName: string | null;

  /** Comparison tab state (saved/restored with project) */
  comparisonState: {
    mapAId: string;
    mapBId: string;
    viewMode: "overlay" | "difference";
    overlayOpacity: number;
    differenceAbs: boolean;
    colorScale: string;
    brightness: number;
    contrast: number;
  };

  /** Last peak detection params (set when Find Peaks runs); used by Analysis Score SGs/Fast */
  lastPeakDetectionParams: {
    npts: number;
    minDistance: number;
    thresholdRel: number;
    maxPeaks: number;
    refineMode: "none" | "com" | "gaussian";
    refineWindow: number;
    detectionMethod: string;
    useDisplayTransforms?: boolean;
  } | null;
  /** Last space group scores (from Score SGs, Score Fast, or Score with pasted peaks); shown in Analysis Results */
  lastSpaceGroupScores: (SpaceGroupScore | FastSpaceGroupScore)[] | null;
  /** Last indexing request (set when Indexing runs); used by Score with pasted peaks in Peak finding */
  lastIndexingReq: IndexingRequest | null;

  /** Batch Import: runs in background when user switches tabs */
  batchImportConverting: boolean;
  /** When true, the running import loop should exit after the current file */
  batchImportStopRequested: boolean;
  batchImportFiles: Array<{
    id: string;
    filename: string;
    status: "queued" | "processing" | "complete" | "error";
    progress?: string;
    error?: string;
    timestamp: number;
  }>;

  /** Parsed CIF structure for the CIF tab: summary + XYZ string for 3D viewer */
  cifStructure: {
    summary: {
      formula: string;
      space_group: number;
      lattice_a: number;
      lattice_b: number;
      lattice_c: number;
      alpha: number;
      beta: number;
      gamma: number;
      num_sites: number;
      volume: number;
    };
    xyz: string;
  } | null;

  /** User-created folders for organizing datasets */
  folders: UserFolder[];
  /** Smart folders with rule-based filtering */
  smartFolders: SmartFolder[];
  /** Active smart folder ID for Explore tab filtering */
  activeSmartFolderId: string | null;

  /** Staged data items for processing (from Select Data tab or Graph cluster send) */
  stagedDataItems: Array<{
    id: string;
    name: string;
    source: "tiled" | "local";
    tiledId?: string;
    tiledUri?: string;
    tiledApiKey?: string;
    file?: File;
    metadata?: {
      sample_name?: string;
      bar?: number;
      sample_folder?: string;
      beamline?: string;
    };
  }>;

  /** Metadata keys selected in Browser columns to display in Explore/Viewer/Comparison */
  metadataDisplayKeys: string[];

  setActiveDataset: (id: string | null) => void;
  setSimulationDisplay: (d: GIWAXSStore["simulationDisplay"]) => void;
  setCifStructure: (s: GIWAXSStore["cifStructure"]) => void;
  setSelectedIds: (ids: Set<string>) => void;
  toggleSelection: (id: string) => void;
  selectAll: (checked: boolean) => void;
  clearError: () => void;
  setOverlaySpaceGroup: (sg: number | null, peaks: IndexingPeak[] | null) => void;
  setShowDetectedPeaksOverlay: (on: boolean) => void;
  setShowIndexingPeaksOverlay: (on: boolean) => void;
  setPeaksOverlayOpacity: (value: number) => void;
  setOverlayDatasetId: (id: string | null) => void;
  setOverlayOpacity: (value: number) => void;
  setProjectName: (name: string | null) => void;
  setComparisonState: (update: Partial<GIWAXSStore["comparisonState"]>) => void;
  setLastPeakDetectionParams: (p: GIWAXSStore["lastPeakDetectionParams"]) => void;
  setLastSpaceGroupScores: (s: GIWAXSStore["lastSpaceGroupScores"]) => void;
  setLastIndexingReq: (r: IndexingRequest | null) => void;

  /** Folder management */
  createFolder: (name: string, parentId?: string | null) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleFolderExpanded: (id: string) => void;
  moveDatasetToFolder: (datasetId: string, folderId: string | null) => void;
  moveDatasetsBulk: (datasetIds: string[], folderId: string | null) => void;

  /** Smart folder management */
  createSmartFolder: (name: string) => string;
  updateSmartFolder: (id: string, updates: Partial<SmartFolder>) => void;
  deleteSmartFolder: (id: string) => void;
  setActiveSmartFolder: (id: string | null) => void;
  getSmartFolderDatasets: (folderId: string) => Dataset[];

  /** Staged data items management */
  setStagedDataItems: (items: GIWAXSStore["stagedDataItems"]) => void;
  clearStagedDataItems: () => void;

  /** Set metadata keys to display in Explore/Viewer/Comparison */
  setMetadataDisplayKeys: (keys: string[]) => void;

  setBatchImportConverting: (v: boolean) => void;
  setBatchImportStopRequested: (v: boolean) => void;
  setBatchImportFiles: (
    filesOrUpdater:
      | GIWAXSStore["batchImportFiles"]
      | ((prev: GIWAXSStore["batchImportFiles"]) => GIWAXSStore["batchImportFiles"])
  ) => void;
  updateBatchImportFile: (
    id: string,
    update: Partial<GIWAXSStore["batchImportFiles"][number]>
  ) => void;
  setLogScaleType: (type: "none" | "log2" | "log10" | "ln") => void;
  setHistEqBottom: (value: number) => void;
  setHistEqTop: (value: number) => void;

  addDataset: (file: File) => Promise<Dataset | null>;
  addDatasetFromImageId: (imageId: string, name: string) => Promise<Dataset | null>;
  addDatasetFromTiled: (tiledUri: string, datasetId: string) => Promise<Dataset | null>;
  loadTestImage: () => Promise<Dataset | null>;
  loadSyntheticImage: (params?: { space_group?: number }) => Promise<Dataset | null>;
  loadSyntheticFromCif: (file: File) => Promise<Dataset | null>;
  loadDatasets: () => Promise<void>;
  removeDataset: (id: string) => Promise<void>;
  updateDataset: (id: string, updates: Partial<Dataset>) => void;
  /** Load current parameters for the active dataset from the database and update the store. */
  refreshActiveDatasetParams: () => Promise<void>;
  updateParams: (id: string, params: GIXSParams) => Promise<void>;
  markStatus: (id: string, status: Dataset["status"]) => void;
  bumpImageDataVersion: () => void;

  saveSession: (name?: string) => Promise<void>;
  loadSession: () => Promise<void>;
  /** Apply restored project state from backend (project + images JSON). */
  restoreProjectState: (payload: {
    project: { image_ids: string[]; active_image_id: string | null; tiled_base_url?: string | null };
    images: Record<string, Record<string, unknown>>;
    comparison?: Partial<GIWAXSStore["comparisonState"]> | null;
  }) => void;
  /** Clear in-memory datasets and selection (e.g. when current project is deleted). */
  clearProjectState: () => void;
  /** Populate Samples from a list of image IDs (e.g. after batch process when project restore has no images). */
  restoreProjectStateFromImageIds: (imageIds: string[]) => Promise<void>;
}

export const useGIWAXSStore = create<GIWAXSStore>((set, get) => ({
  datasets: [],
  activeDatasetId: null,
  selectedIds: new Set(),
  isLoading: false,
  error: null,
  overlaySpaceGroup: null,
  overlaySpaceGroupPeaks: null,
  showDetectedPeaksOverlay: false,
  showIndexingPeaksOverlay: false,
  peaksOverlayOpacity: 1,
  overlayDatasetId: null,
  overlayOpacity: 0.5,
  projectName: getStoredProjectName(),
  comparisonState: {
    mapAId: "",
    mapBId: "",
    viewMode: "overlay",
    overlayOpacity: 0.5,
    differenceAbs: false,
    colorScale: "Viridis",
    brightness: 50,
    contrast: 50,
  },
  logScaleType: "log10",
  histEqBottom: 0,
  histEqTop: 99,
  imageDataVersion: 0,
  simulationDisplay: null,
  lastPeakDetectionParams: null,
  lastSpaceGroupScores: null,
  lastIndexingReq: null,
  batchImportConverting: false,
  batchImportStopRequested: false,
  batchImportFiles: [],
  cifStructure: null,
  folders: getStoredFolders(),
  smartFolders: getStoredSmartFolders(),
  activeSmartFolderId: null,
  stagedDataItems: [],
  metadataDisplayKeys: [],

  setStagedDataItems: (items) => set({ stagedDataItems: items }),
  clearStagedDataItems: () => set({ stagedDataItems: [] }),

  setMetadataDisplayKeys: (keys) => set({ metadataDisplayKeys: keys }),

  setBatchImportConverting: (v) => set({ batchImportConverting: v }),
  setBatchImportStopRequested: (v) => set({ batchImportStopRequested: v }),
  setBatchImportFiles: (filesOrUpdater) =>
    set((s) => ({
      batchImportFiles:
        typeof filesOrUpdater === "function"
          ? filesOrUpdater(s.batchImportFiles)
          : filesOrUpdater,
    })),
  updateBatchImportFile: (id, update) =>
    set((s) => ({
      batchImportFiles: s.batchImportFiles.map((f) =>
        f.id === id ? { ...f, ...update } : f
      ),
    })),

  setActiveDataset: (id) =>
    set({
      activeDatasetId: id,
      // Keep selection in sync: the viewed dataset is the one selected for parameter checking
      selectedIds: id ? new Set([id]) : new Set(),
      overlaySpaceGroup: null,
      overlaySpaceGroupPeaks: null,
    }),

  setSimulationDisplay: (d) => set({ simulationDisplay: d }),
  setCifStructure: (s) => set({ cifStructure: s }),

  setOverlaySpaceGroup: (sg, peaks) =>
    set({ overlaySpaceGroup: sg, overlaySpaceGroupPeaks: peaks }),

  setShowDetectedPeaksOverlay: (on) =>
    set({ showDetectedPeaksOverlay: on }),
  setShowIndexingPeaksOverlay: (on) =>
    set({ showIndexingPeaksOverlay: on }),
  setPeaksOverlayOpacity: (value) =>
    set({ peaksOverlayOpacity: Math.max(0, Math.min(1, value)) }),
  
  setOverlayDatasetId: (id) =>
    set({ overlayDatasetId: id }),
  setOverlayOpacity: (value) =>
    set({ overlayOpacity: Math.max(0, Math.min(1, value)) }),

  setProjectName: (name) => {
    setStoredProjectName(name);
    set({ projectName: name });
  },
  setComparisonState: (update) =>
    set((s) => ({
      comparisonState: { ...s.comparisonState, ...update },
    })),

  setLastPeakDetectionParams: (p) =>
    set({ lastPeakDetectionParams: p }),
  setLastSpaceGroupScores: (s) =>
    set({ lastSpaceGroupScores: s }),
  setLastIndexingReq: (r) =>
    set({ lastIndexingReq: r }),
  setLogScaleType: (type) =>
    set({ logScaleType: type }),
  setHistEqBottom: (value) =>
    set({ histEqBottom: value }),
  setHistEqTop: (value) =>
    set({ histEqTop: value }),

  setSelectedIds: (ids) => set({ selectedIds: ids }),

  toggleSelection: (id) => {
    const { selectedIds } = get();
    if (selectedIds.has(id)) {
      set({ selectedIds: new Set<string>() });
    } else {
      // Single selection: make this dataset active so Parameters panel and main viewer update
      set({
        selectedIds: new Set([id]),
        activeDatasetId: id,
        overlaySpaceGroup: null,
        overlaySpaceGroupPeaks: null,
      });
    }
  },

  selectAll: (checked) => {
    const { datasets } = get();
    set({
      selectedIds: checked ? new Set(datasets.map((d) => d.id)) : new Set(),
    });
  },

  clearError: () => set({ error: null }),

  addDataset: async (file) => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/a62cc2e4-8112-41ea-8826-e1da9b08b87a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'giwaxsStore.ts:addDataset',message:'addDataset called',data:{filename:file.name},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const filename = file.name;
    const existing = get().datasets.some(
      (d) => d.filename === filename || d.name === filename
    );
    if (existing) {
      set({ error: `"${filename}" is already loaded. Skipping duplicate.` });
      return null;
    }
    set({ isLoading: true, error: null });
    try {
      const { image_id, filename: serverFilename } = await giwaxsApi.uploadImage(file);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/a62cc2e4-8112-41ea-8826-e1da9b08b87a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'giwaxsStore.ts:addDataset',message:'upload complete, getting metadata',data:{image_id,serverFilename},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      const meta = await giwaxsApi.getImageMetadata(image_id);
      const name = serverFilename || filename;
      const ds = createDatasetFromMetadata(image_id, name, meta);
      
      set((s) => {
        if (s.datasets.some((d) => d.filename === name || d.name === name)) {
          return { ...s, isLoading: false, error: `"${name}" is already in the list. Skipping duplicate.` };
        }
        return {
          ...s,
          datasets: [...s.datasets, ds],
          activeDatasetId: s.activeDatasetId ?? ds.id,
          isLoading: false,
          error: null,
        };
      });
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/a62cc2e4-8112-41ea-8826-e1da9b08b87a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'giwaxsStore.ts:addDataset',message:'dataset added to store',data:{dsId:ds.id,imageId:ds.imageId},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return ds;
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/a62cc2e4-8112-41ea-8826-e1da9b08b87a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'giwaxsStore.ts:addDataset',message:'addDataset error',data:{error:e instanceof Error ? e.message : String(e)},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      const msg = e instanceof Error ? e.message : "Upload failed";
      set({ isLoading: false, error: friendlyApiError(msg) });
      return null;
    }
  },

  addDatasetFromImageId: async (imageId, name) => {
    const alreadyLoaded = get().datasets.some(
      (d) => d.imageId === imageId || d.filename === name || d.name === name
    );
    if (alreadyLoaded) {
      set({ error: `"${name}" is already loaded. Skipping duplicate.` });
      return null;
    }
    set({ isLoading: true, error: null });
    try {
      const meta = await giwaxsApi.getImageMetadata(imageId);
      const ds = createDatasetFromMetadata(imageId, name, meta);
      
      set((s) => {
        if (s.datasets.some((d) => d.imageId === imageId || d.filename === name || d.name === name)) {
          return { ...s, isLoading: false, error: `"${name}" is already loaded. Skipping duplicate.` };
        }
        return {
          ...s,
          datasets: [...s.datasets, ds],
          activeDatasetId: ds.id,
          isLoading: false,
          error: null,
        };
      });
      return ds;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Add dataset failed";
      set({ isLoading: false, error: friendlyApiError(msg) });
      return null;
    }
  },

  addDatasetFromTiled: async (tiledUri, datasetId) => {
    const alreadyLoaded = get().datasets.some(
      (d) => d.imageId === datasetId || d.filename === datasetId || d.name === datasetId
    );
    if (alreadyLoaded) {
      set({ error: `"${datasetId}" is already loaded. Skipping duplicate.` });
      return null;
    }
    set({ isLoading: true, error: null });
    try {
      const { image_id, filename: name } = await giwaxsApi.loadFromTiled(tiledUri, datasetId);
      const meta = await giwaxsApi.getImageMetadata(image_id);
      const ds = createDatasetFromMetadata(image_id, name || datasetId, meta);
      set((s) => {
        if (s.datasets.some((d) => d.imageId === image_id || d.filename === name)) {
          return { ...s, isLoading: false, error: `"${name}" is already loaded. Skipping duplicate.` };
        }
        return {
          ...s,
          datasets: [...s.datasets, ds],
          activeDatasetId: s.activeDatasetId ?? ds.id,
          isLoading: false,
          error: null,
        };
      });
      return ds;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Load from Tiled failed";
      set({ isLoading: false, error: friendlyApiError(msg) });
      return null;
    }
  },

  loadTestImage: async () => {
    set({ isLoading: true, error: null });
    try {
      const { image_id, filename } = await giwaxsApi.loadTestImage180();
      const meta = await giwaxsApi.getImageMetadata(image_id);
      const ds = createDatasetFromMetadata(image_id, filename, meta);
      
      set((s) => ({
        datasets: [...s.datasets, ds],
        activeDatasetId: ds.id,
        isLoading: false,
        error: null,
      }));
      await get().updateParams(ds.id, {
        beam_position: [323.061, 1239.3],
        specular_position: [323.061, 1239.3],
        sdd: 261.913,
        incident_angle: 1.0,
      });
      return ds;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Load test failed";
      set({ isLoading: false, error: msg });
      return null;
    }
  },

  loadSyntheticImage: async (params?: { space_group?: number }) => {
    set({ isLoading: true, error: null });
    try {
      const res = await giwaxsApi.generateSyntheticImage({
        space_group: params?.space_group ?? 14,
        beam_x: 323.061,
        beam_y: 1239.3,
        sdd: 261.913,
        incident_angle: 1.0,
      });
      const meta = await giwaxsApi.getImageMetadata(res.image_id);
      const ds = createDatasetFromMetadata(res.image_id, res.filename, meta);
      
      set((s) => ({
        datasets: [...s.datasets, ds],
        activeDatasetId: ds.id,
        isLoading: false,
        error: null,
      }));
      await get().updateParams(ds.id, {
        beam_position: [323.061, 1239.3],
        specular_position: [323.061, 1239.3],
        sdd: 261.913,
        incident_angle: 1.0,
      });
      return ds;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Generate synthetic failed";
      set({ isLoading: false, error: msg });
      return null;
    }
  },

  loadSyntheticFromCif: async (file: File) => {
    set({ isLoading: true, error: null });
    try {
      const res = await giwaxsApi.generateSyntheticFromCif(file);
      const meta = await giwaxsApi.getImageMetadata(res.image_id);
      const ds = createDatasetFromMetadata(res.image_id, res.filename, meta);
      
      set((s) => ({
        datasets: [...s.datasets, ds],
        activeDatasetId: ds.id,
        isLoading: false,
        error: null,
      }));
      return ds;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "CIF synthetic failed";
      set({ isLoading: false, error: friendlyApiError(msg) });
      return null;
    }
  },

  loadDatasets: async () => {
    set({ isLoading: true, error: null });
    try {
      const { images } = await giwaxsApi.listImages();
      const datasets: Dataset[] = [];
      for (const imageId of images) {
        try {
          const meta = await giwaxsApi.getImageMetadata(imageId);
          // Extract UMAP coordinates from extra_metadata if present
          let umapCoords: [number, number] | null = null;
          if (meta.extra_metadata) {
            const umap_x = meta.extra_metadata.umap_x as number | undefined;
            const umap_y = meta.extra_metadata.umap_y as number | undefined;
            if (typeof umap_x === 'number' && typeof umap_y === 'number') {
              umapCoords = [umap_x, umap_y];
            }
          }
          datasets.push({
            id: `ds-${imageId}`,
            imageId,
            name: meta.filename || `Image ${imageId.slice(0, 8)}`,
            filename: meta.filename || `image-${imageId.slice(0, 8)}`,
            detector: meta.camera,
            energy: meta.energy,
            status: "loaded",
            createdAt: Date.now(),
            params: {
              camera: meta.camera,
              energy: meta.energy,
              ...(meta.beam_position && { beam_position: meta.beam_position }),
              ...(meta.sdd !== null && meta.sdd !== undefined && { sdd: meta.sdd }),
              ...(meta.incident_angle !== null && meta.incident_angle !== undefined && { incident_angle: meta.incident_angle }),
              ...(meta.specular_position && { specular_position: meta.specular_position }),
              ...(meta.geometry !== undefined && { geometry: meta.geometry }),
              ...(meta.pixel_size && { pixel_size: meta.pixel_size }),
            },
            ...(meta.features && { features: meta.features }),
            ...(meta.extra_metadata && { extra_metadata: meta.extra_metadata }),
            ...(umapCoords && { umapCoords }),
          });
        } catch {
          // skip failed lookups
        }
      }
      set((s) => ({
        ...s,
        datasets,
        isLoading: false,
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Load failed";
      set({ isLoading: false, error: friendlyApiError(msg) });
    }
  },

  removeDataset: async (id) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    set({ isLoading: true, error: null });
    try {
      await giwaxsApi.deleteImage(ds.imageId);
      set((s) => ({
        datasets: s.datasets.filter((d) => d.id !== id),
        activeDatasetId: s.activeDatasetId === id ? null : s.activeDatasetId,
        selectedIds: (() => {
          const next = new Set(s.selectedIds);
          next.delete(id);
          return next;
        })(),
        isLoading: false,
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      set({ isLoading: false, error: msg });
    }
  },

  updateDataset: (id, updates) => {
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      ),
    }));
  },

  refreshActiveDatasetParams: async () => {
    const { datasets, activeDatasetId } = get();
    const ds = datasets.find((d) => d.id === activeDatasetId);
    if (!ds) return;
    try {
      const meta = await giwaxsApi.getImageMetadata(ds.imageId);
      const params: GIXSParams = {
        camera: meta.camera,
        energy: meta.energy,
        ...(meta.beam_position != null && { beam_position: meta.beam_position }),
        ...(meta.sdd != null && meta.sdd !== undefined && { sdd: meta.sdd }),
        ...(meta.incident_angle != null && meta.incident_angle !== undefined && { incident_angle: meta.incident_angle }),
        ...(meta.specular_position != null && { specular_position: meta.specular_position }),
        ...(meta.geometry !== undefined && { geometry: meta.geometry }),
        ...(meta.pixel_size && { pixel_size: meta.pixel_size }),
      };
      get().updateDataset(ds.id, {
        detector: meta.camera,
        energy: meta.energy,
        params,
      });
    } catch {
      // Ignore fetch errors (e.g. image deleted); params stay as in store
    }
  },

  updateParams: async (id, params) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    set({ isLoading: true, error: null });
    try {
      await giwaxsApi.updateImageParams(ds.imageId, params);
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id
            ? {
                ...d,
                ...(params.energy !== undefined && { energy: params.energy }),
                ...(params.camera !== undefined && { detector: params.camera }),
                params: { ...d.params, ...params },
                status: "params_set" as const,
              }
            : d
        ),
        isLoading: false,
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      set({ isLoading: false, error: msg });
    }
  },

  markStatus: (id, status) => {
    set((s) => ({
      datasets: s.datasets.map((d) => (d.id === id ? { ...d, status } : d)),
    }));
  },

  bumpImageDataVersion: () =>
    set((s) => ({ imageDataVersion: s.imageDataVersion + 1 })),

  saveSession: async (name = "Default Session") => {
    const { datasets, activeDatasetId } = get();
    await db.sessions.add({
      name,
      datasets,
      activeDatasetId,
      updatedAt: Date.now(),
    });
  },

  loadSession: async () => {
    const sessions = await db.sessions.orderBy("updatedAt").reverse().limit(1).toArray();
    if (sessions.length > 0) {
      const sess = sessions[0];
      set((s) => ({
        ...s,
        datasets: sess.datasets,
        activeDatasetId: sess.activeDatasetId,
      }));
    }
  },

  restoreProjectState: (payload) => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/a62cc2e4-8112-41ea-8826-e1da9b08b87a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'giwaxsStore.ts:restoreProjectState',message:'restoreProjectState called',data:{hasPayload:!!payload,payloadType:typeof payload},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (!payload || typeof payload !== "object") return;
    const { project, images } = payload;
    if (!project || typeof project !== "object") return;
    const imageIds = Array.isArray(project.image_ids) ? project.image_ids : [];
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/a62cc2e4-8112-41ea-8826-e1da9b08b87a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'giwaxsStore.ts:restoreProjectState',message:'restoreProjectState processing',data:{imageIdsCount:imageIds.length,hasImages:!!images},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const imgMap = images && typeof images === "object" ? images : {};
    const tiledBaseUrl = project.tiled_base_url ?? null;
    const datasets: Dataset[] = imageIds.map((imageId) => {
      const img = imgMap[imageId] || {};
      const params = (img.params as Partial<GIXSParams>) || {};
      const filename =
        (img.filename as string) ||
        (img.name as string) ||
        `Image ${imageId.slice(0, 8)}`;
      const extra = (img.extra_metadata as Record<string, unknown> | undefined) || {};
      const umap_x = extra.umap_x as number | undefined;
      const umap_y = extra.umap_y as number | undefined;
      const umapCoords: [number, number] | null =
        typeof umap_x === "number" && typeof umap_y === "number" ? [umap_x, umap_y] : null;
      return {
        id: `ds-${imageId}`,
        imageId,
        name: filename,
        filename,
        detector: (img.detector as string) || params.camera || "Pilatus",
        energy:
          (img.energy as number) ?? (params.energy as number) ?? 10,
        status: "loaded" as const,
        createdAt: Date.now(),
        params: Object.keys(params).length ? params : undefined,
        detectedPeaks: (img.detected_peaks as Dataset["detectedPeaks"]) ?? undefined,
        indexingPeaks: (img.indexing_peaks as Dataset["indexingPeaks"]) ?? undefined,
        tiledQmapUrl: tiledUrlToProxy(img.tiled_qmap_url as string | null) ?? undefined,
        features: (img.features as Dataset["features"]) ?? (extra.features as Dataset["features"]) ?? undefined,
        extra_metadata: extra,
        ...(umapCoords && { umapCoords }),
      };
    });
    const comparison = payload.comparison;
    set((s) => ({
      ...s,
      datasets,
      activeDatasetId: project.active_image_id
        ? `ds-${project.active_image_id}`
        : datasets[0]?.id ?? null,
      ...(comparison && typeof comparison === "object"
        ? { comparisonState: { ...s.comparisonState, ...comparison } }
        : {}),
    }));
  },

  clearProjectState: () =>
    set({
      datasets: [],
      activeDatasetId: null,
      selectedIds: new Set(),
    }),

  restoreProjectStateFromImageIds: async (imageIds) => {
    if (!imageIds?.length) return;
    set({ isLoading: true, error: null });
    try {
      const datasets = await Promise.all(
        imageIds.map(async (imageId) => {
          const meta = await giwaxsApi.getImageMetadata(imageId);
          const name = (meta as { filename?: string }).filename ?? imageId;
          return createDatasetFromMetadata(imageId, name, meta as Parameters<typeof createDatasetFromMetadata>[2]);
        })
      );
      set((s) => ({
        ...s,
        datasets,
        activeDatasetId: datasets[0]?.id ?? null,
        isLoading: false,
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ isLoading: false, error: friendlyApiError(msg) });
    }
  },

  // Folder management
  createFolder: (name, parentId = null) => {
    const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newFolder: UserFolder = {
      id,
      name,
      parentId,
      datasetIds: [],
      isExpanded: true,
    };
    set((s) => {
      const updated = [...s.folders, newFolder];
      setStoredFolders(updated);
      return { folders: updated };
    });
    return id;
  },

  renameFolder: (id, name) => {
    set((s) => {
      const updated = s.folders.map((f) => f.id === id ? { ...f, name } : f);
      setStoredFolders(updated);
      return { folders: updated };
    });
  },

  deleteFolder: (id) => {
    set((s) => {
      const updated = s.folders.filter((f) => f.id !== id && f.parentId !== id);
      setStoredFolders(updated);
      return { folders: updated };
    });
  },

  toggleFolderExpanded: (id) => {
    set((s) => {
      const updated = s.folders.map((f) => 
        f.id === id ? { ...f, isExpanded: !f.isExpanded } : f
      );
      setStoredFolders(updated);
      return { folders: updated };
    });
  },

  moveDatasetToFolder: (datasetId, folderId) => {
    set((s) => {
      const updated = s.folders.map((f) => {
        if (f.id === folderId) {
          return { ...f, datasetIds: [...new Set([...f.datasetIds, datasetId])] };
        }
        return { ...f, datasetIds: f.datasetIds.filter((id) => id !== datasetId) };
      });
      setStoredFolders(updated);
      return { folders: updated };
    });
  },

  moveDatasetsBulk: (datasetIds, folderId) => {
    set((s) => {
      const updated = s.folders.map((f) => {
        if (f.id === folderId) {
          return { ...f, datasetIds: [...new Set([...f.datasetIds, ...datasetIds])] };
        }
        return { ...f, datasetIds: f.datasetIds.filter((id) => !datasetIds.includes(id)) };
      });
      setStoredFolders(updated);
      return { folders: updated };
    });
  },

  // Smart folder management
  createSmartFolder: (name) => {
    const id = `smart-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newFolder: SmartFolder = {
      id,
      name,
      rules: [],
      matchMode: "all",
    };
    set((s) => {
      const updated = [...s.smartFolders, newFolder];
      setStoredSmartFolders(updated);
      return { smartFolders: updated };
    });
    return id;
  },

  updateSmartFolder: (id, updates) => {
    set((s) => {
      const updated = s.smartFolders.map((f) => 
        f.id === id ? { ...f, ...updates } : f
      );
      setStoredSmartFolders(updated);
      return { smartFolders: updated };
    });
  },

  deleteSmartFolder: (id) => {
    set((s) => {
      const updated = s.smartFolders.filter((f) => f.id !== id);
      setStoredSmartFolders(updated);
      return { 
        smartFolders: updated,
        activeSmartFolderId: s.activeSmartFolderId === id ? null : s.activeSmartFolderId,
      };
    });
  },

  setActiveSmartFolder: (id) => {
    set({ activeSmartFolderId: id });
  },

  getSmartFolderDatasets: (folderId) => {
    const s = get();
    const folder = s.smartFolders.find((f) => f.id === folderId);
    if (!folder || folder.rules.length === 0) return s.datasets;

    return s.datasets.filter((ds) => {
      const matchResults = folder.rules.map((rule) => {
        switch (rule.type) {
          case "name_contains":
            return ds.name.toLowerCase().includes((rule.value as string || "").toLowerCase());
          case "name_starts":
            return ds.name.toLowerCase().startsWith((rule.value as string || "").toLowerCase());
          case "name_ends":
            return ds.name.toLowerCase().endsWith((rule.value as string || "").toLowerCase());
          case "name_regex":
            try {
              return new RegExp(rule.value as string || "").test(ds.name);
            } catch {
              return false;
            }
          case "path_contains":
            return ds.filename.toLowerCase().includes((rule.value as string || "").toLowerCase());
          case "status_equals":
            return ds.status === rule.value;
          case "status_not":
            return ds.status !== rule.value;
          case "feature_gt":
            return (ds.features?.[rule.field as keyof typeof ds.features] as number || 0) > (rule.value as number || 0);
          case "feature_lt":
            return (ds.features?.[rule.field as keyof typeof ds.features] as number || 0) < (rule.value as number || 0);
          case "feature_eq":
            return (ds.features?.[rule.field as keyof typeof ds.features] as number || 0) === (rule.value as number || 0);
          case "feature_between":
            const val = (ds.features?.[rule.field as keyof typeof ds.features] as number || 0);
            return val >= (rule.value as number || 0) && val <= (rule.value2 as number || 0);
          case "has_peaks":
            return (ds.detectedPeaks?.length || 0) > 0;
          case "no_peaks":
            return (ds.detectedPeaks?.length || 0) === 0;
          default:
            return false;
        }
      });

      return folder.matchMode === "all" 
        ? matchResults.every((r) => r)
        : matchResults.some((r) => r);
    });
  },
}));
