import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(appRoot, "..");
const sourceRoot = resolve(repositoryRoot, "新版设计文档-重写版/第六周任务/W6-D73-教学内容候选");
const profileRoot = resolve(appRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const cardsPath = resolve(profileRoot, "cards/learning-cards.json");
const maintenanceViewPath = resolve(profileRoot, "cards/rich-lessons-maintenance.md");
const sourceMapPath = resolve(profileRoot, "sources/source-map.json");

const moduleDefinitions = [
  ["intuition", "先建立直觉", "明确本节为什么学、要学会什么以及与前后步骤的关系。"],
  ["concepts", "把概念拆开", "用通俗语言拆开核心概念、规则和必要术语。"],
  ["walkthrough", "跟着数据走一遍", "沿公开数据、代码和结果逐步完成本节任务。"],
  ["mistakes", "哪里容易错", "观察反例、失败症状、原因和正确修正方法。"],
  ["final-task", "接到最终任务", "把本节结果连接到最终clean_df和验收要求。"],
  ["terms-sources", "术语与依据", "复习术语、规则和可复验的官方来源。"],
];

const lessonConfigs = {
  "01-读取CSV-三版本正文.md": {
    knowledgePointId: "pandas.clean.read-csv",
    anchors: {
      guided: ["把概念拆开", "跟着公开数据走一遍", "哪里容易错", "接到最终任务", "术语与依据"],
      concise: ["核心边界一：让成熟解析器处理CSV语法", "最小、明确、可审计的读取代码", "反例与边界回归", "与最终任务的连接", "术语与来源"],
      practice: ["开工前检查：先确认输入合同", "第一步：建立最小读取脚本", "现场故障一：金额被拆成两列", "实战验收清单", "术语与来源"],
    },
  },
  "02-检查DataFrame结构-三版本正文.md": {
    knowledgePointId: "pandas.clean.inspect-dataframe",
    anchors: {
      guided: ["把概念拆开", "跟着一张小表走一遍", "哪里容易错", "接到最终任务", "术语与依据"],
      concise: ["五个检查入口及其边界", "列门禁：先比较，再决定是否生成副本", "反例与正确写法", "工程交接摘要", "术语与来源"],
      practice: ["建立一份现场检查脚本", "第一步：确认规模与列差异", "现场故障一：列名拼写发生变化", "实战交接清单", "术语与来源"],
    },
  },
  "03-处理缺失值-三版本正文.md": {
    knowledgePointId: "pandas.clean.missing-values",
    anchors: {
      guided: ["把概念拆开", "跟着四条订单走一遍", "哪里容易错", "接到最终任务", "术语与依据"],
      concise: ["统一识别主键空白", "输入不可变与幂等", "反例与修正", "与最终任务的连接", "术语与来源"],
      practice: ["先预测结果，再运行代码", "第一步：复制输入并整理订单号", "现场故障一：纯空格订单号漏网", "形成处理函数", "术语与来源"],
    },
  },
  "04-处理重复订单-三版本正文.md": {
    knowledgePointId: "pandas.clean.duplicate-orders",
    anchors: {
      guided: ["把概念拆开", "跟着三组公开订单走一遍", "哪里容易错", "接到最终任务", "术语与依据"],
      concise: ["复合排序", "三个公开边界组", "反例矩阵", "与最终任务连接", "术语与来源"],
      practice: ["第一步：准备工作副本", "第二步：按业务优先级排名", "现场故障一：O011仍是50", "完整实战函数", "术语与来源"],
    },
  },
  "05-规范类型与格式-三版本正文.md": {
    knowledgePointId: "pandas.clean.type-format",
    anchors: {
      guided: ["把金额拆成两个步骤", "跟着公开值看转换", "哪里容易错", "接到最终任务", "术语与依据"],
      concise: ["金额管线", "验证矩阵", "反例矩阵", "与最终任务连接", "术语与来源"],
      practice: ["第一步：创建结果副本", "第二步：规范金额", "现场故障一：金额仍是文本", "完整实战函数", "术语与来源"],
    },
  },
  "06-验证清洗结果-三版本正文.md": {
    knowledgePointId: "pandas.clean.validate-result",
    anchors: {
      guided: ["为什么要分层验证", "第一层：固定七列和顺序", "哪里容易错", "接到最终提交", "术语与依据"],
      concise: ["快速结构与键门禁", "严格DataFrame比较", "反例矩阵", "与演示证据连接", "术语与来源"],
      practice: ["第一步：验证固定结构", "第二步：验证订单键", "故障演练一：列序交换", "完整检查函数骨架", "术语与来源"],
    },
  },
};

const labels = { guided: "逐步讲解", concise: "重点速览", practice: "案例优先" };

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function inlineText(value) {
  return value
    .replace(/^>\s?/u, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .trim();
}

function contentBlocks(lines, moduleId) {
  const blocks = [];
  let paragraph = [];
  let list;
  let code;
  let codeLanguage;
  let counter = 0;
  const id = () => `${moduleId}-${++counter}`;
  const flushParagraph = () => {
    const text = inlineText(paragraph.join(" "));
    paragraph = [];
    if (!text) return;
    const term = /^【术语注释：([^】]+)】\s*(.*)$/u.exec(text);
    if (term) blocks.push({ blockId: id(), kind: "callout", tone: "term", title: term[1].trim(), text: term[2].trim() });
    else blocks.push({ blockId: id(), kind: "paragraph", text });
  };
  const flushList = () => {
    if (list?.items.length) blocks.push({ blockId: id(), kind: "list", ordered: list.ordered, items: list.items });
    list = undefined;
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/u, "");
    if (code !== undefined) {
      if (line === "```") {
        blocks.push({ blockId: id(), kind: "code", language: codeLanguage, code: code.join("\n").replace(/\n+$/u, "") });
        code = undefined;
        codeLanguage = undefined;
      } else code.push(rawLine);
      continue;
    }
    const fence = /^```(python|csv|text)\s*$/u.exec(line);
    if (fence) {
      flushParagraph(); flushList(); code = []; codeLanguage = fence[1]; continue;
    }
    if (/^```/u.test(line)) throw new Error(`Unsupported code fence: ${line}`);
    const subheading = /^####\s+(.+)$/u.exec(line);
    if (subheading) {
      flushParagraph(); flushList(); blocks.push({ blockId: id(), kind: "subheading", text: inlineText(subheading[1]) }); continue;
    }
    const standaloneBold = /^\*\*([^*]+)\*\*\s*$/u.exec(line);
    if (standaloneBold) {
      flushParagraph(); flushList(); blocks.push({ blockId: id(), kind: "subheading", text: inlineText(standaloneBold[1]) }); continue;
    }
    const ordered = /^\d+\.\s+(.+)$/u.exec(line);
    const unordered = /^-\s+(.+)$/u.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      const isOrdered = ordered !== null;
      if (list !== undefined && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(inlineText((ordered ?? unordered)[1]));
      continue;
    }
    if (line.trim() === "" || line.trim() === "---") {
      flushParagraph(); flushList(); continue;
    }
    flushList(); paragraph.push(line.trim());
  }
  if (code !== undefined) throw new Error("Unclosed code fence");
  flushParagraph(); flushList();
  return blocks;
}

function sections(markdown) {
  const matches = [...markdown.matchAll(/^###\s+(.+)$/gmu)];
  return matches.map((match, index) => ({
    title: match[1].trim(),
    body: markdown.slice(match.index + match[0].length, matches[index + 1]?.index ?? markdown.length).trim(),
  }));
}

function objectives(section) {
  const output = { understand: [], master: [] };
  let target;
  for (const line of section.body.split(/\r?\n/u)) {
    if (/需要了解/u.test(line)) { target = output.understand; continue; }
    if (/需要掌握/u.test(line)) { target = output.master; continue; }
    const item = /^\d+\.\s+(.+)$/u.exec(line.trim());
    if (item && target) target.push(inlineText(item[1]));
  }
  if (output.understand.length === 0 || output.master.length === 0) throw new Error("Learning objectives are incomplete");
  return output;
}

function termsFrom(markdown) {
  const terms = new Map();
  for (const match of markdown.matchAll(/【术语注释：([^】]+)】\s*([^\n]+)/gu)) terms.set(match[1].trim(), inlineText(match[2]));
  for (const match of markdown.matchAll(/^- (?:\*\*|`)([^*`]+)(?:\*\*|`)：([^\n]+)$/gmu)) terms.set(match[1].trim(), inlineText(match[2]));
  return [...terms].map(([term, explanation]) => ({ term, explanation }));
}

function variantDocument(markdown, variantId, anchors, rules) {
  const allSections = sections(markdown);
  const goalIndex = allSections.findIndex((section) => section.title === "学习目标");
  if (goalIndex < 0) throw new Error(`${variantId}: missing 学习目标`);
  const anchorIndexes = anchors.map((anchor) => allSections.findIndex((section) => section.title === anchor));
  if (anchorIndexes.some((index) => index < 0) || anchorIndexes.some((index, position) => position > 0 && index <= anchorIndexes[position - 1])) {
    throw new Error(`${variantId}: invalid module anchors ${JSON.stringify(anchors)}`);
  }
  const ranges = [
    [goalIndex + 1, anchorIndexes[0]],
    [anchorIndexes[0], anchorIndexes[1]],
    [anchorIndexes[1], anchorIndexes[2]],
    [anchorIndexes[2], anchorIndexes[3]],
    [anchorIndexes[3], anchorIndexes[4]],
    [anchorIndexes[4], allSections.length],
  ];
  const modules = ranges.map(([start, end], index) => {
    const [moduleId, title, summary] = moduleDefinitions[index];
    const selected = allSections.slice(start, end);
    if (selected.length === 0) throw new Error(`${variantId}: ${moduleId} is empty`);
    const lines = selected.flatMap((section) => [`#### ${section.title}`, ...section.body.split(/\r?\n/u)]);
    const blocks = contentBlocks(lines, moduleId);
    if (blocks.length === 0) throw new Error(`${variantId}: ${moduleId} has no blocks`);
    return { moduleId, title, summary, blocks };
  });
  const withoutCode = markdown.replace(/```[\s\S]*?```/gu, "");
  const chineseCharacterCount = (withoutCode.match(/[\u3400-\u9fff]/gu) ?? []).length;
  if (chineseCharacterCount < 2000 || chineseCharacterCount > 3000) {
    throw new Error(`${variantId}: Chinese character count ${chineseCharacterCount} is outside 2000..3000`);
  }
  const termNotes = termsFrom(markdown);
  if (termNotes.length === 0) throw new Error(`${variantId}: no term notes`);
  return {
    variantId,
    label: labels[variantId],
    learningObjectives: objectives(allSections[goalIndex]),
    modules,
    termNotes,
    coveredRuleIds: rules.map((rule) => rule.ruleId),
    chineseCharacterCount,
  };
}

function splitDocument(markdown) {
  const variants = [...markdown.matchAll(/^## 版本[^\n]+`(guided|concise|practice)`\s*$/gmu)];
  if (variants.length !== 3) throw new Error("Expected exactly three lesson variants");
  const common = markdown.slice(markdown.indexOf("## 共同事实与来源"), variants[0].index);
  const rules = [...common.matchAll(/^- `([A-Z]+-\d+)`：(.+)$/gmu)].map((match) => ({ ruleId: match[1], statement: inlineText(match[2]) }));
  const sourceAnchorIds = [...new Set([...common.matchAll(/`(src-[a-z0-9-]+)`/gu)].map((match) => match[1]))];
  if (rules.length === 0 || sourceAnchorIds.length === 0) throw new Error("Common rules or sources are missing");
  const sourceClaims = rules.map((rule) => ({ claimId: `claim-${rule.ruleId.toLowerCase()}`, statement: rule.statement, sourceAnchorIds }));
  const canonicalRules = rules.map((rule) => ({ ...rule, sourceClaimIds: [`claim-${rule.ruleId.toLowerCase()}`] }));
  const bodies = Object.fromEntries(variants.map((match, index) => [
    match[1],
    markdown.slice(match.index + match[0].length, variants[index + 1]?.index ?? markdown.length).trim(),
  ]));
  return { canonicalRules, sourceClaims, bodies };
}

const cardsDocument = JSON.parse(await readFile(cardsPath, "utf8"));
const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8"));
const allowedSources = new Set(sourceMap.sources.map((source) => source.sourceId));
const filenames = (await readdir(sourceRoot)).filter((name) => name.endsWith(".md")).sort();
if (JSON.stringify(filenames) !== JSON.stringify(Object.keys(lessonConfigs))) throw new Error("Lesson source file set changed");
const maintenanceRows = [];

for (const filename of filenames) {
  const config = lessonConfigs[filename];
  const markdown = await readFile(resolve(sourceRoot, filename), "utf8");
  const { canonicalRules, sourceClaims, bodies } = splitDocument(markdown);
  for (const claim of sourceClaims) {
    for (const sourceId of claim.sourceAnchorIds) if (!allowedSources.has(sourceId)) throw new Error(`${filename}: unknown source ${sourceId}`);
  }
  const card = cardsDocument.cards.find((item) => item.knowledgePointId === config.knowledgePointId);
  if (!card) throw new Error(`${filename}: fixed card is missing`);
  const variants = Object.fromEntries(["guided", "concise", "practice"].map((variantId) => [
    variantId,
    variantDocument(bodies[variantId], variantId, config.anchors[variantId], canonicalRules),
  ]));
  card.richLesson = {
    sourceDocument: `新版设计文档-重写版/第六周任务/W6-D73-教学内容候选/${filename}`,
    sourceDocumentSha256: sha256(markdown),
    canonicalRules,
    sourceClaims,
    variants,
  };
  maintenanceRows.push({
    knowledgePointId: config.knowledgePointId,
    filename,
    sha256: sha256(markdown),
    counts: ["guided", "concise", "practice"].map((variantId) => variants[variantId].chineseCharacterCount),
    ruleIds: canonicalRules.map((rule) => rule.ruleId),
    sourceAnchorIds: [...new Set(sourceClaims.flatMap((claim) => claim.sourceAnchorIds))],
  });
}

await writeFile(cardsPath, `${JSON.stringify(cardsDocument, null, 2)}\n`, "utf8");
const maintenanceLines = [
  "# RichLesson章节维护视图",
  "",
  "> 本文件由`scripts/w6-rich-lessons/generate-rich-lessons.mjs`确定性生成，请修改源Markdown后重新运行脚本。",
  "",
  "| 知识点 | 源文件 | SHA-256 | guided/concise/practice中文字数 |",
  "|---|---|---|---|",
  ...maintenanceRows.map((row) => `| \`${row.knowledgePointId}\` | \`${row.filename}\` | \`${row.sha256}\` | ${row.counts.join(" / ")} |`),
  "",
  "## 规则与来源",
  "",
  ...maintenanceRows.flatMap((row) => [
    `### ${row.knowledgePointId}`,
    "",
    `- canonical rules：${row.ruleIds.map((id) => `\`${id}\``).join("、")}`,
    `- source anchors：${row.sourceAnchorIds.map((id) => `\`${id}\``).join("、")}`,
    "",
  ]),
];
await writeFile(maintenanceViewPath, `${maintenanceLines.join("\n").trim()}\n`, "utf8");
console.log(JSON.stringify({
  status: "generated",
  lessons: filenames.length,
  variants: filenames.length * 3,
  cardsPath: basename(cardsPath),
  maintenanceViewPath: basename(maintenanceViewPath),
}));
