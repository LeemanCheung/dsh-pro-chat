import { z } from "zod";
//#region src/schema.ts
const ChatIdSchema = z.string().uuid();
const TurnIdSchema = z.string().uuid();
const OracleSessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);
const IsoTimeSchema = z.string().datetime();
const CdpTargetSchema = z.string().trim().regex(/^(?:127\.0\.0\.1|localhost):(?:[1-9]\d{0,4})$/, "CDP 地址只能是 localhost:端口或 127.0.0.1:端口。").superRefine((value, ctx) => {
	const port = Number(value.slice(value.lastIndexOf(":") + 1));
	if (!Number.isInteger(port) || port > 65535) ctx.addIssue({
		code: "custom",
		message: "CDP 端口必须在 1–65535 之间。"
	});
});
const ChatStatusSchema = z.enum([
	"idle",
	"running",
	"failed",
	"cancelled"
]);
const TurnStateSchema = z.enum([
	"preparing",
	"queued",
	"running",
	"finalizing",
	"succeeded",
	"failed",
	"cancelled",
	"interrupted",
	"external-diverged"
]);
const MessageRoleSchema = z.enum(["user", "assistant"]);
const OracleScopeSchema = z.enum(["legacy-global", "chat-scoped"]);
const QuarantineArtifactSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("transcript"),
		presentAtArchive: z.boolean()
	}).strict(),
	z.object({
		kind: z.literal("oracle-chat"),
		presentAtArchive: z.boolean()
	}).strict(),
	z.object({
		kind: z.literal("oracle-session"),
		sessionId: OracleSessionIdSchema,
		presentAtArchive: z.boolean()
	}).strict()
]);
const ProChatQuarantineSchema = z.object({
	opId: z.string().uuid(),
	phase: z.enum([
		"trash-pending",
		"quarantined",
		"restore-pending"
	]),
	archivedAt: IsoTimeSchema,
	previousStatus: ChatStatusSchema,
	oracleScope: OracleScopeSchema,
	exactOracleSessionIds: z.array(OracleSessionIdSchema),
	artifacts: z.array(QuarantineArtifactSchema).optional(),
	lastError: z.string().trim().min(1).max(500).optional()
}).strict();
const ProChatDivergenceSchema = z.object({
	turnId: TurnIdSchema,
	at: IsoTimeSchema,
	oracleSessionId: OracleSessionIdSchema.optional(),
	reason: z.string().trim().min(1).max(500)
}).strict();
const ProChatSchema = z.object({
	id: ChatIdSchema,
	title: z.string().trim().min(1).max(120),
	createdAt: IsoTimeSchema,
	updatedAt: IsoTimeSchema,
	status: ChatStatusSchema,
	lastSeq: z.number().int().nonnegative(),
	oracleScope: OracleScopeSchema.optional(),
	latestOracleSessionId: OracleSessionIdSchema.optional(),
	currentTurnId: TurnIdSchema.optional(),
	lastError: z.string().trim().min(1).max(1500).optional(),
	divergence: ProChatDivergenceSchema.optional(),
	quarantine: ProChatQuarantineSchema.optional()
}).strict();
const ProChatMessageSchema = z.object({
	id: z.string().uuid(),
	chatId: ChatIdSchema,
	seq: z.number().int().positive(),
	role: MessageRoleSchema,
	content: z.string().min(1).max(2e5),
	createdAt: IsoTimeSchema,
	turnId: TurnIdSchema.optional(),
	oracleSessionId: OracleSessionIdSchema.optional()
}).strict();
const TurnPreparationSchema = z.object({
	promptSeq: z.number().int().positive(),
	previousChat: z.object({
		title: z.string().trim().min(1).max(120),
		status: ChatStatusSchema,
		lastSeq: z.number().int().nonnegative(),
		updatedAt: IsoTimeSchema,
		latestOracleSessionId: OracleSessionIdSchema.optional(),
		currentTurnId: TurnIdSchema.optional(),
		lastError: z.string().trim().min(1).max(1500).optional(),
		divergence: ProChatDivergenceSchema.optional()
	}).strict()
}).strict();
const TurnFinalizationSchema = z.object({ response: ProChatMessageSchema }).strict();
const ProTurnSchema = z.object({
	id: TurnIdSchema,
	chatId: ChatIdSchema,
	promptMessageId: z.string().uuid(),
	state: TurnStateSchema,
	createdAt: IsoTimeSchema,
	startedAt: IsoTimeSchema.optional(),
	finishedAt: IsoTimeSchema.optional(),
	resultMessageId: z.string().uuid().optional(),
	oracleSessionId: OracleSessionIdSchema.optional(),
	error: z.string().trim().min(1).max(1500).optional(),
	preparation: TurnPreparationSchema.optional(),
	finalization: TurnFinalizationSchema.optional()
}).strict().superRefine((value, ctx) => {
	const response = value.finalization?.response;
	if (value.state === "finalizing" && value.finalization === void 0) ctx.addIssue({
		code: "custom",
		path: ["finalization"],
		message: "FINALIZING turn requires a response journal."
	});
	if (value.state === "finalizing" && value.oracleSessionId === void 0) ctx.addIssue({
		code: "custom",
		path: ["oracleSessionId"],
		message: "FINALIZING turn requires an Oracle session."
	});
	if (response === void 0) return;
	if (response.chatId !== value.chatId) ctx.addIssue({
		code: "custom",
		path: [
			"finalization",
			"response",
			"chatId"
		],
		message: "Finalizing response chatId does not match its turn."
	});
	if (response.turnId !== value.id) ctx.addIssue({
		code: "custom",
		path: [
			"finalization",
			"response",
			"turnId"
		],
		message: "Finalizing response turnId does not match its turn."
	});
	if (response.role !== "assistant") ctx.addIssue({
		code: "custom",
		path: [
			"finalization",
			"response",
			"role"
		],
		message: "Finalizing response must be an assistant message."
	});
	if (value.oracleSessionId === void 0 || response.oracleSessionId !== value.oracleSessionId) ctx.addIssue({
		code: "custom",
		path: [
			"finalization",
			"response",
			"oracleSessionId"
		],
		message: "Finalizing response Oracle session does not match its turn."
	});
});
const ProChatSettingsSchema = z.object({
	cdpTarget: CdpTargetSchema,
	revision: z.number().int().nonnegative()
}).strict();
const CreateChatInputSchema = z.object({ title: z.string().trim().min(1).max(120).optional() }).strict();
const SendInputSchema = z.object({
	chatId: ChatIdSchema,
	content: z.string().trim().min(1).max(6e4)
}).strict();
const RenameInputSchema = z.object({
	chatId: ChatIdSchema,
	title: z.string().trim().min(1).max(120)
}).strict();
const ChatIdInputSchema = z.object({ chatId: ChatIdSchema }).strict();
const SaveSettingsInputSchema = z.object({ cdpTarget: CdpTargetSchema }).strict();
const ProChatSummarySchema = ProChatSchema.pick({
	id: true,
	title: true,
	createdAt: true,
	updatedAt: true,
	status: true,
	lastError: true,
	divergence: true,
	quarantine: true
});
const ProChatDetailSchema = z.object({
	chat: ProChatSchema,
	messages: z.array(ProChatMessageSchema),
	turns: z.array(ProTurnSchema)
}).strict();
const TransportStatusSchema = z.object({
	cdpTarget: CdpTargetSchema,
	reachable: z.boolean(),
	oracleInstalled: z.boolean(),
	selectionVerified: z.boolean(),
	browser: z.string().max(240).optional(),
	modelLabel: z.string().max(120).optional(),
	thinkingLabel: z.string().max(120).optional(),
	message: z.string().max(500)
}).strict();
const HandoffSchema = z.object({
	text: z.string().min(1).max(6e5),
	messageCount: z.number().int().nonnegative()
}).strict();
//#endregion
//#region src/remote-contract.ts
const input = (typeSymbol, schema) => [{
	name: "input",
	wire: "input",
	source: "json",
	codec: {
		mode: "strict",
		typeSymbol,
		schema
	}
}];
const direct = (method, resultSymbol, resultSchema, parameters = []) => ({
	id: `dsh-pro-chat#proChat/${method}`,
	service: "proChat",
	namespace: "proChat",
	method,
	invocation: { kind: "direct" },
	parameters,
	result: {
		mode: "strict",
		typeSymbol: resultSymbol,
		schema: resultSchema
	}
});
const TYPERT_REMOTE = {
	package: "dsh-pro-chat",
	descriptors: [
		direct("cancel", "dsh-pro-chat/types#ProChatSummary", ProChatSummarySchema, input("dsh-pro-chat/types#ChatIdInput", ChatIdInputSchema)),
		direct("createChat", "dsh-pro-chat/types#ProChatSummary", ProChatSummarySchema, input("dsh-pro-chat/types#CreateChatInput", CreateChatInputSchema)),
		direct("deleteChat", "dsh-pro-chat#proChat/deleteChat:result", z.boolean(), input("dsh-pro-chat/types#ChatIdInput", ChatIdInputSchema)),
		direct("exportHandoff", "dsh-pro-chat/types#Handoff", HandoffSchema, input("dsh-pro-chat/types#ChatIdInput", ChatIdInputSchema)),
		direct("getChat", "dsh-pro-chat/types#ProChatDetail", ProChatDetailSchema, input("dsh-pro-chat/types#ChatIdInput", ChatIdInputSchema)),
		direct("listArchivedChats", "dsh-pro-chat/types#ProChatSummary[]", z.array(ProChatSummarySchema)),
		direct("listChats", "dsh-pro-chat/types#ProChatSummary[]", z.array(ProChatSummarySchema)),
		direct("renameChat", "dsh-pro-chat/types#ProChatSummary", ProChatSummarySchema, input("dsh-pro-chat/types#RenameInput", RenameInputSchema)),
		direct("restoreChat", "dsh-pro-chat/types#ProChatSummary", ProChatSummarySchema, input("dsh-pro-chat/types#ChatIdInput", ChatIdInputSchema)),
		direct("saveSettings", "dsh-pro-chat/types#ProChatSettings", ProChatSettingsSchema, input("dsh-pro-chat/types#SaveSettingsInput", SaveSettingsInputSchema)),
		direct("send", "dsh-pro-chat/types#ProTurn", ProTurnSchema, input("dsh-pro-chat/types#SendInput", SendInputSchema)),
		direct("settings", "dsh-pro-chat/types#ProChatSettings", ProChatSettingsSchema),
		direct("transportStatus", "dsh-pro-chat/types#TransportStatus", TransportStatusSchema),
		direct("verifyTransport", "dsh-pro-chat/types#TransportStatus", TransportStatusSchema)
	]
};
//#endregion
export { TYPERT_REMOTE, TYPERT_REMOTE as default };

//# sourceMappingURL=typert.remote-client.js.map