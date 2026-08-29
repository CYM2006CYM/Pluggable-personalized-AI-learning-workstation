import type { StudyFlowView, StudyStepId } from "../flow/study-flow.js";
import {
  STEPPER_LABELS,
  lessonStatusLabel,
  pendingPracticalLabel,
  progressLabel,
  stepLabel,
  stepStatusLabel,
} from "../copy/ui-copy.js";
import "./StudyStepper.css";

/*
 * 学习动线的流程指示器。
 *
 * 三处取数，组件自身不判断任何业务状态：
 * - 状态从动线模型来（StudyFlowView）
 * - 文案从语义层来
 * - 颜色尺寸从 token 来，本文件零硬编码色值与字号
 *
 * 循环体（学习 ⇄ 测试）在步骤条中折叠为一项，鼠标靠近后渐显毛玻璃浮层，
 * 浮层内展示逐节五态。浮层自动收纳，不需要按钮切换。
 */

export interface StudyStepperProps {
  flow: StudyFlowView;
  /**
   * 已废弃：Stepper 现在是纯流程指示器，不再跳转。
   * 保留参数是为了不破坏旧 demo 脚本，实际渲染时会忽略它。
   */
  hrefFor?: (step: StudyStepId, nodeId?: string) => string;
  /** @deprecated 浮层改为 hover/focus 自动触发，不再受控。 */
  expanded?: boolean;
  /** @deprecated 浮层改为 hover/focus 自动触发，不再受控。 */
  onToggle?: (next: boolean) => void;
  /**
   * 横向用于页面顶部的步骤条，纵向用于左侧栏。
   * 侧栏只有 232px，横向放不下六个环节。
   */
  orientation?: "horizontal" | "vertical";
}

const CYCLE_STEP: StudyStepId = "lesson";

function isCycleStep(step: StudyStepId): boolean {
  return step === "lesson" || step === "activity";
}

export function StudyStepper({
  flow,
  hrefFor: _hrefFor,
  orientation = "horizontal",
}: StudyStepperProps) {
  return (
    <nav className="study-stepper" aria-label={STEPPER_LABELS.nav} data-orientation={orientation}>
      <ol className="stepper-track">
        {flow.steps.map((step, index) => {
          const cycle = isCycleStep(step.id);
          const isCurrent = step.status === "current";
          const label = stepLabel(step.id);

          return (
            <li
              className={`stepper-item${cycle ? " is-cycle" : ""}`}
              key={step.id}
              data-status={step.status}
              data-enterable={step.enterable ? "yes" : "no"}
            >
              <div className="stepper-node-wrap">
                {/*
                  现在是流程指示器，不是导航卡片。
                  所有节点都渲染成 span，点击不会跳到别的环节。
                  title 是给「侧栏收起」兜底的：那时文字被隐藏，只剩圆点，
                  靠原生提示告诉用户这个圆点是哪个环节。
                */}
                <span
                  className="stepper-node"
                  title={label}
                  {...(isCurrent ? { "aria-current": "step" as const } : {})}
                  {...(step.status === "locked" ? { "aria-disabled": "true" } : {})}
                >
                  <StepperBody label={label} status={step.status} />
                  {step.status === "locked" ? (
                    <span className="visually-hidden">{stepStatusLabel(step.status)}</span>
                  ) : null}
                </span>
              </div>

              {/*
                浮层始终在 DOM 里，显隐交给 CSS：
                鼠标 hover 或键盘 focus 在循环项上时渐显。
                它不占文档流，所以不会把下方环节推开，也不会被容器裁掉。
              */}
              {cycle && flow.cycles.length > 0 ? (
                <div className="stepper-lessons">
                  <p className="stepper-progress-title">{STEPPER_LABELS.progress}</p>
                  <p className="stepper-progress">{progressLabel(flow.completedLessons, flow.totalLessons)}</p>
                  <ol className="lesson-list">
                    {flow.cycles.map((item) => (
                      <li className="lesson-item" key={item.nodeId} data-status={item.status}>
                        <span className="lesson-index">{item.index}</span>
                        <span className="lesson-text">{lessonStatusLabel(item.status)}</span>
                        {item.status === "teaching-skipped" ? (
                          <span className="lesson-flag" aria-hidden="true" />
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {pendingPracticalLabel(flow.pendingPractical) === "" ? null : (
                    <p className="stepper-notice" role="status">{pendingPracticalLabel(flow.pendingPractical)}</p>
                  )}
                </div>
              ) : null}

              {index < flow.steps.length - 1 ? (
                <span className="stepper-connector" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepperBody({ label, status }: { label: string; status: string }) {
  return (
    <>
      <span className="stepper-mark" aria-hidden="true" />
      <span className="stepper-text">
        <span className="stepper-label">{label}</span>
        <span className="visually-hidden">{stepStatusLabel(status as "completed" | "current" | "locked")}</span>
      </span>
    </>
  );
}
