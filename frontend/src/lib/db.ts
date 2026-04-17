import Dexie, { Table } from "dexie";

export interface SessionData {
  id?: number;
  name: string;
  datasets: unknown[];
  activeDatasetId: string | null;
  updatedAt: number;
}

export class GIWAXSDatabase extends Dexie {
  sessions!: Table<SessionData, number>;

  constructor() {
    super("GIWAXSDatabase");
    this.version(1).stores({
      sessions: "++id, name, updatedAt",
    });
  }
}

export const db = new GIWAXSDatabase();
