const METRICS = [
  {
    metricId: "diagnostic_completion_rate",
    numerator: "完成且可解析的诊断案例数",
    denominator: "纳入评测的诊断案例数",
    exclusions: "无冻结输入、JSONL 无法解析或被负责人撤销的案例",
    inputFiles: ["evaluation/personas/development-20.jsonl", "evaluation/personas/final-60.jsonl"],
    outputLocation: "新版设计文档-重写版/周门禁记录/W2-验证记录.md",
  },
  {
    metricId: "knowledge_state_computability_rate",
    numerator: "能稳定生成 KnowledgeState 前置数据的案例数",
    denominator: "纳入评测的冻结案例数",
    exclusions: "缺少冻结 Profile/诊断输入或运行失败的案例",
    inputFiles: ["evaluation/personas/development-20.jsonl", "evaluation/personas/final-60.jsonl"],
    outputLocation: "新版设计文档-重写版/周门禁记录/W2-验证记录.md",
  },
  {
    metricId: "asset_isolation_zero_hit_rate",
    numerator: "六类敏感 canary 均为零命中的受检安全输出数",
    denominator: "实际提供并纳入 V2-7 扫描的安全输出数",
    exclusions: "未提供的输出类别；合同允许存在的私有/隐藏/参考实现源资产",
    inputFiles: ["V2-7 显式输入清单"],
    outputLocation: "新版设计文档-重写版/周门禁记录/W2-验证记录.md",
  },
];

function usage() {
  console.log("Usage: node evaluation-metrics.mjs --describe | --check-empty");
}

if (process.argv[2] === "--describe") {
  console.log(JSON.stringify({ metrics: METRICS, formalMetricValuesGenerated: false }));
} else if (process.argv[2] === "--check-empty") {
  const valid = METRICS.every((metric) => ["metricId", "numerator", "denominator", "exclusions", "inputFiles", "outputLocation"]
    .every((field) => metric[field] !== undefined));
  console.log(JSON.stringify({ status: valid ? "PASS" : "BLOCKED", formalMetricValuesGenerated: false, metricCount: METRICS.length }));
  if (!valid) process.exitCode = 1;
} else {
  usage();
  process.exitCode = 2;
}
