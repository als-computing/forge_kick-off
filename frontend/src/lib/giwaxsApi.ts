/** API client for gixsgui_api backend (default port 8003 matches start_all.sh) */

const API_ROOT = (import.meta.env.VITE_GIWAXS_API || "").replace(/\/$/, "");
const DEFAULT_GIWAXS_PORT = "8003";
const defaultOrigin =
  typeof window !== "undefined" && window.location?.hostname
    ? `${window.location.protocol}//${window.location.hostname}:${DEFAULT_GIWAXS_PORT}`
    : "http://localhost:8003";
const BASE = API_ROOT
  ? API_ROOT.includes("/api/v1")
    ? API_ROOT.replace(/\/api\/v1\/?$/, "") + "/api/v1"
    : `${API_ROOT}/api/v1`
  : `${defaultOrigin}/api/v1`;

/** Base URL of the GIWAXS API (without /api/v1) for display in errors and health checks. */
export const GIWAXS_API_BASE = BASE.replace(/\/api\/v1\/?$/, "") || defaultOrigin;

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Failed to fetch" || err instanceof TypeError) {
      throw new Error(
        "Cannot reach GIWAXS API at " + GIWAXS_API_BASE + ". Start it with ./start_all.sh"
      );
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function uploadFormData<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (text ? (JSON.parse(text) as T) : ({} as T));
}

export const giwaxsApi = {
  // Images
  async uploadImage(file: File): Promise<{ image_id: string; filename: string }> {
    const formData = new FormData();
    formData.append("file", file);
    return uploadFormData(`${BASE}/images/upload`, formData);
  },

  /** Load image data from Tiled server into the GIWAXS backend (creates image record, fetches array from Tiled). */
  async loadFromTiled(
    tiledUri: string,
    datasetId: string,
    options?: { project_name?: string; project_id?: string; api_key?: string }
  ): Promise<{ image_id: string; filename: string }> {
    return fetchJson(`${BASE}/images/from-tiled`, {
      method: "POST",
      body: JSON.stringify({
        tiled_uri: tiledUri,
        dataset_id: datasetId,
        ...(options?.project_name && { project_name: options.project_name }),
        ...(options?.project_id && { project_id: options.project_id }),
        ...(options?.api_key && { api_key: options.api_key }),
      }),
    });
  },

  /** Import RSoXS scans from Tiled into the same GIWAXS DB; images appear in the Viewer. */
  async rsoxsImportFromTiled(body: {
    project_name: string;
    tiled_uri: string;
    api_key?: string;
    scan_ids: string[];
  }): Promise<{
    project_id: string;
    project_name: string;
    imported: number;
    image_ids: string[];
    errors: string[];
  }> {
    return fetchJson(`${BASE}/images/rsoxs-import`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Write processed Q-map and parameters back to Tiled (or store reference in DB). */
  async writeQmapToTiled(
    imageId: string,
    qmapData: number[][],
    metadata: Record<string, unknown>
  ): Promise<{ tiled_id: string }> {
    return fetchJson(`${BASE}/images/${imageId}/write-to-tiled`, {
      method: "POST",
      body: JSON.stringify({ qmap_data: qmapData, metadata }),
    });
  },

  async listImages(): Promise<{ images: string[] }> {
    return fetchJson(`${BASE}/images/`);
  },

  /** Load 180.tiff from server project root (for testing). */
  async loadTestImage180(): Promise<{ image_id: string; filename: string }> {
    return fetchJson(`${BASE}/images/test/load-180`, { method: "POST" });
  },

  /** Generate synthetic scattering image with known space group (for testing). */
  async generateSyntheticImage(params?: {
    space_group?: number;
    lattice?: [number, number, number, number, number, number];
    orientation?: [number, number, number];
    energy?: number;
    incident_angle?: number;
    beam_x?: number;
    beam_y?: number;
    sdd?: number;
  }): Promise<{
    image_id: string;
    filename: string;
    space_group: number;
    lattice: number[];
    orientation: number[];
  }> {
    return fetchJson(`${BASE}/images/test/generate-synthetic`, {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    });
  },

  /** Generate synthetic GIWAXS image from CIF file (requires pygidSIM on server). */
  async generateSyntheticFromCif(
    file: File,
    options?: {
      orientation?: string; // "random" or JSON "[h,k,l]"
      energy?: number;
      incident_angle?: number;
      beam_x?: number;
      beam_y?: number;
      sdd?: number;
      peak_sigma_q?: number;
      peak_amplitude?: number;
      q_xy_max?: number;
      q_z_max?: number;
    }
  ): Promise<{ image_id: string; filename: string; source: string; orientation: string }> {
    const formData = new FormData();
    formData.append("cif_file", file);
    
    const params = new URLSearchParams();
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        if (value != null) {
          params.set(key, String(value));
        }
      });
    }
    
    const qs = params.toString();
    const url = `${BASE}/images/test/generate-synthetic-from-cif${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, { method: "POST", body: formData });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return JSON.parse(text) as { image_id: string; filename: string; source: string; orientation: string };
  },

  /** Export image + remapped data as NXsas-style HDF5 (for pygid-style pipelines). */
  async exportNxsas(imageId: string): Promise<{ blob: Blob; filename: string }> {
    const res = await fetch(`${BASE}/processing/export/nxsas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: imageId, include_remapped: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition");
    const filename = disp?.match(/filename="?([^";\n]+)"?/)?.[1] ?? `export_${imageId.slice(0, 8)}.h5`;
    return { blob, filename };
  },

  /** Compute radial I(q) profile (pygid-style). */
  async radialProfile(
    imageId: string,
    nBins: number = 200
  ): Promise<{ q: number[]; intensity: number[]; count: number[] }> {
    return fetchJson(`${BASE}/processing/radial-profile`, {
      method: "POST",
      body: JSON.stringify({ image_id: imageId, n_bins: nBins }),
    });
  },

  /** Compute azimuthal I(φ) profile (pygid-style). */
  async azimuthalProfile(
    imageId: string,
    nBins: number = 360
  ): Promise<{ phi: number[]; intensity: number[]; count: number[] }> {
    return fetchJson(`${BASE}/processing/azimuthal-profile`, {
      method: "POST",
      body: JSON.stringify({ image_id: imageId, n_bins: nBins }),
    });
  },

  /** Compute horizontal I(q_xy) profile (pygid-style, average over q_z). */
  async horizontalProfile(
    imageId: string,
    nBins: number = 200,
    qZMin?: number,
    qZMax?: number
  ): Promise<{ qxy: number[]; intensity: number[]; count: number[] }> {
    const body: Record<string, unknown> = { image_id: imageId, n_bins: nBins };
    if (qZMin != null) body.q_z_min = qZMin;
    if (qZMax != null) body.q_z_max = qZMax;
    return fetchJson(`${BASE}/processing/horizontal-profile`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Export current image calibration as .poni file. */
  async exportPoni(imageId: string): Promise<{ blob: Blob; filename: string }> {
    const res = await fetch(`${BASE}/processing/export/poni`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: imageId }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition");
    const filename = disp?.match(/filename="?([^";\n]+)"?/)?.[1] ?? `calibration_${imageId.slice(0, 8)}.poni`;
    return { blob, filename };
  },

  /** Apply calibration from a .poni file to the given image. */
  async calibrationFromPoni(imageId: string, file: File): Promise<{ ok: boolean; message: string }> {
    const formData = new FormData();
    formData.append("image_id", imageId);
    formData.append("file", file);
    const res = await fetch(`${BASE}/processing/calibration/from-poni`, {
      method: "POST",
      body: formData,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return text ? (JSON.parse(text) as { ok: boolean; message: string }) : { ok: true, message: "OK" };
  },

  /** Export image and optional peaks as HDF5 for ML pipelines. */
  async exportML(imageId: string, peaks?: { qxy: number; qz: number }[]): Promise<{ blob: Blob; filename: string }> {
    const res = await fetch(`${BASE}/processing/export/ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: imageId, peaks: peaks ?? null }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition");
    const filename = disp?.match(/filename="?([^";\n]+)"?/)?.[1] ?? `export_${imageId.slice(0, 8)}_ml.h5`;
    return { blob, filename };
  },

  /** Score space groups using provided peaks (no findpeaks). */
  async scoreSpacegroupsWithPeaks(
    imageId: string,
    peaks: { qxy: number; qz: number }[],
    params: {
      lattice: [number, number, number, number, number, number];
      orientation: [number, number, number];
      energy?: number;
      incident_angle?: number;
      distance_tol?: number;
      max_space_group?: number;
    }
  ): Promise<{
    scores: { space_group: number; match_ratio: number; mean_distance: number; score: number }[];
    peaks: { qxy: number; qz: number }[];
    score_elapsed_s: number;
  }> {
    const body = {
      image_id: imageId,
      peaks: peaks.map((p) => ({ qxy: p.qxy, qz: p.qz })),
      lattice: params.lattice,
      orientation: params.orientation,
      energy: params.energy ?? 10.86,
      incident_angle: params.incident_angle ?? 1.0,
      distance_tol: params.distance_tol ?? 0.02,
      max_space_group: params.max_space_group ?? 230,
    };
    return fetchJson(`${BASE}/analysis/score-spacegroups-with-peaks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Get full image metadata from the database (geometry, beam, SDD, incident angle, etc.). */
  async getImageMetadata(imageId: string): Promise<import("@/types/giwaxs").ImageMetadata> {
    interface BackendImageResponse {
      id: string;
      filename: string;
      geometry?: {
        energy_kev?: number | null;
        sdd_mm?: number | null;
        beam_center_x?: number | null;
        beam_center_y?: number | null;
        pixel_size_x?: number | null;
        pixel_size_y?: number | null;
        incident_angle_deg?: number | null;
        geometry?: string | null;
      } | null;
      detector?: {
        detector_name?: string | null;
      } | null;
      extra_metadata?: Record<string, unknown> | null;
      tiled_qmap_url?: string | null;
    }
    const resp = await fetchJson<BackendImageResponse>(`${BASE}/images/${imageId}`);
    
    const geo = resp.geometry || {};
    const det = resp.detector || {};
    
    return {
      image_id: resp.id,
      im_dim: [0, 0], // Not returned by this endpoint, will be set when loading display data
      camera: det.detector_name || "Unknown",
      energy: geo.energy_kev || 10.0,
      filename: resp.filename,
      beam_position: (geo.beam_center_x != null && geo.beam_center_y != null) 
        ? [geo.beam_center_x, geo.beam_center_y] 
        : null,
      sdd: geo.sdd_mm || null,
      incident_angle: geo.incident_angle_deg || null,
      specular_position: null, // Not stored in backend geometry
      geometry: geo.geometry ? (geo.geometry === "giwaxs" ? 1 : 0) : undefined,
      pixel_size: (geo.pixel_size_x != null && geo.pixel_size_y != null)
        ? [geo.pixel_size_x, geo.pixel_size_y]
        : undefined,
      extra_metadata: resp.extra_metadata || undefined,
      tiled_qmap_url: resp.tiled_qmap_url || undefined,
    };
  },

  async updateImageParams(
    imageId: string,
    params: {
      camera?: string;
      pixel_size?: [number, number];
      beam_position?: [number, number];
      sdd?: number;
      energy?: number;
      geometry?: number;
      incident_angle?: number;
      specular_position?: [number, number];
    }
  ): Promise<{ image_id: string; status: string }> {
    const body = { ...params };
    if (body.beam_position) {
      body.beam_position = body.beam_position.map((v) => v - 1) as [number, number];
    }
    if (body.specular_position) {
      body.specular_position = body.specular_position.map((v) => v - 1) as [number, number];
    }
    return fetchJson(`${BASE}/images/${imageId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  async getDisplayData(
    imageId: string,
    mode: "raw" | "qx" | "qy" | "qz" | "qr" | "chi" | "twotheta" | "alphaf" = "raw",
    npts?: number,
    interpolation?: "nearest" | "linear",
    qRange?: { qxy_min: number; qxy_max: number; qz_min: number; qz_max: number }
  ): Promise<import("@/types/giwaxs").DisplayData> {
    const q = new URLSearchParams({ mode });
    if (typeof npts === "number") q.set("npts", String(npts));
    if (interpolation) q.set("interpolation", interpolation);
    if (qRange) {
      q.set("qxy_min", String(qRange.qxy_min));
      q.set("qxy_max", String(qRange.qxy_max));
      q.set("qz_min", String(qRange.qz_min));
      q.set("qz_max", String(qRange.qz_max));
    }
    return fetchJson(`${BASE}/images/${imageId}/display?${q}`);
  },

  async deleteImage(imageId: string): Promise<{ image_id: string; status: string }> {
    return fetchJson(`${BASE}/images/${imageId}`, { method: "DELETE" });
  },

  // Project (JSON + optional git versioning)
  async projectSave(request: {
    project_name: string;
    image_ids: string[];
    active_image_id: string | null;
    tiled_base_url?: string | null;
    images: Record<string, Record<string, unknown>>;
    commit_message?: string | null;
    comparison?: Record<string, unknown> | null;
  }): Promise<{ saved: boolean; revision?: string }> {
    return fetchJson(`${BASE}/project/save`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async projectList(): Promise<{
    projects: {
      name: string;
      snapshot_count: number;
      created_at: string;
      last_used: string;
      image_count: number;
    }[];
  }> {
    return fetchJson(`${BASE}/project/list`);
  },

  async projectDelete(
    projectName: string,
    imageIds?: string[]
  ): Promise<{ deleted: boolean }> {
    return fetchJson(`${BASE}/project/${encodeURIComponent(projectName)}`, {
      method: "DELETE",
      body: imageIds?.length ? JSON.stringify({ image_ids: imageIds }) : undefined,
    });
  },

  async projectVersions(
    projectName: string,
    limit?: number
  ): Promise<{
    versions: { revision: string; message: string; date: string; image_count: number }[];
  }> {
    const q = limit != null ? `?limit=${limit}` : "";
    return fetchJson(`${BASE}/project/${encodeURIComponent(projectName)}/versions${q}`);
  },

  async projectRestore(
    projectName: string,
    revision: string
  ): Promise<{
    project: { image_ids: string[]; active_image_id: string | null; tiled_base_url?: string | null };
    images: Record<string, Record<string, unknown>>;
  }> {
    return fetchJson(
      `${BASE}/project/${encodeURIComponent(projectName)}/restore?revision=${encodeURIComponent(revision)}`
    );
  },

  // Batch import (backend-run job; survives browser close)
  async batchImportStart(request: {
    project_name: string;
    image_ids: string[];
    workflow_params?: Record<string, unknown> | null;
    /** If set, write each processed Q-map back to this Tiled server. */
    tiled_uri?: string | null;
    /** Map image_id → source Tiled path for write-back into the correct sample container. */
    source_tiled_paths?: Record<string, string> | null;
    /** If true, re-process images that already have a Q-map. */
    force_reprocess?: boolean;
    /** Feature extraction options */
    compute_features?: boolean;
    compute_anisotropy?: boolean;
    compute_peaks?: boolean;
    /** MLExchange VAE encoding */
    run_vae_encoding?: boolean;
    vae_input_type?: "raw" | "raw_log" | "qmap";
    /** Compute UMAP after VAE encoding */
    compute_umap?: boolean;
    umap_n_neighbors?: number;
    umap_min_dist?: number;
    /** New embedding methods for batch pre-computation */
    compute_umap_features?: boolean;
    compute_umap_pixels?: boolean;
    compute_umap_qmap?: boolean;
    compute_umap_radial?: boolean;
    compute_umap_azimuthal?: boolean;
    compute_umap_polar?: boolean;
    compute_umap_sectors?: boolean;
    compute_umap_multiscale?: boolean;
    /** Embedding parameters */
    umap_pixel_size?: number;
    embedding_n_bins?: number;
    embedding_n_sectors?: number;
    embedding_scales?: number[];
    /** Preprocessing options */
    embedding_use_log?: boolean;
    embedding_normalization?: string;
    embedding_clip_percentile?: number | null;
    /** Run each processed image through the Vision LLM and save to Tiled (or DB). Default false. */
    run_vision_batch?: boolean;
    vision_model?: string | null;
    vision_prompt?: string | null;
    vision_display_mode?: "raw" | "qmap";
    vision_merge_mode?: "replace" | "append";
    /** Embed analysis text with Ollama (e.g. nomic-embed-text); default false. */
    vision_include_token_embedding?: boolean;
    vision_embedding_model?: string | null;
    vision_timeout_seconds?: number;
    /** Tiled API key for writing vision metadata (same URI as tiled_uri). */
    tiled_api_key?: string | null;
  }): Promise<{ job_id: string; total: number }> {
    return fetchJson(`${BASE}/batch-import/start`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async batchImportStatus(jobId: string): Promise<{
    job_id: string;
    project_name: string;
    status: string;
    current_index: number;
    total: number;
    processed_count: number;
    stop_requested: boolean;
    error_message?: string | null;
    current_phase?: string | null;
    created_at?: string;
    updated_at?: string;
    /** When status is 'done', list of image_ids that were processed (for populating Samples). */
    image_ids?: string[] | null;
    /** Number of staged images skipped (not raw GIWAXS detector frames). */
    skipped_count?: number | null;
    /** Number of images skipped because they were already processed (have a Q-map). */
    already_processed_count?: number | null;
  }> {
    return fetchJson(`${BASE}/batch-import/status/${encodeURIComponent(jobId)}`);
  },

  async batchImportStop(jobId: string): Promise<{ job_id: string; stop_requested: boolean }> {
    return fetchJson(`${BASE}/batch-import/stop/${encodeURIComponent(jobId)}`, {
      method: "POST",
    });
  },

  /** Stop whichever batch import job is currently running (no job_id needed). */
  async batchImportStopRunning(): Promise<{ job_id: string; stop_requested: boolean }> {
    return fetchJson(`${BASE}/batch-import/stop-running`, {
      method: "POST",
    });
  },

  async batchImportList(limit?: number): Promise<{
    jobs: { id: string; project_name: string; status: string; current_index: number; total: number; created_at?: string }[];
  }> {
    const q = limit != null ? `?limit=${limit}` : "";
    return fetchJson(`${BASE}/batch-import/list${q}`);
  },

  /** List server folders for "Import by Path" picker. path empty = roots; path set = subdirs of that path. */
  async batchImportBrowse(path?: string): Promise<{
    roots: { path: string; name: string }[];
    path: string | null;
    directories: { name: string; path: string }[];
    parent: string | null;
  }> {
    const q = path != null && path !== "" ? `?path=${encodeURIComponent(path)}` : "";
    return fetchJson(`${BASE}/batch-import/browse${q}`);
  },

  /** Start batch import from a local folder path (no upload, stores file references). */
  async batchImportStartFromFolder(request: {
    project_name: string;
    folder_path: string;
    include_subfolders?: boolean;
    workflow_params?: Record<string, unknown>;
  }): Promise<{
    job_id: string;
    total: number;
    imported: number;
    errors?: { file: string; error: string }[] | null;
    folder: string;
  }> {
    return fetchJson(`${BASE}/batch-import/start-from-folder`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  // Processing
  async linecut(
    request: import("@/types/giwaxs").LinecutRequest
  ): Promise<import("@/types/giwaxs").LinecutResult> {
    return fetchJson(`${BASE}/processing/linecut`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async roi(
    imageId: string,
    constraints?: import("@/types/giwaxs").Constraint[],
    dataFlag = 1
  ): Promise<{ intensity: number; pcounts: number; roimap?: number[]; mapname?: string[] }> {
    return fetchJson(`${BASE}/processing/roi`, {
      method: "POST",
      body: JSON.stringify({
        image_id: imageId,
        constraints,
        data_flag: dataFlag,
      }),
    });
  },

  async findPeak(
    request: import("@/types/giwaxs").FindPeakRequest
  ): Promise<import("@/types/giwaxs").PeakResult> {
    return fetchJson(`${BASE}/processing/findpeak`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  // Analysis
  async indexing(
    request: import("@/types/giwaxs").IndexingRequest
  ): Promise<import("@/types/giwaxs").IndexingResult> {
    return fetchJson(`${BASE}/analysis/indexing`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async refinePeak(
    request: {
      image_id: string;
      qxy: number;
      qz: number;
      npts?: number;
      window_size?: number;
      method?: "gaussian" | "com" | "max";
    }
  ): Promise<{ qxy: number; qz: number; refined: boolean; intensity?: number }> {
    return fetchJson(`${BASE}/analysis/refine-peak`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Sum or average stored images by ID; returns new image_id and name. */
  async sumimgByImages(
    imageIds: string[],
    average: boolean
  ): Promise<{ image_id: string; name: string }> {
    return fetchJson(`${BASE}/analysis/sumimg-by-images`, {
      method: "POST",
      body: JSON.stringify({ image_ids: imageIds, average }),
    });
  },

  /** Parse CIF file and return structure summary + XYZ for 3D visualization. */
  async parseCif(
    file: File,
    supercell: { nx?: number; ny?: number; nz?: number } = {}
  ): Promise<{ summary: Record<string, unknown>; xyz: string }> {
    const form = new FormData();
    form.append("cif_file", file);
    const nx = supercell.nx ?? 1;
    const ny = supercell.ny ?? 1;
    const nz = supercell.nz ?? 1;
    const url = `${BASE}/cif/parse?supercell_nx=${nx}&supercell_ny=${ny}&supercell_nz=${nz}`;
    return uploadFormData<{ summary: Record<string, unknown>; xyz: string }>(url, form);
  },

  /** X-ray material properties: formula, energy (keV), mass_density (g/cm³). source=chantler (xraydb) or henke (Henke LBL). Returns dispersion, absorption for n = 1 - delta - i*beta. */
  async refrac(
    formula: string,
    energy: number,
    massDensity: number,
    source: "chantler" | "henke" = "chantler"
  ): Promise<{ dispersion: number; absorption: number; [k: string]: unknown }> {
    const url = `${BASE}/materials/refrac`;
    const body = { formula: formula.trim(), energy, mass_density: massDensity, source };
    if (import.meta.env.DEV) {
      console.log("[refrac] POST", url, body);
    }
    const res = await fetchJson<Record<string, unknown>>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const dispersion = Number(res.dispersion ?? (res as Record<string, unknown>).delta);
    const absorption = Number(res.absorption ?? (res as Record<string, unknown>).beta);
    if (import.meta.env.DEV) {
      console.log("[refrac] response", { dispersion, absorption, raw: res });
    }
    return { ...res, dispersion, absorption } as { dispersion: number; absorption: number; [k: string]: unknown };
  },

  /** Effective field intensity I(z) inside film (GI standing wave). */
  async effectiveField(params: {
    energy_kev: number;
    incident_angle_rad: number;
    film_delta: number;
    film_beta: number;
    z_max_nm?: number;
    n_points?: number;
    substrate_delta?: number | null;
    substrate_beta?: number | null;
    film_thickness_nm?: number | null;
  }): Promise<{ z_nm: number[]; intensity: number[] }> {
    const body: Record<string, unknown> = {
      energy_kev: params.energy_kev,
      incident_angle_rad: params.incident_angle_rad,
      film_delta: params.film_delta,
      film_beta: params.film_beta,
      z_max_nm: params.z_max_nm ?? 500,
      n_points: params.n_points ?? 200,
    };
    if (params.substrate_delta != null) body.substrate_delta = params.substrate_delta;
    if (params.substrate_beta != null) body.substrate_beta = params.substrate_beta;
    if (params.film_thickness_nm != null && params.film_thickness_nm > 0) body.film_thickness_nm = params.film_thickness_nm;
    return fetchJson(`${BASE}/materials/effective-field`, { method: "POST", body: JSON.stringify(body) });
  },

  /** EFI 1D vs angle at fixed depth. Optional substrate + film thickness for two-interface. */
  async effectiveFieldVsAngle(params: {
    energy_kev: number;
    film_delta: number;
    film_beta: number;
    depth_nm?: number;
    angle_min_rad?: number;
    angle_max_rad?: number;
    n_points?: number;
    substrate_delta?: number | null;
    substrate_beta?: number | null;
    film_thickness_nm?: number | null;
  }): Promise<{ angle_rad: number[]; intensity: number[] }> {
    const body: Record<string, unknown> = {
      energy_kev: params.energy_kev,
      film_delta: params.film_delta,
      film_beta: params.film_beta,
      depth_nm: params.depth_nm ?? 0,
      angle_min_rad: params.angle_min_rad ?? 0.01,
      angle_max_rad: params.angle_max_rad ?? 0.5,
      n_points: params.n_points ?? 200,
    };
    if (params.substrate_delta != null) body.substrate_delta = params.substrate_delta;
    if (params.substrate_beta != null) body.substrate_beta = params.substrate_beta;
    if (params.film_thickness_nm != null && params.film_thickness_nm > 0) body.film_thickness_nm = params.film_thickness_nm;
    return fetchJson(`${BASE}/materials/effective-field-vs-angle`, { method: "POST", body: JSON.stringify(body) });
  },

  /** EFI 2D I(angle, depth). Optional substrate + film thickness. */
  async effectiveField2D(params: {
    energy_kev: number;
    film_delta: number;
    film_beta: number;
    angle_min_rad?: number;
    angle_max_rad?: number;
    z_max_nm?: number;
    n_angle?: number;
    n_z?: number;
    substrate_delta?: number | null;
    substrate_beta?: number | null;
    film_thickness_nm?: number | null;
  }): Promise<{ angle_rad: number[]; z_nm: number[]; intensity_2d: number[][] }> {
    const body: Record<string, unknown> = {
      energy_kev: params.energy_kev,
      film_delta: params.film_delta,
      film_beta: params.film_beta,
      angle_min_rad: params.angle_min_rad ?? 0.01,
      angle_max_rad: params.angle_max_rad ?? 0.5,
      z_max_nm: params.z_max_nm ?? 500,
      n_angle: params.n_angle ?? 100,
      n_z: params.n_z ?? 100,
    };
    if (params.substrate_delta != null) body.substrate_delta = params.substrate_delta;
    if (params.substrate_beta != null) body.substrate_beta = params.substrate_beta;
    if (params.film_thickness_nm != null && params.film_thickness_nm > 0) body.film_thickness_nm = params.film_thickness_nm;
    return fetchJson(`${BASE}/materials/effective-field-2d`, { method: "POST", body: JSON.stringify(body) });
  },

  /** BornAgain GISAS simulation. Returns log10(intensity) image and detector angle ranges (deg). Requires backend: pip install bornagain. On 503, throws with clear message. */
  async bornagainGisas(params: {
    incident_angle_deg?: number;
    energy_kev?: number;
    n_detector_x?: number;
    n_detector_y?: number;
    xmin_deg?: number;
    xmax_deg?: number;
    ymin_deg?: number;
    ymax_deg?: number;
    substrate_delta?: number;
    substrate_beta?: number;
    particle_type?: string;
    particle_radius_nm?: number;
    particle_height_nm?: number;
    particle_length_nm?: number;
    particle_width_nm?: number;
  }): Promise<{
    image: number[][];
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
  }> {
    const res = await fetch(`${BASE}/simulations/bornagain/gisas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 503) {
        let msg = "BornAgain is not installed. Linux/Windows: pip install bornagain. macOS: use Homebrew or build from source (see bornagainproject.org).";
        try {
          const body = JSON.parse(text) as { detail?: string };
          if (body.detail) msg = body.detail;
        } catch {
          /* use default msg */
        }
        throw new Error(msg);
      }
      throw new Error(text || `HTTP ${res.status}`);
    }
    return JSON.parse(text) as { image: number[][]; xmin: number; xmax: number; ymin: number; ymax: number };
  },

  /** HiPGISAXS-style DWBA simulation. Returns log10(intensity) image and q limits. */
  async hipgisaxsSimulate(params: {
    incident_angle_deg?: number;
    energy_kev?: number;
    sdd_m?: number;
    pixel_rows?: number;
    pixel_cols?: number;
    pixel_size_m?: [number, number];
    beam_center?: [number, number];
    substrate_delta?: number;
    substrate_beta?: number;
    shape_type?: string;
    shape_radius?: number;
    shape_height?: number;
    shape_angle_deg?: number;
    shape_length?: number;
    shape_width?: number;
    d_spacing_aa?: [number, number, number];
    repeats?: [number, number, number];
  }): Promise<{
    image: number[][];
    qy_min: number;
    qy_max: number;
    qz_min: number;
    qz_max: number;
  }> {
    return fetchJson(`${BASE}/hipgisaxs/simulate`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  },

  /** Set or update image mask from uploaded file (same shape; 0 = exclude, non-zero = include). */
  async setMask(
    imageId: string,
    file: File,
    replace: boolean = true
  ): Promise<{ status: string; image_id: string }> {
    const form = new FormData();
    form.set("image_id", imageId);
    form.set("file", file);
    form.set("replace", String(replace));
    const res = await fetch(`${BASE}/processing/set-mask`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || res.statusText);
    }
    return res.json();
  },

  async findPeaks(
    request: {
      image_id: string;
      preset?: "quick" | "balanced" | "weak_peaks" | "high_res" | "robust" | "custom";
      npts?: number;
      min_distance?: number;
      threshold_rel?: number;
      max_peaks?: number;
      refine_mode?: "none" | "com" | "gaussian";
      refine_window?: number;
      detection_method?: "simple" | "advanced" | "log" | "iterative" | "mlgid" | "polar" | "watershed" | "robust";
      log_scale?: "none" | "log2" | "log10" | "ln";
      hist_clip_bottom?: number;
      hist_clip_top?: number;
      mask_artifacts?: boolean;
      radial_normalize?: boolean;
      refine_subpixel?: boolean;
      preprocessing?: {
        mask_artifacts?: boolean;
        radial_normalize?: boolean;
        log_scale?: string;
        hist_clip_bottom?: number;
        hist_clip_top?: number;
      };
      detection?: {
        method?: string;
        threshold_rel?: number;
        min_distance?: number;
        max_peaks?: number;
      };
      refinement?: {
        enabled?: boolean;
        method?: "none" | "com" | "gaussian";
        window?: number;
      };
    }
  ): Promise<import("@/types/giwaxs").DetectedPeaksResult> {
    return fetchJson(`${BASE}/analysis/findpeaks`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async scoreSpaceGroups(
    request: {
      image_id: string;
      lattice: [number, number, number, number, number, number];
      orientation: [number, number, number];
      orientation_method?: number;
      energy?: number;
      incident_angle?: number;
      film_refractive_index_real?: number;
      film_refractive_index_imag?: number;
      h_range?: [number, number];
      k_range?: [number, number];
      l_range?: [number, number];
      qdeadband?: number;
      qcutoff?: number;
      detect_npts?: number;
      detect_min_distance?: number;
      detect_threshold_rel?: number;
      detect_max_peaks?: number;
      detect_refine_mode?: "none" | "com" | "gaussian";
      detect_refine_window?: number;
      distance_tol?: number;
      max_space_group?: number;
    }
  ): Promise<import("@/types/giwaxs").SpaceGroupScoreResult> {
    return fetchJson(`${BASE}/analysis/score-spacegroups`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Fast ML-accelerated space group scoring. */
  async scoreSpaceGroupsFast(
    request: {
      image_id: string;
      lattice: [number, number, number, number, number, number];
      orientation?: [number, number, number];
      orientation_method?: number;
      energy?: number;
      incident_angle?: number;
      film_refractive_index_real?: number;
      film_refractive_index_imag?: number;
      h_range?: [number, number];
      k_range?: [number, number];
      l_range?: [number, number];
      qdeadband?: number;
      qcutoff?: number;
      detect_npts?: number;
      detect_min_distance?: number;
      detect_threshold_rel?: number;
      detect_max_peaks?: number;
      detect_refine_mode?: "none" | "com" | "gaussian";
      detect_refine_window?: number;
      distance_tol?: number;
      top_k?: number;
    }
  ): Promise<import("@/types/giwaxs").FastScoreResult> {
    return fetchJson(`${BASE}/analysis/score-spacegroups-fast`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Stream space group scores (NDJSON). Call onScore for each score, onDone when finished. */
  async scoreSpaceGroupsStream(
    request: {
      image_id: string;
      lattice: [number, number, number, number, number, number];
      orientation: [number, number, number];
      orientation_method?: number;
      energy?: number;
      incident_angle?: number;
      film_refractive_index_real?: number;
      film_refractive_index_imag?: number;
      h_range?: [number, number];
      k_range?: [number, number];
      l_range?: [number, number];
      qdeadband?: number;
      qcutoff?: number;
      detect_npts?: number;
      detect_min_distance?: number;
      detect_threshold_rel?: number;
      detect_max_peaks?: number;
      detect_refine_mode?: "none" | "com" | "gaussian";
      detect_refine_window?: number;
      distance_tol?: number;
      max_space_group?: number;
    },
    callbacks: {
      onScore: (score: import("@/types/giwaxs").SpaceGroupScore) => void;
      onDone: (result: {
        peaks: import("@/types/giwaxs").DetectedPeak[];
        coverage: { bins: [number, number]; covered: number; total: number; ratio: number };
      }) => void;
    }
  ): Promise<void> {
    const res = await fetch(`${BASE}/analysis/score-spacegroups-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line) as Record<string, unknown>;
          if (data.done === true) {
            callbacks.onDone({
              peaks: (data.peaks as import("@/types/giwaxs").DetectedPeak[]) ?? [],
              coverage: (data.coverage as { bins: [number, number]; covered: number; total: number; ratio: number }) ?? {
                bins: [0, 0],
                covered: 0,
                total: 0,
                ratio: 0,
              },
            });
          } else if (typeof data.space_group === "number") {
            callbacks.onScore(data as import("@/types/giwaxs").SpaceGroupScore);
          }
        } catch {
          // skip malformed lines
        }
      }
    }
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer) as Record<string, unknown>;
        if (data.done === true) {
          callbacks.onDone({
            peaks: (data.peaks as import("@/types/giwaxs").DetectedPeak[]) ?? [],
            coverage: (data.coverage as { bins: [number, number]; covered: number; total: number; ratio: number }) ?? {
              bins: [0, 0],
              covered: 0,
              total: 0,
              ratio: 0,
            },
          });
        } else if (typeof data.space_group === "number") {
          callbacks.onScore(data as import("@/types/giwaxs").SpaceGroupScore);
        }
      } catch {
        // ignore
      }
    }
  },

  /** Score space groups for each of several orientations (h k l). Findpeaks once, then scoring per orientation. */
  async scoreSpaceGroupsByOrientations(request: {
    image_id: string;
    lattice: [number, number, number, number, number, number];
    orientations: [number, number, number][];
    orientation_method?: number;
    energy?: number;
    incident_angle?: number;
    film_refractive_index_real?: number;
    film_refractive_index_imag?: number;
    h_range?: [number, number];
    k_range?: [number, number];
    l_range?: [number, number];
    qdeadband?: number;
    qcutoff?: number;
    detect_npts?: number;
    detect_min_distance?: number;
    detect_threshold_rel?: number;
    detect_max_peaks?: number;
    detect_refine_mode?: "none" | "com" | "gaussian";
    detect_refine_window?: number;
    distance_tol?: number;
    max_space_group?: number;
  }): Promise<import("@/types/giwaxs").ScoreByOrientationsResult> {
    return fetchJson(`${BASE}/analysis/score-spacegroups-by-orientations`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  // Fitting
  async lineFit(
    request: import("@/types/giwaxs").LineFitRequest
  ): Promise<import("@/types/giwaxs").FitResult> {
    return fetchJson(`${BASE}/fitting/linefit`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async listFitModels(): Promise<{
    peak_models: string[];
    backgrounds: string[];
  }> {
    return fetchJson(`${BASE}/fitting/models`);
  },

  // Live
  async liveStart(request: {
    folder: string;
    patterns?: string[];
  }): Promise<{ success: boolean; message: string; patterns: string[] }> {
    return fetchJson(`${BASE}/live/start`, {
      method: "POST",
      body: JSON.stringify({
        folder: request.folder,
        patterns: request.patterns || ["*.tiff", "*.tif", "*.cbf", "*.gb"],
      }),
    });
  },

  async liveStop(): Promise<{ success: boolean; message: string }> {
    return fetchJson(`${BASE}/live/stop`, { method: "POST" });
  },

  async liveStatus(): Promise<{
    is_watching: boolean;
    folder?: string;
    patterns: string[];
    seen_count: number;
  }> {
    return fetchJson(`${BASE}/live/status`);
  },

  async livePoll(): Promise<{ files: string[] }> {
    return fetchJson(`${BASE}/live/poll`);
  },

  async liveProcessFile(request: {
    filepath: string;
    camera?: string;
    sdd?: number;
    energy?: number;
    beam_position?: [number, number];
    incident_angle?: number;
    geometry?: number;
    specular_position?: [number, number];
  }): Promise<{ success: boolean; image_id: string; filename: string }> {
    return fetchJson(`${BASE}/live/process`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Get computed features for an image (for Explore tab sorting/filtering/clustering). */
  async getImageFeatures(imageId: string): Promise<import("@/types/giwaxs").DatasetFeatures> {
    return fetchJson(`${BASE}/images/${imageId}/features`);
  },

  /** URL for precomputed Q-map thumbnail, aspect ratio preserved, max side 128 (Explore grid/preview). 404 if not yet generated. */
  getThumbnailUrl(imageId: string): string {
    return `${BASE}/images/${imageId}/thumbnail`;
  },

  /** Cluster datasets based on computed features. */
  async clusterDatasets(request: import("@/types/giwaxs").ClusterRequest): Promise<import("@/types/giwaxs").ClusterResponse> {
    return fetchJson(`${BASE}/analysis/cluster-datasets`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** 2D UMAP embedding of dataset features for Explore map view. */
  async getUmapEmbedding(request: import("@/types/giwaxs").UmapRequest): Promise<import("@/types/giwaxs").UmapResponse> {
    return fetchJson(`${BASE}/analysis/umap-embedding`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** 2D UMAP embedding from flattened pixel arrays (each image resized then reduced). Requires images in backend with loadable filepath. */
  async getUmapEmbeddingPixels(request: import("@/types/giwaxs").UmapPixelsRequest): Promise<import("@/types/giwaxs").UmapResponse> {
    return fetchJson(`${BASE}/analysis/umap-embedding-pixels`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  // ==========================================================================
  // Comprehensive Embedding API (new unified endpoints)
  // ==========================================================================

  /** Compute embedding using any method (features, pixels, qmap, radial, etc.) and reduction (UMAP, t-SNE, PaCMAP, PCA). */
  async computeEmbedding(request: import("@/types/giwaxs").EmbeddingRequest): Promise<import("@/types/giwaxs").EmbeddingResponse> {
    return fetchJson(`${BASE}/embeddings/compute`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Cluster embedding coordinates using various methods (kmeans, hdbscan, dbscan, spectral, gmm, hierarchical). */
  async clusterEmbedding(request: import("@/types/giwaxs").ClusteringRequest2): Promise<import("@/types/giwaxs").ClusteringResponse2> {
    return fetchJson(`${BASE}/embeddings/cluster`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Detect outliers in embedding space. */
  async detectOutliers(request: import("@/types/giwaxs").OutlierRequest): Promise<import("@/types/giwaxs").OutlierResponse> {
    return fetchJson(`${BASE}/embeddings/outliers`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Find k nearest neighbors for a query point. */
  async findNearestNeighbors(request: import("@/types/giwaxs").NearestNeighborsRequest): Promise<import("@/types/giwaxs").NearestNeighborsResponse> {
    return fetchJson(`${BASE}/embeddings/nearest-neighbors`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Compute 2D density estimation for visualization. */
  async computeDensity(request: import("@/types/giwaxs").DensityRequest): Promise<import("@/types/giwaxs").DensityResponse> {
    return fetchJson(`${BASE}/embeddings/density`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** PCA dimensionality reduction of dataset features for Explore map view. */
  async getPcaEmbedding(request: {
    image_ids: string[];
    features: string[];
    n_components?: number;
  }): Promise<{
    embedding: number[][];
    image_ids: string[];
    explained_variance_ratio: number[];
    n_components: number;
  }> {
    return fetchJson(`${BASE}/analysis/pca-embedding`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  // Machine Learning - Autoencoder
  async trainAutoencoder(request: {
    image_ids: string[];
    n_epochs: number;
    latent_dim: number;
    batch_size?: number;
    learning_rate?: number;
    val_split?: number;
  }): Promise<{ success: boolean; message: string }> {
    return fetchJson(`${BASE}/ml/autoencoder/train`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async encodeImages(request: {
    image_ids: string[];
    save_to_db?: boolean;
    model_type?: "default" | "mlexchange";
    input_type?: "raw" | "raw_log" | "qmap";
  }): Promise<{
    image_ids: string[];
    latent_vectors: number[][];
    success: boolean;
    message: string;
    model_type?: string;
    input_type?: string;
  }> {
    return fetchJson(`${BASE}/ml/autoencoder/encode`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async stopAutoencoderTraining(): Promise<{ success: boolean; message: string }> {
    return fetchJson(`${BASE}/ml/autoencoder/stop-training`, { method: "POST" });
  },

  async getAutoencoderStatus(): Promise<{
    is_trained: boolean;
    model_path: string | null;
    latent_dim: number;
    n_encoded_images: number;
    training_in_progress?: boolean;
    training_progress?: { epoch: number; total_epochs: number; train_loss: number; val_loss: number };
    device?: string;
    mlexchange_available?: boolean;
    mlexchange_loaded?: boolean;
    mlexchange_info?: {
      name: string;
      checkpoint_path: string;
      available: boolean;
      latent_dim: number;
      image_size: number[];
      architecture: string;
    };
  }> {
    return fetchJson(`${BASE}/ml/autoencoder/status`);
  },

  async getAutoencoderUMAP(request: {
    image_ids: string[];
    n_neighbors?: number;
    min_dist?: number;
    model_type?: "default" | "mlexchange";
    input_type?: "raw" | "raw_log" | "qmap";
  }): Promise<{ embedding: number[][]; image_ids: string[]; model_type?: string; input_type?: string }> {
    return fetchJson(`${BASE}/ml/autoencoder/umap`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async getReconstructionErrors(request: {
    image_ids: string[];
  }): Promise<{ image_ids: string[]; reconstruction_errors: number[] }> {
    return fetchJson(`${BASE}/ml/autoencoder/reconstruct`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async loadMLExchangeModel(): Promise<{
    success: boolean;
    message: string;
    info?: {
      name: string;
      checkpoint_path: string;
      available: boolean;
      latent_dim: number;
      image_size: number[];
      architecture: string;
    };
  }> {
    return fetchJson(`${BASE}/ml/autoencoder/load-mlexchange`, {
      method: "POST",
    });
  },

  async getAvailableModels(): Promise<{
    models: Array<{
      id: "default" | "mlexchange";
      name: string;
      available: boolean;
      loaded: boolean;
      latent_dim: number;
      image_size: number[];
      trainable: boolean;
      info?: Record<string, unknown>;
    }>;
  }> {
    return fetchJson(`${BASE}/ml/autoencoder/models`);
  },

  // Machine Learning - LLM Classification
  async classifyImageLLM(request: {
    image_id: string;
    model?: string;
    use_thumbnail?: boolean;
    save_to_db?: boolean;
    /** Custom free-form question sent to the vision LLM instead of the default classification prompt. */
    custom_prompt?: string;
    /** Embed the LLM response text and return the vector. */
    embed_response?: boolean;
    /** Ollama embedding model override (default: nomic-embed-text). */
    embedding_model?: string;
    /** Which image to send: "qmap" | "raw" | "auto" (default "auto"). */
    image_source?: "qmap" | "raw" | "auto";
  }): Promise<{
    image_id: string;
    pattern_type: string;
    confidence: number;
    description: string;
    /** Present when embed_response=true */
    embedding?: number[];
  }> {
    return fetchJson(`${BASE}/ml/llm/classify`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async classifyBatchLLM(request: {
    image_ids: string[];
    model?: string;
    use_thumbnail?: boolean;
    save_to_db?: boolean;
    custom_prompt?: string;
    embed_response?: boolean;
    embedding_model?: string;
    image_source?: "qmap" | "raw" | "auto";
  }): Promise<{
    results: Array<{
      image_id: string;
      pattern_type: string;
      confidence: number;
      description: string;
      embedding?: number[];
    }>;
    success: boolean;
    message: string;
  }> {
    return fetchJson(`${BASE}/ml/llm/classify-batch`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Compute 2D UMAP from stored LLM response embeddings (requires classify with embed_response=true). */
  async getLLMUmap(request: {
    image_ids: string[];
    n_neighbors?: number;
    min_dist?: number;
  }): Promise<{
    image_ids: string[];
    embedding: number[][];
    has_custom_prompt: boolean;
    custom_prompt: string | null;
  }> {
    return fetchJson(`${BASE}/ml/llm/umap`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  async getLLMModels(): Promise<{ models: string[]; ollama_available: boolean }> {
    return fetchJson(`${BASE}/ml/llm/models`);
  },

  /** Ollama version, vision-model hints, and whether the selected model name looks vision-capable. */
  async getLLMHealth(model?: string): Promise<{
    ollama_available: boolean;
    ollama_base_url: string;
    ollama_version: string | null;
    model_count: number;
    models: string[];
    vision_models: string[];
    selected_model: string | null;
    selected_model_vision_capable: boolean | null;
  }> {
    const q = model ? `?model=${encodeURIComponent(model)}` : '';
    return fetchJson(`${BASE}/ml/llm/health${q}`);
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Ring similarity search
  // ──────────────────────────────────────────────────────────────────────────

  /** Search for images that exhibit a ring at a given |q| similar to the reference. */
  async ringSearch(request: {
    reference_image_id: string;
    q_magnitude: number;
    qxy?: number;
    qz?: number;
    selection_mode?: "auto" | "ring" | "arc" | "peak";
    search_radius_px?: number;
    arc_half_width_deg?: number;
    arc_fit_window_deg?: number;
    delta_q?: number;
    candidate_image_ids?: string[];
    n_bins?: number;
    top_n?: number;
    window_factor?: number;
  }): Promise<{
    reference_image_id: string;
    search_mode: "ring" | "arc" | "peak";
    q_magnitude: number;
    delta_q: number;
    reference_ring_intensity: number;
    selected_qxy?: number | null;
    selected_qz?: number | null;
    results: Array<{
      image_id: string;
      score: number;
      ring_intensity: number;
      filename: string | null;
      matched_qxy?: number | null;
      matched_qz?: number | null;
    }>;
  }> {
    return fetchJson(`${BASE}/images/ring-search`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /** Get the radially-integrated I(|q|) profile for a single image's Q-map. */
  async getIqProfile(
    imageId: string,
    nBins?: number,
  ): Promise<{ image_id: string; q_bins: number[]; intensity: number[]; n_bins: number }> {
    const q = new URLSearchParams();
    if (nBins) q.set("n_bins", String(nBins));
    return fetchJson(`${BASE}/images/${imageId}/iq-profile?${q}`);
  },
};
