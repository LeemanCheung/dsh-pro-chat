# DSH Pro Chat

这是一个通过用户自行登录的专用 ChatGPT Chrome 使用 Pro 思考档位的 DSH Web 插件。它不是 Codex OAuth/API Pro，也不使用 OpenAI API Key。

## 本轮恢复后的关键约束

- 自动轮询只做被动 loopback 探活，不再每 2.5 秒点击模型菜单。
- “检查连接”才执行主动 Sol + Pro 验证；发送前和返回后还会在浏览器独占锁内重新验证。
- 首轮绑定唯一精确 target，并要求 Oracle `keepBrowser`；续接必须证明父子 Oracle session、Chrome endpoint 和 ChatGPT conversation ID 一致，再在实际 child target 上复验。
- 旧 Oracle session 没有 `keepBrowser: true` 时拒绝续接，不用其他标签页假通过。
- 可能已经提交网页、但本地血缘/后验验证失败的回合标记为 `external-diverged`，不会自动重发。
- `PREPARING` 处理发送前回滚；Oracle 返回后，先通过同目录临时文件 + 原子 rename 写入版本化 `pending-finalizations/<turnId>.json` sidecar，再进入数据域 `FINALIZING`。启动时先重放 sidecar，且仅在回复、对话状态、成功回合及 Oracle 会话血缘一致后清除；跨表冲突会转为 `external-diverged`。
- 重启时仍为 `queued/running` 的回合无法证明提示词未提交，因此转为 `external-diverged`，对话写入持久 divergence 标记并禁止自动续发，避免重复提交。
- “导入 DSH 草稿”需二次确认，明确会替换草稿，但绝不自动发送。
- “删除”改为“移至本机回收区”：写 tombstone 前先固化资产 inventory，记录每个 transcript、按 chat 隔离的 Oracle 目录或旧版精确 session 在归档时是否存在；消息与回合保留以支持恢复。默认不做永久清理，也不会删除 ChatGPT 网页对话。
- 恢复必须与 tombstone inventory 完全一致；清单缺失、原有资产在 live/trash 两处都丢失、原本不存在的资产意外出现，或源与目标同时存在时都会闭锁并要求人工检查。
- 新对话的 Oracle home 按 chat 隔离；旧对话只处理已持久化的精确 session ID，不按目录名前缀猜测残留归属。旧版 session ID 清单不再有 100 条上限，可表达长历史，但未建立血缘的旧目录仍属于明确残余风险。
- Oracle 子进程/页面诊断只保存固定类别，绝不把 DOM 或页面快照写入本地业务记录。其他本地存储/文件系统异常会脱敏并限长，但可能保留本机路径等运维文本，因此不宣称为固定白名单。
- 运行时要求 Node.js 24+。

完整模型边界、Windows 专用 Chrome 启动方式、持久化状态机和验证范围见英文 [README](./README.md)。

仓库是独立 npm 项目。干净检出后使用 Node.js 24 依次执行 `npm ci`、`npm run check`、`npm run tarball:check` 和 `npm audit --audit-level=moderate`。`prepack` 与 `prepublishOnly` 均执行完整门禁；内部 pack allowlist 使用 `--ignore-scripts`，不会递归触发生命周期。GitHub CI 在 Windows/Linux 上重复干净安装与检查，并验证实际 tarball 的空消费者安装和公开导出。

自动化门禁覆盖源码拥有的 Remote 契约、被动轮询、血缘校验、Node 24、固定类别诊断、跨表/sidecar 恢复、重启 divergence 锁、资产 inventory、长旧版 session 清单、生成物一致性、确定性构建、source map 归属和严格 pack allowlist。

`tests/ui-fixture.html` 仅用于人工浏览器检查，不进入 npm 包或自动门禁，也不是当前 DSH Profile、真实 ChatGPT 模型或生产 UAT。最终仍需用户明确授权一次新的首轮 + 同一 Oracle conversation 续接，并验证完整上下文仅写入 DSH 草稿、不自动提交。
