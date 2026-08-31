# W5-D4 A R3 Manifest可移植性修复报告

- 基线：`a9674a4f6062f3a4f74f064acf3a9a7449dc5a65`
- E复验阻塞：`A_D4_MANIFEST_MISMATCH`
- 根因：Git blob为LF；E的Windows全局`core.autocrlf=true`将文本检出为CRLF；旧验证器按工作区原始字节比较。
- 修复：Manifest schema 3为每项登记`hashMode=utf8-lf-v1`；生成和验证统一将CRLF/CR规范化为LF。
- 自动反例：把完整正式候选全部转换为CRLF副本后，Manifest复验PASS。
- 补丁清单：14项，与隔离Git index完全一致。
- 完整候选：28项；Manifest 27项，唯一selfExcluded为Manifest自身。
- Manifest SHA-256：`a2bc9a37fcbc686d21c7c29f10255d4d7226bbdfc6ea71d7f55a2abf74252c0a`
- ZIP SHA-256：`5a9b14f5198e287f91475f2a0a44b882005f9ecd356b77c567f86c5653152977`
- 最终全量：`105 files / 846 passed / 1 skipped / 0 failed`
- 状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

本轮不修改A运行主链、Profile、环境锁、seal、Web、执行器、依赖或其他岗位资产。R3报告、ZIP和sidecar均为`AUDIT_ONLY / NOT_FOR_GIT`。
