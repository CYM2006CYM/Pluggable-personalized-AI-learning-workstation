import { useSearchParams } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { experienceLabel } from "../copy/ui-copy.js";
import {
  DIFF_ARROW,
  PAGE_COPY,
  activitiesText,
  chapterCountText,
  differenceCountText,
  differenceFieldLabel,
  differencePairTitle,
  differenceValueLabel,
  estimatedTotalText,
  gapText,
  minutesText,
  nextNodeText,
  nextPracticeText,
  nodeStatusLabel,
  observableLabel,
  pathStatusLabel,
  personaLabel,
  preferenceLabel,
  reasonCodesText,
  scaffoldLabel,
} from "../copy/showcase-page-copy.js";
import { difficultyLabel, knowledgePointLabel } from "../learning-labels.js";
import { FORMAL_DIFFERENCES, FORMAL_SHOWCASES, FORMAL_SHOWCASE_SEAL } from "../showcase/formal-showcase-data.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";
import "./ShowcasePage.css";

/*
 * 案例页 —— 展示层。页面不再直出任何英文数据值：
 * 画像名、路径状态、节点状态、安排原因、辅助方式、难度、兜底文案
 * 全部经由 copy/showcase-page-copy.ts 映射为中文。
 *
 * 刻意保留两个英文原值（均有理由，见 copy 模块头注释）：
 * - 案例编号 caseId：公开的稳定标识，供评审核对 JSON 证据；
 * - 三组校验哈希：与完成归档哈希同性质的复验证据，受既有测试锁定。
 */

/** caseId → 中文画像名。差异卡头部配对名用。 */
const PERSONA_BY_CASE_ID = new Map<string, string>(
  FORMAL_SHOWCASES.map((item) => [item.input.caseId, personaLabel(item.semantic.personaType)]),
);

export function ShowcasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCaseId = searchParams.get("case");
  const selected = FORMAL_SHOWCASES.find((item) => item.input.caseId === requestedCaseId) ?? FORMAL_SHOWCASES[0]!;
  const pairs = FORMAL_DIFFERENCES.filter(
    (pair) => pair.leftCaseId === selected.input.caseId || pair.rightCaseId === selected.input.caseId,
  );

  const nextStep = selected.semantic.nextStep;
  const nextNode = nextStep.completed
    ? undefined
    : selected.semantic.path.nodes.find((node) => node.nodeId === nextStep.nodeId);
  const totalMinutes = selected.semantic.path.nodes.reduce((total, node) => total + node.estimatedMinutes, 0);

  return <PageFrame eyebrow={PAGE_COPY.eyebrow} title={PAGE_COPY.title} summary={PAGE_COPY.summary} actions={<span className="header-badge">{PAGE_COPY.actionBadge}</span>}>
    <section className="case-picker-bar" aria-label={PAGE_COPY.pickerDescription}>
      <label htmlFor="showcase-case">{PAGE_COPY.pickerLabel}</label>
      <select id="showcase-case" value={selected.input.caseId} onChange={(event) => setSearchParams({ case: event.target.value }, { replace: true })}>
        {FORMAL_SHOWCASES.map((item) => <option key={item.input.caseId} value={item.input.caseId}>{personaLabel(item.semantic.personaType)}</option>)}
      </select>
      <span className="status-tag success">{pathStatusLabel(selected.semantic.path.status)}</span>
    </section>

    <div className="showcase-shell" data-page="showcase" data-formal-source="w5-a-d4">
      <section className="showcase-task-card" aria-label={personaLabel(selected.semantic.personaType)}>
        <div className="section-heading">
          <div>
            <p className="section-kicker">{PAGE_COPY.pathKicker}</p>
            <h2 className="showcase-case-title">
              {personaLabel(selected.semantic.personaType)}
            </h2>
          </div>
          <span className="status-tag">{estimatedTotalText(totalMinutes)}</span>
        </div>
        <ol className="showcase-path-list">
          {selected.semantic.path.nodes.map((node, index) => (
            <li className="showcase-path-node" data-status={node.status} key={node.nodeId} style={{ minHeight: STABLE_LAYOUT.pathNodeMinHeight }}>
              <span className="showcase-node-seq">{String(index + 1).padStart(2, "0")}</span>
              <div className="showcase-node-main">
                <strong>{knowledgePointLabel(node.knowledgePointId)}</strong>
                <span>{reasonCodesText(node.reasonCodes)}</span>
                <small>{difficultyLabel(node.difficulty)} · {scaffoldLabel(node.scaffold)} · {activitiesText(node.activityIds.length)}</small>
              </div>
              <div className="showcase-node-meta">
                <span>{minutesText(node.estimatedMinutes)}</span>
                <strong className="showcase-node-status" data-status={node.status}>{nodeStatusLabel(node.status)}</strong>
              </div>
            </li>
          ))}
        </ol>
        <p className="quiet-label">{chapterCountText(selected.semantic.path.nodes.length)}</p>
      </section>

      <aside className="showcase-side" aria-label={PAGE_COPY.facts.summary}>
        <details className="showcase-info-card">
          <summary>{PAGE_COPY.facts.summary}</summary>
          <div className="showcase-info-body">
            <dl className="showcase-metric-list">
              <div><dt>{PAGE_COPY.metrics.nextNode}</dt><dd>{nextNodeText(nextNode === undefined ? undefined : knowledgePointLabel(nextNode.knowledgePointId), nextStep.completed)}</dd></div>
              <div><dt>{PAGE_COPY.metrics.nextPractice}</dt><dd>{nextPracticeText(nextNode?.activityIds.length)}</dd></div>
              <div><dt>{PAGE_COPY.metrics.diagnosticGap}</dt><dd>{gapText(selected.semantic.diagnostic.insufficientKnowledgePointIds.length)}</dd></div>
              <div><dt>{PAGE_COPY.metrics.pythonExperience}</dt><dd>{experienceLabel(selected.semantic.background.python_experience)}</dd></div>
              <div><dt>{PAGE_COPY.metrics.pandasExperience}</dt><dd>{experienceLabel(selected.semantic.background.pandas_experience)}</dd></div>
              <div><dt>{PAGE_COPY.metrics.explanationPreference}</dt><dd>{preferenceLabel(selected.semantic.background.explanation_preference)}</dd></div>
            </dl>
          </div>
        </details>

        <details className="showcase-info-card">
          <summary>{PAGE_COPY.hash.summary}</summary>
          <div className="showcase-info-body">
            <p className="showcase-hash-note">{PAGE_COPY.hash.note}</p>
            <dl className="showcase-hash-list">
              <div><dt>{PAGE_COPY.hash.seal}</dt><dd>{FORMAL_SHOWCASE_SEAL}</dd></div>
              <div><dt>{PAGE_COPY.hash.caseId}</dt><dd>{selected.input.caseId}</dd></div>
              <div><dt>{PAGE_COPY.hash.input}</dt><dd>{selected.input.sha256}</dd></div>
              <div><dt>{PAGE_COPY.hash.path}</dt><dd>{selected.pathSha256}</dd></div>
              <div><dt>{PAGE_COPY.hash.output}</dt><dd>{selected.outputSha256}</dd></div>
            </dl>
          </div>
        </details>
      </aside>
    </div>

    <section className="showcase-diff-zone">
      <details className="showcase-diff-panel">
        <summary>{PAGE_COPY.diff.summary}</summary>
        <div className="showcase-diff-body">
          <div className="showcase-diff-grid">
            {pairs.map((pair) => (
              <article className="showcase-diff-card" key={`${pair.leftCaseId}:${pair.rightCaseId}`}>
                <header className="showcase-diff-head">
                  <strong className="showcase-diff-names">{differencePairTitle(PERSONA_BY_CASE_ID.get(pair.leftCaseId) ?? "", PERSONA_BY_CASE_ID.get(pair.rightCaseId) ?? "")}</strong>
                  <span className="showcase-diff-count">{differenceCountText(pair.differenceCount)}</span>
                </header>
                <dl className="showcase-diff-list">
                  {pair.differences.map((difference) => (
                    <div key={`${difference.observable}:${difference.key}`}>
                      <dt><span className="showcase-diff-observable">{observableLabel(difference.observable)}</span>{differenceFieldLabel(difference.key)}</dt>
                      <dd>{differenceValueLabel(difference.key, difference.left)}{DIFF_ARROW}{differenceValueLabel(difference.key, difference.right)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </div>
      </details>
    </section>
  </PageFrame>;
}