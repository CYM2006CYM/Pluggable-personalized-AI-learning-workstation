import { useSearchParams } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { FORMAL_DIFFERENCES, FORMAL_SHOWCASES, FORMAL_SHOWCASE_SEAL } from "../showcase/formal-showcase-data.js";
import { STABLE_LAYOUT } from "../styles/layout-contract.js";

export function ShowcasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCaseId = searchParams.get("case");
  const selected = FORMAL_SHOWCASES.find((item) => item.input.caseId === requestedCaseId) ?? FORMAL_SHOWCASES[0]!;
  const pairs = FORMAL_DIFFERENCES.filter((pair) => pair.leftCaseId === selected.input.caseId || pair.rightCaseId === selected.input.caseId);

  return <PageFrame eyebrow="W5-D4 正式输出" title="三类学习路径" summary="A-D4 PathEngine 实际结果 · Profile revision 3" actions={<span className="header-badge">3 个案例</span>}>
    <section className="showcase-toolbar" aria-label="案例选择">
      <label htmlFor="showcase-case">正式案例</label>
      <select id="showcase-case" value={selected.input.caseId} onChange={(event) => setSearchParams({ case: event.target.value }, { replace: true })}>
        {FORMAL_SHOWCASES.map((item) => <option key={item.input.caseId} value={item.input.caseId}>{item.semantic.personaType}</option>)}
      </select>
      <span className="status-tag success">{selected.semantic.path.status}</span>
    </section>

    <div className="showcase-layout" data-page="showcase" data-formal-source="w5-a-d4">
      <section className="work-section showcase-path-section">
        <div className="section-heading"><div><p className="section-kicker">PATH VERSION {selected.semantic.path.pathVersion}</p><h2>{selected.input.caseId}</h2></div><span className="status-tag">{selected.semantic.personaType}</span></div>
        <ol className="path-list">{selected.semantic.path.nodes.map((node, index) => <li className={`path-node ${node.status}`} key={node.nodeId} style={{ minHeight: STABLE_LAYOUT.pathNodeMinHeight }}><span className="path-sequence">{String(index + 1).padStart(2, "0")}</span><div className="path-node-main"><strong>{node.knowledgePointId}</strong><span>{node.reasonCodes.join(" · ")}</span><small>{node.difficulty} · {node.scaffold} · {node.activityIds.join(" / ")}</small></div><div className="path-node-meta"><span>{node.estimatedMinutes}分钟</span><strong>{node.status}</strong></div></li>)}</ol>
      </section>

      <aside className="work-section showcase-facts">
        <p className="section-kicker">FORMAL BINDING</p>
        <h2>输入与输出</h2>
        <dl className="metric-list"><div><dt>Profile revision</dt><dd>{selected.profileBinding.profileRevision}</dd></div><div><dt>下一节点</dt><dd>{selected.semantic.nextStep.nodeId ?? "completed"}</dd></div><div><dt>下一活动</dt><dd>{selected.semantic.nextStep.activityId ?? "none"}</dd></div><div><dt>诊断缺口</dt><dd>{selected.semantic.diagnostic.insufficientKnowledgePointIds.length}</dd></div></dl>
        <dl className="hash-list"><div><dt>seal</dt><dd>{FORMAL_SHOWCASE_SEAL}</dd></div><div><dt>input</dt><dd>{selected.input.sha256}</dd></div><div><dt>path</dt><dd>{selected.pathSha256}</dd></div><div><dt>output</dt><dd>{selected.outputSha256}</dd></div></dl>
      </aside>
    </div>

    <section className="work-section difference-section">
      <div className="section-heading"><div><p className="section-kicker">OBSERVED DIFFERENCES</p><h2>实际差异</h2></div></div>
      <div className="difference-grid">{pairs.map((pair) => <article key={`${pair.leftCaseId}:${pair.rightCaseId}`} className="difference-group"><header><strong>{pair.leftCaseId}<br />{pair.rightCaseId}</strong><span className="score-block">{pair.differenceCount}</span></header><dl>{pair.differences.slice(0, 3).map((difference) => <div key={`${difference.observable}:${difference.key}`}><dt>{difference.observable} · {difference.key}</dt><dd>{formatValue(difference.left)} → {formatValue(difference.right)}</dd></div>)}</dl></article>)}</div>
    </section>
  </PageFrame>;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.join(", ");
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
