import { InvocationDescriptor, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
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
export { PRO_CHAT_INVOCATIONS, TYPERT, TYPERT_REMOTE, TYPERT_REMOTE as default };
//# sourceMappingURL=typert.host.d.ts.map