# W3-D3 岗位 E 工具自检记录

```text
contractVersion = W3-C4/W3-R2
deliveryStage = W3-D3
fullV3Status = NOT_RUN_D3
gateConclusion = NOT_PRODUCED_D3
```

## 允许执行的D3检查

1. 生成器语法与执行：最终退出码0，生成8个门禁、22项输入。
2. 7个PowerShell脚本解析：全部0错误。
3. `Test-W3D3Baseline.ps1`：退出码0，输出 `BASELINE_STRUCTURE_PASS gates=8 inputs=22 pending=3 fullV3Status=NOT_RUN_D3`。
4. `Test-W3D3InputManifest.ps1`：退出码0，19项冻结输入实际哈希/祖先关系一致，3项PENDING标记合法。
5. `Invoke-W3D3Gate.ps1 -Mode Plan`：V3-1至V3-8均退出0，生成8份计划证据。
6. 无D4令牌调用Execute：按设计退出1。
7. 有D4令牌但输入仍PENDING：按设计退出1。
8. 两次Execute反例产生的命令日志文件数：0。

## 未执行项目

- 门禁配置内全部 `npm.cmd` 命令；
- C边界正式扫描；
- gold候选结构/冻结顺序检查；
- Web D4独立复验；
- 完整仓库门禁和V3验证正文。

这些项目只能在D4正式输入齐备并获得负责人调度后执行。

## 历史修复记录

- 生成器首次解析失败：Windows PowerShell 5.1将无BOM UTF-8中文脚本误解码；统一改为带BOM UTF-8后解析通过。
- Web边界扫描器首次解析失败：文件枚举表达式缺少闭合括号；补齐括号后7个脚本全部解析通过。
- 基线自检首次退出1：PowerShell 5.1不支持 `ConvertFrom-Json -Depth`；删除不兼容参数并将命令调用改为PowerShell 5.1原生参数数组后通过。
- 优化复核发现V3-7最初只比较caseId集合，不能机械发现顺序交换；R2改为逐位顺序比较，首轮冻结包不作为交付。

失败检查和根因均保留在本记录中，没有删除检查或降低预期制造通过。
