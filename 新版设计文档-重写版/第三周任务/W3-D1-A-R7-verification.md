# W3-D1 A R7 整改映射与验证

## 输入与范围

- 基线 R6 ZIP：`W3-D1-A-redelivery-r6.zip`，SHA-256 为 `13f325cb457a8b40cd2e62e57619fe412acdcb44d8f06efc9f139cf35de4a0d0`。
- 负责人 R7 ZIP：`W3-D1-A-owner-rectified-r7.zip`，SHA-256 为 `6857dd5c12f4f387a28f91305a9618ca4336adfdb239b93409616e70124e91b2`。
- R7 仅覆盖 `path-learning-facade.ts`、`file-learning-session-repository.ts`、`internal-path-session-port.ts`、`file-learning-session-repository.test.ts`，并新增 `path-session-boundary.test.ts`。
- 未修改 PathEngine、Profile resolver、V3 证据、development-20、B/C/D/E 资产、SDK、依赖、公共 21 号类型或 Profile active 状态。

## 整改映射

| R7 修正 | 覆盖内容 | 验证 |
|---|---|---|
| 内部路径版本隔离 | `getInternalPathSnapshot` 校验 sessionVersion，拒绝陈旧读取 | `path-session-boundary.test.ts` |
| 原子提交返回值 | `commitInternalPath` 返回本次安全快照，Facade 不再二次读取 | `path-session-boundary.test.ts`、PathRuntime 定向测试 |
| 幂等语义闭合 | 同一 requestId 绑定不同内部路径时返回 `idempotency_conflict` | `path-session-boundary.test.ts` |
| 公共/内部 DTO 分层 | 公共安全投影保持 21 号白名单，内部端口保留完整路径 | 仓储边界回归测试 |

## 复跑结果

```text
定向：6 个文件，49 项通过，退出码 0
全量：44 个文件，452 项通过、1 项跳过，退出码 0
npm run typecheck：退出码 0
npx tsc --noEmit：退出码 0
npm run check:docs：退出码 0，45 个 Markdown 文件链接有效
git diff --check：退出码 0（profile-family-repository.ts 保留 CRLF 提示）
```

V3-1 SHA-256 保持 `f29d9fb982d2647b2b440496d02585a06fa5ae8e5b27f384f00493d2a27a820b`；V3-2 SHA-256 保持 `02f9f7754ad5e9197555803d90c668d63f5b8a05cc59b0db902a30f76543754a`；development-20 normalized-text SHA-256 保持 `54c0f5f30bc0b9a104ac2e9e38e6ca3d6f33c5cbe3ade17c62be1c69be1b8473`。
