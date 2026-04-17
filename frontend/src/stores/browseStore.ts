/**
 * Minimal Zustand store for the Browse UI.
 *
 * Holds only the state that is actually shared across components:
 *   - `stagedItems`        — items the user has checked in the Samples column
 *   - `metadataDisplayKeys` — column fields currently shown in the browser,
 *                             published so other tabs can mirror them
 */

import { create } from 'zustand';

export interface StagedItem {
  id: string;
  name: string;
  source: 'tiled' | 'local';
  tiledId?: string;
  tiledUri?: string;
  tiledApiKey?: string;
  metadata?: {
    sample_name?: string;
    bar?: number;
    sample_folder?: string;
    beamline?: string;
  };
}

interface BrowseStore {
  stagedItems: StagedItem[];
  metadataDisplayKeys: string[];
  setStagedItems: (items: StagedItem[]) => void;
  clearStagedItems: () => void;
  setMetadataDisplayKeys: (keys: string[]) => void;
}

export const useBrowseStore = create<BrowseStore>((set) => ({
  stagedItems: [],
  metadataDisplayKeys: [],
  setStagedItems: (items) => set({ stagedItems: items }),
  clearStagedItems: () => set({ stagedItems: [] }),
  setMetadataDisplayKeys: (keys) => set({ metadataDisplayKeys: keys }),
}));
