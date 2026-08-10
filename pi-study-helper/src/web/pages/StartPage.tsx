import { Link } from "react-router-dom";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";
import { profileDisplayFixture, startSessionMock } from "../mocks/safe-dtos.js";
import { useUiStore } from "../state/ui-store.js";

export function StartPage() {
  const pageViewState = useUiStore((state) => state.pageViewState);
  const setPageViewState = useUiStore((state) => state.setPageViewState);

  return (
    <PageFrame
      eyebrow="学习入口"
      title="开始一次可追踪的学习会话"
      summary="选择已启用资料包、目标和时间预算。新会话绑定当前Profile revision。"
      actions={<span className="header-badge">本地演示</span>}
    >
      {pageViewState !== "ready" ? (
        <PageStatePanel page="start" state={pageViewState} />
      ) : (
        <div className="start-layout" data-page="start">
          <section className="work-section profile-section" aria-labelledby="profile-heading">
            <div className="section-heading">
              <div>
                <p className="section-kicker">ACTIVE PROFILE</p>
                <h2 id="profile-heading">{profileDisplayFixture.name}</h2>
              </div>
              <span className="status-tag success">已启用</span>
            </div>
            <dl className="metadata-grid">
              <div><dt>领域</dt><dd>{profileDisplayFixture.subjectId}</dd></div>
              <div><dt>修订</dt><dd>Revision {profileDisplayFixture.revision}</dd></div>
              <div><dt>能力</dt><dd>{profileDisplayFixture.modalities.join(" / ")}</dd></div>
            </dl>
          </section>

          <section className="work-section start-form" aria-labelledby="session-heading">
            <div className="section-heading">
              <div>
                <p className="section-kicker">SESSION</p>
                <h2 id="session-heading">会话设置</h2>
              </div>
              <span className="quiet-label">Revision {startSessionMock.profileRevision}</span>
            </div>
            <div className="form-grid">
              <fieldset>
                <legend>学习入口</legend>
                <label className="choice-row"><input type="radio" name="entry" defaultChecked /> 系统推荐</label>
                <label className="choice-row"><input type="radio" name="entry" /> 按章节学习</label>
              </fieldset>
              <label>
                学习目标
                <select defaultValue={startSessionMock.goalId}>
                  <option value="goal-clean-orders">完成订单数据清洗</option>
                </select>
              </label>
              <label>
                可用时间
                <select defaultValue={String(startSessionMock.availableMinutes)}>
                  <option value="60">60分钟</option>
                  <option value="90">90分钟</option>
                  <option value="120">120分钟</option>
                </select>
              </label>
            </div>
            <div className="section-footer">
              <button type="button" className="button secondary">查看资料包详情</button>
              <Link className="button primary" to={`/diagnostic/${startSessionMock.sessionId}`}>开始学习</Link>
            </div>
          </section>

          <section className="resume-strip" aria-label="恢复会话">
            <div>
              <strong>有一项可恢复进度</strong>
              <span>最后完整阶段：learning · 会话版本 8</span>
            </div>
            <button type="button" className="button text-button" data-action="open-checkpoint" onClick={() => setPageViewState("recovery")}>查看检查点</button>
          </section>
        </div>
      )}
    </PageFrame>
  );
}
