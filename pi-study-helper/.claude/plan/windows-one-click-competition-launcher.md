# Windows 比赛 Demo 一键启动实施计划

## 目标定义

让测评人员在一台未预装 Git、Node.js、Python、Conda 或 pandas 的 Windows 10/11 x64 电脑上，从 GitHub 下载 ZIP 并完整解压后，只需双击入口、确认下载并输入 DeepSeek API Key，即可打开实时 AI Web Demo。

## 功能分解

- 双击入口：CMD 负责调用系统自带 PowerShell，不永久修改执行策略。
- 环境自举：精确探测并准备 Node.js 22.23.1、npm 10.9.8、Python 3.13.7、pandas 3.0.5。
- 依赖安装：按 `package-lock.json` 执行 `npm ci`，SDK 使用固定提交的 HTTPS 源码包，不依赖 Git。
- 密钥边界：交互式隐藏输入，API Key 只进入当前进程内存，退出时清理，不写入文件或报告。
- 自动启动：运行 `demo:live`，等待 5173 端口真实监听后打开浏览器。
- 诊断能力：输出明确阶段、失败原因和脱敏预检报告，支持只检查与离线隔离模式。

## 实施步骤与状态

- [x] 复核现有启动器、合同版本、Key 清理和浏览器等待逻辑。
- [x] 将 Loop Graph SDK 从 Git 协议依赖改为固定提交的 HTTPS tarball。
- [x] 删除 Git/winget 前置安装逻辑，保持无管理员权限部署。
- [x] 重新生成并核验 `package-lock.json` 的 resolved 与 integrity。
- [x] 增加仓库根入口和图形启动窗口，Key 仅通过子进程内存传递。
- [x] 更新启动器自动化测试，覆盖合同探测、无 Git 依赖和密钥传递边界。
- [x] 在当前机器执行 PowerShell 5.1 GUI 冒烟、合同预检、类型检查、构建与测试。
- [x] 在不含 `.runtime`、`node_modules` 且 PATH 不含 Git 的临时副本中完成 `npm ci` 和构建。
- [x] 更新仓库 README、应用 README 与比赛方部署说明。
- [ ] 从 GitHub 已推送版本下载真实 ZIP，并使用有效 Key 完成实时模型端到端验收（需要提交推送后执行）。

## 验收标准

1. 全新 Windows 10/11 x64 普通用户无需安装开发工具或 Git。
2. 首次运行只要求联网、确认下载、输入有效 DeepSeek API Key。
3. Node/npm/Python/pandas 均严格匹配合同版本，来源校验失败时停止。
4. `npm ci` 在 PATH 中不存在 Git 时仍能成功。
5. 终端出现 `PI_STUDY_READY mode=live_model` 后浏览器自动打开。
6. API Key 不出现在项目文件、预检报告、命令行参数或浏览器 bundle 中。
7. 第二次启动复用本地运行时和依赖，不重复下载。
8. 网络、端口、Key 或构建失败时给出可操作错误，不静默卡住。

## 风险与边界

- 首次安装依赖需要访问 Node、Python、PyPI、npm registry 和 GitHub codeload；受限网络需提前放行。
- Python 官方安装器虽然安装到项目目录且无需管理员权限，但仍可能被企业应用控制策略拦截。
- 有效 API Key、DeepSeek 账户余额和服务可用性不由本地启动器保证。
- 当前原生入口只承诺 Windows 10/11 x64，不扩展 macOS、Linux 或 ARM，避免超出比赛交付范围。
