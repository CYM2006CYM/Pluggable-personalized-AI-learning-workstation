import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const correct = ["df.shape", "DataFrame", true, "删除该行", "日期可解析的记录", "转换为缺失时间值", true, "被选记录的相对行序"];
const alternatives = ["df.rows", "字典", false, "将 order_id 填为 0", "原始最后一条", "宽松猜测日期", false, "按 order_id 排序"];
const questionIds = Array.from({ length: 8 }, (_, index) => `diag-${String(index + 1).padStart(2, "0")}`);

function diagnosticAnswers(variant) {
  return questionIds.map((questionId, index) => {
    if ((variant === 2 && index % 3 === 0) || (variant === 3 && index % 2 === 1)) return { questionId, action: "skip" };
    const answer = variant === 1 || (variant === 4 && index % 2 === 0) ? correct[index] : alternatives[index];
    return { questionId, action: "answer", answer };
  });
}

function background(personaType, index) {
  const profile = {
    cs_student: ["有 Python 课程基础", "刚接触 pandas", "希望看到数据结构解释"],
    self_learner: ["自学过基础 Python", "有零散表格处理经验", "希望分步骤说明"],
    practice_oriented: ["以工作任务为主", "经常处理订单表", "希望先看验收条件"],
  }[personaType];
  return [
    { fieldId: "python_experience", value: profile[0] },
    { fieldId: "pandas_experience", value: profile[1] },
    { fieldId: "explanation_preference", value: profile[2] },
    { fieldId: "case_variant", value: index % 5 },
  ];
}

function makeCase(prefix, index, personaType) {
  return {
    caseId: `${prefix}-${String(index).padStart(3, "0")}`,
    personaType,
    background: background(personaType, index),
    goalId: "goal-clean-orders",
    diagnosticAnswers: diagnosticAnswers(index % 5),
    availableMinutes: [30, 60, 90, 120, 150][index % 5],
    notes: "revision-2 pandas-cleaning diagnostic input",
  };
}

const personaTypes = ["cs_student", "self_learner", "practice_oriented"];
const development = Array.from({ length: 20 }, (_, index) => makeCase("dev", index + 1, personaTypes[index % 3]));
const final = personaTypes.flatMap((personaType, group) =>
  Array.from({ length: 20 }, (_, offset) => makeCase("final", group * 20 + offset + 1, personaType)),
);

await writeFile(resolve(root, "development-20.jsonl"), `${development.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
await writeFile(resolve(root, "final-60.jsonl"), `${final.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
