# W5-D3 B R1 负责人代完成交付报告

- 正式上游：`6acc56fa03986797be54156af639a905c2e74a64`
- 合同：`W5-C1/W5-R1`
- 裁决：`W5-D64-PYODIDE-1 / PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- ZIP：`B-W5-D3-formal-candidate-6acc56f-r1.zip`
- ZIP SHA-256：`4adffe51092d989f90a7d071bb8ddc85020ea10e8d03ce2800139a8934fa35ce`
- ZIP条目：28项，与`proposed-files.txt`逐项一致
- Manifest：27项逐文件哈希，唯一selfExcluded为Manifest自身
- Manifest SHA-256：`08bb8cb56ab686cb05071d32a3f2e322f7a53a3500403f78ff4f3670ffb499c3`
- 最终全量：`102 files / 841 passed / 1 skipped / 0 failed`
- 当前状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

环境锁和revision 3 seal经C正式证据映射与独立复算后确认无需改变Profile任何字节。三案例只包含输入和预期差异，实际PathEngine输出待A生成，页面差异待E独立复验。

系统`tar`曾因中文路径编码失败；最终ZIP使用.NET标准ZIP API重新创建并核对条目，失败产物已被同路径完整覆盖，不影响最终ZIP哈希。
