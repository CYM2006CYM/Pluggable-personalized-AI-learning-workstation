# W3-D3 E岗位R4输入清单

合同：`W3-C5/W3-R2`

R4仓库快照：`07a5822badf1d8e082f32dbb21705c4a150819e9`

W3起点：`f190326a4a906b46e4001484ffa30a7839b82ed2`

D47：`W3-D47-TEST-LAYERS-1`

## 已解析输入

- A正式提交：`07a5822badf1d8e082f32dbb21705c4a150819e9`；A测试清单及五个正式测试文件逐项绑定SHA-256。
- 负责人E安全候选交接包：`W3-D3-负责人只读gold候选-E-HANDOFF.zip`，外层SHA-256为`d9a35cee18cf4f174f0a54179fe6944ed3ee5cdd6d620fe1970e3672cff8d3e8`。
- V3-7只绑定difficulty、path、公开终裁索引、冻结记录、公开证明和验证记录；不绑定完整仲裁日志、机械差异或B/E原始标注。
- W2三份正式gold继续绑定`W3_START_COMMIT`，用于前20原字节及逐行哈希复算。

## 唯一合法PENDING

- `d-d3-formal-commit`
- `d-d3-fixed-trace-test-manifest`

D上传后，E另建D4解析清单和固定轨迹层配置，填写实际提交、测试文件、命令和SHA-256。不得回写本R4冻结清单，不得猜测D文件名。

## 执行边界

R4只允许Plan、结构、哈希、Schema兼容和反例自测。`Test-W3D4Readiness.ps1 -Mode Execute`必须在D两项输入均为`FROZEN`、固定轨迹命令已解析且显式提供`W3-D4`令牌后才可通过。在线模型固定登记`LIVE_NOT_RUN`。
