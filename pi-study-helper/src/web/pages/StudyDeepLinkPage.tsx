import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useBootstrap } from "../api/use-bootstrap.js";
import { PageFrame } from "../components/PageFrame.js";
import { PageStatePanel } from "../components/PageStatePanel.js";

export interface StudyDeepLink {
  sessionId: string;
  nodeId: string;
  activityId: string;
}

const ALLOWED_FIELDS = new Set(["sessionId", "nodeId", "activityId"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function parseStudyDeepLinkSearch(search: string): StudyDeepLink {
  const params = new URLSearchParams(search);
  for (const field of params.keys()) if (!ALLOWED_FIELDS.has(field)) throw new Error("deep_link_unknown_field");
  for (const field of ALLOWED_FIELDS) if (params.getAll(field).length > 1) throw new Error("deep_link_duplicate_field");

  const sessionId = params.get("sessionId");
  const nodeId = params.get("nodeId");
  const activityId = params.get("activityId");
  if (sessionId === null || !IDENTIFIER.test(sessionId)) throw new Error("deep_link_invalid_session");
  if (nodeId === null || !IDENTIFIER.test(nodeId)) throw new Error("deep_link_invalid_node");
  if (activityId === null || !IDENTIFIER.test(activityId)) throw new Error("deep_link_invalid_activity");
  return { sessionId, nodeId, activityId };
}

export function StudyDeepLinkPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => {
    try {
      return { link: parseStudyDeepLinkSearch(location.search) };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error("deep_link_invalid") };
    }
  }, [location.search]);
  const bootstrap = useBootstrap(parsed.link?.sessionId);
  const attempted = useRef<string>();
  const [recoveryCode, setRecoveryCode] = useState<string>();

  useEffect(() => {
    const link = parsed.link;
    const session = bootstrap.data?.session;
    if (link === undefined || bootstrap.loading || bootstrap.error !== undefined || session === undefined || session.path === undefined) return;
    const path = session.path;
    const attemptKey = `${link.sessionId}:${session.view.sessionVersion}:${link.nodeId ?? ""}:${link.activityId ?? ""}`;
    if (attempted.current === attemptKey) return;
    attempted.current = attemptKey;

    if (session.sessionId !== link.sessionId || session.view.sessionId !== link.sessionId
      || session.sessionVersion !== session.view.sessionVersion
      || session.profileRevision !== session.view.profileRevision
      || session.view.pathVersion !== path.pathVersion) {
      setRecoveryCode("deep_link_session_revision_mismatch");
      return;
    }
    const boundNode = path.nodes.find((node) => node.nodeId === link.nodeId);
    if (boundNode === undefined) {
      setRecoveryCode("deep_link_node_mismatch");
      return;
    }
    if (!boundNode.activityIds.includes(link.activityId)) {
      setRecoveryCode("deep_link_activity_mismatch");
      return;
    }

    const currentAttempt = session.currentAttempt;
    if (currentAttempt !== undefined) {
      if (currentAttempt.activityId !== link.activityId) {
        setRecoveryCode("deep_link_attempt_mismatch");
        return;
      }
      navigate(`/activity/${link.sessionId}/${currentAttempt.activityId}`, { replace: true });
      return;
    }

    api.getNextStep({
      sessionId: link.sessionId,
      sessionVersion: session.view.sessionVersion,
      profileRevision: session.view.profileRevision,
      pathVersion: path.pathVersion,
    }).then((next) => {
      if (next.completed || next.node === undefined || next.activity === undefined
        || next.sessionId !== link.sessionId
        || next.profileRevision !== session.view.profileRevision
        || next.pathVersion !== path.pathVersion
        || next.node.nodeId !== link.nodeId
        || next.activity.activityId !== link.activityId) {
        setRecoveryCode("deep_link_server_step_mismatch");
        return;
      }
      navigate(`/learn/${link.sessionId}/${next.node.nodeId}`, { replace: true, state: { next } });
    }).catch(() => setRecoveryCode("deep_link_recovery_unavailable"));
  }, [bootstrap.data, bootstrap.error, bootstrap.loading, navigate, parsed.link]);

  const code = parsed.error?.message
    ?? recoveryCode
    ?? (bootstrap.error === undefined ? undefined : "deep_link_session_unavailable")
    ?? (!bootstrap.loading && bootstrap.data?.session === undefined ? "deep_link_session_not_found" : undefined);

  return <PageFrame eyebrow="共享会话" title="正在核对服务端学习步骤" summary="深链只提供安全标识，页面始终以服务端 Bootstrap 为准。" actions={<span className="header-badge">TUI → Web</span>}>
    {parsed.error === undefined && bootstrap.loading ? <PageStatePanel page="activity" state="loading" /> : null}
    {code !== undefined ? <PageStatePanel page="activity" state="recovery" code={code} detail="该深链不能继续当前服务端活动。不会自动创建替代会话，请从开始页恢复。" /> : null}
  </PageFrame>;
}
