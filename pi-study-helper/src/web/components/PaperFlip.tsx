import type { CSSProperties, ReactNode } from "react";
import "./PaperFlip.css";

/*
 * 纸张翻页:同一处内容换页时,新纸从翻页方向滑入淡现。
 *
 * 学习页的站点纸叠、诊断答题、客观题做题共用这一套动效语言。
 * 用法:外层以 pageKey 作 React key 触发重挂载,动画随挂载播放;
 * direction 声明这次翻页的方向(+1 前进 / -1 后退)。
 *
 * 刻意只做入场:离场纸的交叠动画只在同构内容(站点纸叠)里做,
 * 表单类内容(题目)高度不一,交叠会造成跳动,直接换纸反而干净。
 */
export interface PaperFlipProps {
  className?: string;
  direction: 1 | -1;
  children: ReactNode;
}

export function PaperFlip({ className, direction, children }: PaperFlipProps) {
  return (
    <div
      className={`paper-flip${className === undefined ? "" : ` ${className}`}`}
      style={{ "--paper-from": direction === 1 ? "32px" : "-32px" } as CSSProperties}
    >
      {children}
    </div>
  );
}
