# W5-D3 三类展示案例输入

本目录只保存B提供的三类合法输入和预期差异假设，不保存手写的实际路径、KnowledgeState、Evidence、mastery、难度或活动结果。

- `computer-background/input.json`：高基础学习者；
- `beginner-background/input.json`：非计算机初学者；
- `task-oriented/input.json`：实践导向学习者；
- `w5-d3-expected-differences.json`：三组两两对照的预期差异矩阵。

三案绑定同一`pandas-cleaning` revision 3、同一seal、同一目标、同一推荐入口和同一400分钟预算。背景问卷值来自公共DTO，诊断作答只引用公开题面中的选项或显式`skip`。

后续责任固定为：A使用正式`DiagnosticRuntime`和`PathEngine`生成实际状态与路径；E独立复验路径合法性、页面展示和每对至少三项差异；负责人最终核对输入、输出与哈希。B的预期矩阵不能冒充实际系统结果。
