import { Domain } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { InvocationDescriptor, TypertRemoteContribution, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";
import { SubprocessHandle, SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
//#region src/schema.d.ts
declare const ChatIdSchema: z.ZodString;
declare const TurnIdSchema: z.ZodString;
declare const OracleSessionIdSchema: z.ZodString;
declare const IsoTimeSchema: z.ZodString;
declare const CdpTargetSchema: z.ZodString;
declare const ChatStatusSchema: z.ZodEnum<{
  idle: "idle";
  running: "running";
  failed: "failed";
  cancelled: "cancelled";
}>;
declare const TurnStateSchema: z.ZodEnum<{
  running: "running";
  failed: "failed";
  cancelled: "cancelled";
  preparing: "preparing";
  queued: "queued";
  finalizing: "finalizing";
  succeeded: "succeeded";
  interrupted: "interrupted";
  "external-diverged": "external-diverged";
}>;
declare const MessageRoleSchema: z.ZodEnum<{
  user: "user";
  assistant: "assistant";
}>;
declare const OracleScopeSchema: z.ZodEnum<{
  "legacy-global": "legacy-global";
  "chat-scoped": "chat-scoped";
}>;
type OracleScope = z.infer<typeof OracleScopeSchema>;
declare const QuarantineArtifactSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  kind: z.ZodLiteral<"transcript">;
  presentAtArchive: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
  kind: z.ZodLiteral<"oracle-chat">;
  presentAtArchive: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
  kind: z.ZodLiteral<"oracle-session">;
  sessionId: z.ZodString;
  presentAtArchive: z.ZodBoolean;
}, z.core.$strict>], "kind">;
type QuarantineArtifact = z.infer<typeof QuarantineArtifactSchema>;
declare const ProChatQuarantineSchema: z.ZodObject<{
  opId: z.ZodString;
  phase: z.ZodEnum<{
    "trash-pending": "trash-pending";
    quarantined: "quarantined";
    "restore-pending": "restore-pending";
  }>;
  archivedAt: z.ZodString;
  previousStatus: z.ZodEnum<{
    idle: "idle";
    running: "running";
    failed: "failed";
    cancelled: "cancelled";
  }>;
  oracleScope: z.ZodEnum<{
    "legacy-global": "legacy-global";
    "chat-scoped": "chat-scoped";
  }>;
  exactOracleSessionIds: z.ZodArray<z.ZodString>;
  artifacts: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"transcript">;
    presentAtArchive: z.ZodBoolean;
  }, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"oracle-chat">;
    presentAtArchive: z.ZodBoolean;
  }, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"oracle-session">;
    sessionId: z.ZodString;
    presentAtArchive: z.ZodBoolean;
  }, z.core.$strict>], "kind">>>;
  lastError: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
declare const ProChatDivergenceSchema: z.ZodObject<{
  turnId: z.ZodString;
  at: z.ZodString;
  oracleSessionId: z.ZodOptional<z.ZodString>;
  reason: z.ZodString;
}, z.core.$strict>;
type ProChatDivergence = z.infer<typeof ProChatDivergenceSchema>;
declare const ProChatSchema: z.ZodObject<{
  id: z.ZodString;
  title: z.ZodString;
  createdAt: z.ZodString;
  updatedAt: z.ZodString;
  status: z.ZodEnum<{
    idle: "idle";
    running: "running";
    failed: "failed";
    cancelled: "cancelled";
  }>;
  lastSeq: z.ZodNumber;
  oracleScope: z.ZodOptional<z.ZodEnum<{
    "legacy-global": "legacy-global";
    "chat-scoped": "chat-scoped";
  }>>;
  latestOracleSessionId: z.ZodOptional<z.ZodString>;
  currentTurnId: z.ZodOptional<z.ZodString>;
  lastError: z.ZodOptional<z.ZodString>;
  divergence: z.ZodOptional<z.ZodObject<{
    turnId: z.ZodString;
    at: z.ZodString;
    oracleSessionId: z.ZodOptional<z.ZodString>;
    reason: z.ZodString;
  }, z.core.$strict>>;
  quarantine: z.ZodOptional<z.ZodObject<{
    opId: z.ZodString;
    phase: z.ZodEnum<{
      "trash-pending": "trash-pending";
      quarantined: "quarantined";
      "restore-pending": "restore-pending";
    }>;
    archivedAt: z.ZodString;
    previousStatus: z.ZodEnum<{
      idle: "idle";
      running: "running";
      failed: "failed";
      cancelled: "cancelled";
    }>;
    oracleScope: z.ZodEnum<{
      "legacy-global": "legacy-global";
      "chat-scoped": "chat-scoped";
    }>;
    exactOracleSessionIds: z.ZodArray<z.ZodString>;
    artifacts: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
      kind: z.ZodLiteral<"transcript">;
      presentAtArchive: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
      kind: z.ZodLiteral<"oracle-chat">;
      presentAtArchive: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
      kind: z.ZodLiteral<"oracle-session">;
      sessionId: z.ZodString;
      presentAtArchive: z.ZodBoolean;
    }, z.core.$strict>], "kind">>>;
    lastError: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type ProChat = z.infer<typeof ProChatSchema>;
declare const ProChatMessageSchema: z.ZodObject<{
  id: z.ZodString;
  chatId: z.ZodString;
  seq: z.ZodNumber;
  role: z.ZodEnum<{
    user: "user";
    assistant: "assistant";
  }>;
  content: z.ZodString;
  createdAt: z.ZodString;
  turnId: z.ZodOptional<z.ZodString>;
  oracleSessionId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type ProChatMessage = z.infer<typeof ProChatMessageSchema>;
declare const TurnPreparationSchema: z.ZodObject<{
  promptSeq: z.ZodNumber;
  previousChat: z.ZodObject<{
    title: z.ZodString;
    status: z.ZodEnum<{
      idle: "idle";
      running: "running";
      failed: "failed";
      cancelled: "cancelled";
    }>;
    lastSeq: z.ZodNumber;
    updatedAt: z.ZodString;
    latestOracleSessionId: z.ZodOptional<z.ZodString>;
    currentTurnId: z.ZodOptional<z.ZodString>;
    lastError: z.ZodOptional<z.ZodString>;
    divergence: z.ZodOptional<z.ZodObject<{
      turnId: z.ZodString;
      at: z.ZodString;
      oracleSessionId: z.ZodOptional<z.ZodString>;
      reason: z.ZodString;
    }, z.core.$strict>>;
  }, z.core.$strict>;
}, z.core.$strict>;
declare const TurnFinalizationSchema: z.ZodObject<{
  response: z.ZodObject<{
    id: z.ZodString;
    chatId: z.ZodString;
    seq: z.ZodNumber;
    role: z.ZodEnum<{
      user: "user";
      assistant: "assistant";
    }>;
    content: z.ZodString;
    createdAt: z.ZodString;
    turnId: z.ZodOptional<z.ZodString>;
    oracleSessionId: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>;
}, z.core.$strict>;
declare const ProTurnSchema: z.ZodObject<{
  id: z.ZodString;
  chatId: z.ZodString;
  promptMessageId: z.ZodString;
  state: z.ZodEnum<{
    running: "running";
    failed: "failed";
    cancelled: "cancelled";
    preparing: "preparing";
    queued: "queued";
    finalizing: "finalizing";
    succeeded: "succeeded";
    interrupted: "interrupted";
    "external-diverged": "external-diverged";
  }>;
  createdAt: z.ZodString;
  startedAt: z.ZodOptional<z.ZodString>;
  finishedAt: z.ZodOptional<z.ZodString>;
  resultMessageId: z.ZodOptional<z.ZodString>;
  oracleSessionId: z.ZodOptional<z.ZodString>;
  error: z.ZodOptional<z.ZodString>;
  preparation: z.ZodOptional<z.ZodObject<{
    promptSeq: z.ZodNumber;
    previousChat: z.ZodObject<{
      title: z.ZodString;
      status: z.ZodEnum<{
        idle: "idle";
        running: "running";
        failed: "failed";
        cancelled: "cancelled";
      }>;
      lastSeq: z.ZodNumber;
      updatedAt: z.ZodString;
      latestOracleSessionId: z.ZodOptional<z.ZodString>;
      currentTurnId: z.ZodOptional<z.ZodString>;
      lastError: z.ZodOptional<z.ZodString>;
      divergence: z.ZodOptional<z.ZodObject<{
        turnId: z.ZodString;
        at: z.ZodString;
        oracleSessionId: z.ZodOptional<z.ZodString>;
        reason: z.ZodString;
      }, z.core.$strict>>;
    }, z.core.$strict>;
  }, z.core.$strict>>;
  finalization: z.ZodOptional<z.ZodObject<{
    response: z.ZodObject<{
      id: z.ZodString;
      chatId: z.ZodString;
      seq: z.ZodNumber;
      role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
      }>;
      content: z.ZodString;
      createdAt: z.ZodString;
      turnId: z.ZodOptional<z.ZodString>;
      oracleSessionId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type ProTurn = z.infer<typeof ProTurnSchema>;
declare const ProChatSettingsSchema: z.ZodObject<{
  cdpTarget: z.ZodString;
  revision: z.ZodNumber;
}, z.core.$strict>;
type ProChatSettings = z.infer<typeof ProChatSettingsSchema>;
declare const CreateChatInputSchema: z.ZodObject<{
  title: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type CreateChatInput = z.infer<typeof CreateChatInputSchema>;
declare const SendInputSchema: z.ZodObject<{
  chatId: z.ZodString;
  content: z.ZodString;
}, z.core.$strict>;
type SendInput = z.infer<typeof SendInputSchema>;
declare const RenameInputSchema: z.ZodObject<{
  chatId: z.ZodString;
  title: z.ZodString;
}, z.core.$strict>;
type RenameInput = z.infer<typeof RenameInputSchema>;
declare const ChatIdInputSchema: z.ZodObject<{
  chatId: z.ZodString;
}, z.core.$strict>;
type ChatIdInput = z.infer<typeof ChatIdInputSchema>;
declare const SaveSettingsInputSchema: z.ZodObject<{
  cdpTarget: z.ZodString;
}, z.core.$strict>;
type SaveSettingsInput = z.infer<typeof SaveSettingsInputSchema>;
declare const ProChatSummarySchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodString;
  updatedAt: z.ZodString;
  status: z.ZodEnum<{
    idle: "idle";
    running: "running";
    failed: "failed";
    cancelled: "cancelled";
  }>;
  title: z.ZodString;
  lastError: z.ZodOptional<z.ZodString>;
  divergence: z.ZodOptional<z.ZodObject<{
    turnId: z.ZodString;
    at: z.ZodString;
    oracleSessionId: z.ZodOptional<z.ZodString>;
    reason: z.ZodString;
  }, z.core.$strict>>;
  quarantine: z.ZodOptional<z.ZodObject<{
    opId: z.ZodString;
    phase: z.ZodEnum<{
      "trash-pending": "trash-pending";
      quarantined: "quarantined";
      "restore-pending": "restore-pending";
    }>;
    archivedAt: z.ZodString;
    previousStatus: z.ZodEnum<{
      idle: "idle";
      running: "running";
      failed: "failed";
      cancelled: "cancelled";
    }>;
    oracleScope: z.ZodEnum<{
      "legacy-global": "legacy-global";
      "chat-scoped": "chat-scoped";
    }>;
    exactOracleSessionIds: z.ZodArray<z.ZodString>;
    artifacts: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
      kind: z.ZodLiteral<"transcript">;
      presentAtArchive: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
      kind: z.ZodLiteral<"oracle-chat">;
      presentAtArchive: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
      kind: z.ZodLiteral<"oracle-session">;
      sessionId: z.ZodString;
      presentAtArchive: z.ZodBoolean;
    }, z.core.$strict>], "kind">>>;
    lastError: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type ProChatSummary = z.infer<typeof ProChatSummarySchema>;
declare const ProChatDetailSchema: z.ZodObject<{
  chat: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    status: z.ZodEnum<{
      idle: "idle";
      running: "running";
      failed: "failed";
      cancelled: "cancelled";
    }>;
    lastSeq: z.ZodNumber;
    oracleScope: z.ZodOptional<z.ZodEnum<{
      "legacy-global": "legacy-global";
      "chat-scoped": "chat-scoped";
    }>>;
    latestOracleSessionId: z.ZodOptional<z.ZodString>;
    currentTurnId: z.ZodOptional<z.ZodString>;
    lastError: z.ZodOptional<z.ZodString>;
    divergence: z.ZodOptional<z.ZodObject<{
      turnId: z.ZodString;
      at: z.ZodString;
      oracleSessionId: z.ZodOptional<z.ZodString>;
      reason: z.ZodString;
    }, z.core.$strict>>;
    quarantine: z.ZodOptional<z.ZodObject<{
      opId: z.ZodString;
      phase: z.ZodEnum<{
        "trash-pending": "trash-pending";
        quarantined: "quarantined";
        "restore-pending": "restore-pending";
      }>;
      archivedAt: z.ZodString;
      previousStatus: z.ZodEnum<{
        idle: "idle";
        running: "running";
        failed: "failed";
        cancelled: "cancelled";
      }>;
      oracleScope: z.ZodEnum<{
        "legacy-global": "legacy-global";
        "chat-scoped": "chat-scoped";
      }>;
      exactOracleSessionIds: z.ZodArray<z.ZodString>;
      artifacts: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"transcript">;
        presentAtArchive: z.ZodBoolean;
      }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"oracle-chat">;
        presentAtArchive: z.ZodBoolean;
      }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"oracle-session">;
        sessionId: z.ZodString;
        presentAtArchive: z.ZodBoolean;
      }, z.core.$strict>], "kind">>>;
      lastError: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
  }, z.core.$strict>;
  messages: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    chatId: z.ZodString;
    seq: z.ZodNumber;
    role: z.ZodEnum<{
      user: "user";
      assistant: "assistant";
    }>;
    content: z.ZodString;
    createdAt: z.ZodString;
    turnId: z.ZodOptional<z.ZodString>;
    oracleSessionId: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
  turns: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    chatId: z.ZodString;
    promptMessageId: z.ZodString;
    state: z.ZodEnum<{
      running: "running";
      failed: "failed";
      cancelled: "cancelled";
      preparing: "preparing";
      queued: "queued";
      finalizing: "finalizing";
      succeeded: "succeeded";
      interrupted: "interrupted";
      "external-diverged": "external-diverged";
    }>;
    createdAt: z.ZodString;
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
    resultMessageId: z.ZodOptional<z.ZodString>;
    oracleSessionId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    preparation: z.ZodOptional<z.ZodObject<{
      promptSeq: z.ZodNumber;
      previousChat: z.ZodObject<{
        title: z.ZodString;
        status: z.ZodEnum<{
          idle: "idle";
          running: "running";
          failed: "failed";
          cancelled: "cancelled";
        }>;
        lastSeq: z.ZodNumber;
        updatedAt: z.ZodString;
        latestOracleSessionId: z.ZodOptional<z.ZodString>;
        currentTurnId: z.ZodOptional<z.ZodString>;
        lastError: z.ZodOptional<z.ZodString>;
        divergence: z.ZodOptional<z.ZodObject<{
          turnId: z.ZodString;
          at: z.ZodString;
          oracleSessionId: z.ZodOptional<z.ZodString>;
          reason: z.ZodString;
        }, z.core.$strict>>;
      }, z.core.$strict>;
    }, z.core.$strict>>;
    finalization: z.ZodOptional<z.ZodObject<{
      response: z.ZodObject<{
        id: z.ZodString;
        chatId: z.ZodString;
        seq: z.ZodNumber;
        role: z.ZodEnum<{
          user: "user";
          assistant: "assistant";
        }>;
        content: z.ZodString;
        createdAt: z.ZodString;
        turnId: z.ZodOptional<z.ZodString>;
        oracleSessionId: z.ZodOptional<z.ZodString>;
      }, z.core.$strict>;
    }, z.core.$strict>>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type ProChatDetail = z.infer<typeof ProChatDetailSchema>;
declare const TransportStatusSchema: z.ZodObject<{
  cdpTarget: z.ZodString;
  reachable: z.ZodBoolean;
  oracleInstalled: z.ZodBoolean;
  selectionVerified: z.ZodBoolean;
  browser: z.ZodOptional<z.ZodString>;
  modelLabel: z.ZodOptional<z.ZodString>;
  thinkingLabel: z.ZodOptional<z.ZodString>;
  message: z.ZodString;
}, z.core.$strict>;
type TransportStatus = z.infer<typeof TransportStatusSchema>;
declare const HandoffSchema: z.ZodObject<{
  text: z.ZodString;
  messageCount: z.ZodNumber;
}, z.core.$strict>;
type Handoff = z.infer<typeof HandoffSchema>;
declare const now: () => string;
//#endregion
//#region src/domain.d.ts
declare const proChatDomainSpec: {
  name: string;
  version: number;
  global: {
    schema: import("zod").ZodObject<{
      cdpTarget: import("zod").ZodString;
      revision: import("zod").ZodNumber;
    }, import("zod/v4/core").$strict>;
    initial: {
      cdpTarget: string;
      revision: number;
    };
  };
  tables: {
    chats: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      status: "idle" | "running" | "failed" | "cancelled";
      lastSeq: number;
      oracleScope?: "legacy-global" | "chat-scoped" | undefined;
      latestOracleSessionId?: string | undefined;
      currentTurnId?: string | undefined;
      lastError?: string | undefined;
      divergence?: {
        turnId: string;
        at: string;
        reason: string;
        oracleSessionId?: string | undefined;
      } | undefined;
      quarantine?: {
        opId: string;
        phase: "trash-pending" | "quarantined" | "restore-pending";
        archivedAt: string;
        previousStatus: "idle" | "running" | "failed" | "cancelled";
        oracleScope: "legacy-global" | "chat-scoped";
        exactOracleSessionIds: string[];
        artifacts?: ({
          kind: "transcript";
          presentAtArchive: boolean;
        } | {
          kind: "oracle-chat";
          presentAtArchive: boolean;
        } | {
          kind: "oracle-session";
          sessionId: string;
          presentAtArchive: boolean;
        })[] | undefined;
        lastError?: string | undefined;
      } | undefined;
    }>;
    messages: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
      id: string;
      chatId: string;
      seq: number;
      role: "user" | "assistant";
      content: string;
      createdAt: string;
      turnId?: string | undefined;
      oracleSessionId?: string | undefined;
    }>;
    turns: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
      id: string;
      chatId: string;
      promptMessageId: string;
      state: "running" | "failed" | "cancelled" | "preparing" | "queued" | "finalizing" | "succeeded" | "interrupted" | "external-diverged";
      createdAt: string;
      startedAt?: string | undefined;
      finishedAt?: string | undefined;
      resultMessageId?: string | undefined;
      oracleSessionId?: string | undefined;
      error?: string | undefined;
      preparation?: {
        promptSeq: number;
        previousChat: {
          title: string;
          status: "idle" | "running" | "failed" | "cancelled";
          lastSeq: number;
          updatedAt: string;
          latestOracleSessionId?: string | undefined;
          currentTurnId?: string | undefined;
          lastError?: string | undefined;
          divergence?: {
            turnId: string;
            at: string;
            reason: string;
            oracleSessionId?: string | undefined;
          } | undefined;
        };
      } | undefined;
      finalization?: {
        response: {
          id: string;
          chatId: string;
          seq: number;
          role: "user" | "assistant";
          content: string;
          createdAt: string;
          turnId?: string | undefined;
          oracleSessionId?: string | undefined;
        };
      } | undefined;
    }>;
  };
};
//#endregion
//#region src/transport.d.ts
type BrowserTarget = {
  id: string;
  type: string;
  url: string;
};
type BrowserClient = {
  Runtime: {
    evaluate(input: {
      expression: string;
      returnByValue: boolean;
    }): Promise<{
      result: {
        value?: unknown;
      };
    }>;
  };
  close(): Promise<void>;
};
type BrowserControl = {
  list(input: {
    host: string;
    port: number;
  }): Promise<BrowserTarget[]>;
  version(input: {
    host: string;
    port: number;
  }): Promise<{
    Browser: string;
  }>;
  connect(input: {
    host: string;
    port: number;
    target: BrowserTarget;
  }): Promise<BrowserClient>;
};
type OracleTransportDependencies = {
  browser?: BrowserControl;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  readText?: (path: string) => Promise<string>;
  resolveCli?: () => Promise<{
    cliPath: string;
  }>;
};
declare class OracleBrowserError extends Error {
  constructor(message: string);
}
declare class OracleBrowserCancelledError extends OracleBrowserError {
  constructor();
}
declare class OracleSubmittedUnverifiedError extends OracleBrowserError {
  readonly oracleSessionId?: string | undefined;
  constructor(message: string, oracleSessionId?: string | undefined);
}
interface OracleRunRequest {
  readonly chatId: string;
  readonly turnId: string;
  readonly prompt: string;
  readonly previousOracleSessionId?: string;
  readonly settings: ProChatSettings;
  readonly dataRoot: string;
  readonly oracleScope: OracleScope;
  readonly signal: AbortSignal;
  readonly onHandle?: (handle: SubprocessHandle) => void;
  readonly onSessionObserved?: (oracleSessionId: string) => void | Promise<void>;
}
interface OracleRunResult {
  readonly oracleSessionId: string;
  readonly markdown: string;
  readonly outputPath: string;
}
declare class OracleBrowserTransport {
  private readonly subprocess;
  private readonly browser;
  private readonly wait;
  private readonly nowMs;
  private readonly readText;
  private readonly resolveCliOverride;
  private readonly lease;
  private cachedProof?;
  constructor(subprocess: SubprocessRuntime, dependencies?: OracleTransportDependencies);
  get busy(): boolean;
  status(settings: ProChatSettings): Promise<TransportStatus>;
  verifyStatus(settings: ProChatSettings): Promise<TransportStatus>;
  run(request: OracleRunRequest): Promise<OracleRunResult>;
  private runExclusive;
  private verifySelection;
  private resolveCli;
  private rememberProof;
  private readSessionProof;
  private validSessionId;
  private readSubmissionProjection;
  private observeSessionWhileRunning;
}
//#endregion
//#region src/service.d.ts
declare class ProChatService extends TypertRemoteService {
  private readonly domain;
  private readonly transport;
  private readonly root;
  private readonly active;
  private readonly mutations;
  private stopping;
  constructor(ctx: Context, domain: Domain<typeof proChatDomainSpec>, transport: OracleBrowserTransport);
  hydrate(): Promise<void>;
  listChats(): Promise<ProChatSummary[]>;
  listArchivedChats(): Promise<ProChatSummary[]>;
  getChat(input: ChatIdInput): Promise<ProChatDetail>;
  createChat(input: CreateChatInput): Promise<ProChatSummary>;
  renameChat(input: RenameInput): Promise<ProChatSummary>;
  deleteChat(input: ChatIdInput): Promise<boolean>;
  restoreChat(input: ChatIdInput): Promise<ProChatSummary>;
  send(input: SendInput): Promise<ProTurn>;
  cancel(input: ChatIdInput): Promise<ProChatSummary>;
  settings(): Promise<ProChatSettings>;
  saveSettings(input: SaveSettingsInput): Promise<ProChatSettings>;
  transportStatus(): Promise<TransportStatus>;
  verifyTransport(): Promise<TransportStatus>;
  exportHandoff(input: ChatIdInput): Promise<Handoff>;
  shutdown(): Promise<void>;
  private resumeQuarantine;
  private rollbackPreparation;
  private finalizeTurn;
  private replayPendingFinalization;
  private runTurnSafely;
  private runTurn;
  private reconcileChat;
  private requireChat;
  private assertActiveChat;
  private assertContinuationSafe;
  private markExternalDivergence;
  private withChatMutation;
  private messagesFor;
  private turnsFor;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    proChat: ProChatService;
  }
}
//#endregion
//#region src/remote-contract.d.ts
declare const PRO_CHAT_INVOCATIONS: readonly InvocationDescriptor[];
declare const TYPERT: {
  readonly package: "dsh-pro-chat";
  readonly face: "host";
  readonly schemas: readonly [];
  readonly invocations: readonly InvocationDescriptor[];
  readonly model: {
    readonly services: readonly [];
    readonly events: readonly [];
    readonly objects: readonly [];
  };
};
declare const TYPERT_REMOTE: TypertRemoteContribution;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-pro-chat";
declare const inject: string[];
declare function apply(ctx: Context): Promise<void>;
//#endregion
export { BrowserControl, CdpTargetSchema, ChatIdInput, ChatIdInputSchema, ChatIdSchema, ChatStatusSchema, CreateChatInput, CreateChatInputSchema, Handoff, HandoffSchema, IsoTimeSchema, MessageRoleSchema, OracleBrowserCancelledError, OracleBrowserError, OracleBrowserTransport, OracleRunRequest, OracleRunResult, OracleScope, OracleScopeSchema, OracleSessionIdSchema, OracleSubmittedUnverifiedError, OracleTransportDependencies, PRO_CHAT_INVOCATIONS, ProChat, ProChatDetail, ProChatDetailSchema, ProChatDivergence, ProChatDivergenceSchema, ProChatMessage, ProChatMessageSchema, ProChatQuarantineSchema, ProChatSchema, ProChatService, ProChatSettings, ProChatSettingsSchema, ProChatSummary, ProChatSummarySchema, ProTurn, ProTurnSchema, QuarantineArtifact, QuarantineArtifactSchema, RenameInput, RenameInputSchema, SaveSettingsInput, SaveSettingsInputSchema, SendInput, SendInputSchema, TYPERT, TYPERT_REMOTE, TransportStatus, TransportStatusSchema, TurnFinalizationSchema, TurnIdSchema, TurnPreparationSchema, TurnStateSchema, apply, inject, name, now, proChatDomainSpec };
//# sourceMappingURL=index.d.ts.map