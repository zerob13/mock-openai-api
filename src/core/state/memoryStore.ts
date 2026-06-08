export type MemoryCollectionName =
  | "responses"
  | "chatCompletions"
  | "files"
  | "cachedContents"
  | "backgroundJobs";

export type MockStateRecord = {
  id: string;
  provider?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type MockResponseRecord = MockStateRecord;
export type MockChatCompletionRecord = MockStateRecord;
export type MockFileRecord = MockStateRecord;
export type MockCachedContentRecord = MockStateRecord;
export type MockBackgroundJobRecord = MockStateRecord;

export type StoreFilter<T extends MockStateRecord> = Partial<T> | ((record: T) => boolean);

export class MemoryStateStore {
  readonly responses = new Map<string, MockResponseRecord>();
  readonly chatCompletions = new Map<string, MockChatCompletionRecord>();
  readonly files = new Map<string, MockFileRecord>();
  readonly cachedContents = new Map<string, MockCachedContentRecord>();
  readonly backgroundJobs = new Map<string, MockBackgroundJobRecord>();

  create<T extends MockStateRecord>(collection: MemoryCollectionName, record: T): T {
    this.collection<T>(collection).set(record.id, record);
    return record;
  }

  get<T extends MockStateRecord>(collection: MemoryCollectionName, id: string): T | undefined {
    return this.collection<T>(collection).get(id);
  }

  update<T extends MockStateRecord>(
    collection: MemoryCollectionName,
    id: string,
    patch: Partial<T>
  ): T | undefined {
    const existing = this.get<T>(collection, id);
    if (!existing) {
      return undefined;
    }

    const updated = { ...existing, ...patch } as T;
    this.collection<T>(collection).set(id, updated);
    return updated;
  }

  delete(collection: MemoryCollectionName, id: string): boolean {
    return this.collection(collection).delete(id);
  }

  list<T extends MockStateRecord>(collection: MemoryCollectionName, filter?: StoreFilter<T>): T[] {
    const records = Array.from(this.collection<T>(collection).values());

    if (!filter) {
      return records;
    }

    if (typeof filter === "function") {
      return records.filter(filter);
    }

    return records.filter((record) =>
      Object.entries(filter).every(([key, value]) => record[key] === value)
    );
  }

  clear(collection?: MemoryCollectionName): void {
    if (collection) {
      this.collection(collection).clear();
      return;
    }

    this.responses.clear();
    this.chatCompletions.clear();
    this.files.clear();
    this.cachedContents.clear();
    this.backgroundJobs.clear();
  }

  private collection<T extends MockStateRecord>(
    collection: MemoryCollectionName
  ): Map<string, T> {
    return this[collection] as Map<string, T>;
  }
}
