import type { ComponentLoader, SlotName } from "./slots";

// Stable SDK DTOs. Decoupled from internal db table shapes so core
// can evolve schema without breaking modules.

export interface Community {
  id: string;
  name: string;
  country: "sk" | "cz";
}

export interface Member {
  id: string;
  email: string;
  role: string;
  fullName: string | null;
}

export interface Vote {
  id: string;
  votingId: string;
  memberId: string;
  choice: "za" | "proti" | "zdrzal_sa";
  createdAt: Date;
}

export interface Voting {
  id: string;
  communityId: string;
  title: string;
  status: "draft" | "active" | "closed";
}

export interface User {
  id: string;
  email: string;
  loggedInAt: Date;
}

export interface Post {
  id: string;
  communityId: string;
  authorId: string;
  type: string;
  title: string;
  body: string;
  createdAt: Date;
}

export interface ReadQuery {
  table: string;
  where?: Record<string, unknown>;
  columns?: string[];
  limit?: number;
}

export interface DeviceSpec {
  kind: string;
  vendor?: string;
  config?: Record<string, unknown>;
}

export interface DeviceHandle {
  id: string;
  release(): Promise<void>;
}

export interface ModuleSDK {
  db: {
    read<T = Record<string, unknown>>(query: ReadQuery): Promise<T[]>;
    write(
      table: string,
      row: Record<string, unknown>
    ): Promise<void>;
    runMigrations(): Promise<void>;
  };
  events: {
    emit(name: string, payload: unknown): void;
    on<T>(name: string, handler: (payload: T) => void): void;
  };
  ui: {
    registerSlot(slot: SlotName, component: ComponentLoader): void;
  };
  http: {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
  hardware?: {
    requestDevice(spec: DeviceSpec): Promise<DeviceHandle>;
  };
  community: {
    current(): Promise<Community>;
    member(userId: string): Promise<Member | null>;
  };
  log: {
    info: (m: string, meta?: object) => void;
    warn: (m: string, meta?: object) => void;
    error: (m: string, err?: unknown) => void;
  };
}

export interface ModuleContext {
  sdk: ModuleSDK;
  module: { name: string; version: string };
  community: Community;
}

export interface DomainHooks {
  onVoteCreate: (vote: Vote, ctx: ModuleContext) => Promise<void>;
  onVoteClose: (voting: Voting, ctx: ModuleContext) => Promise<void>;
  onUserLogin: (user: User, ctx: ModuleContext) => Promise<void>;
  onPostCreate: (post: Post, ctx: ModuleContext) => Promise<void>;
}

export interface ModuleDefinition {
  name: string;
  onInstall?: (ctx: ModuleContext) => Promise<void>;
  onUninstall?: (ctx: ModuleContext) => Promise<void>;
  onAppStart?: (ctx: ModuleContext) => Promise<void>;
  hooks?: Partial<DomainHooks>;
  ui?: Partial<Record<SlotName, ComponentLoader>>;
}

export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}
