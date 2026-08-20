import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "./AppShell.js";
import { ActivityPage } from "../pages/ActivityPage.js";
import { DiagnosticPage } from "../pages/DiagnosticPage.js";
import { LearnPage } from "../pages/LearnPage.js";
import { PathPage } from "../pages/PathPage.js";
import { StartPage } from "../pages/StartPage.js";
import { StudyDeepLinkPage } from "../pages/StudyDeepLinkPage.js";
import { SummaryPage } from "../pages/SummaryPage.js";

export const appRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <StartPage /> },
      { path: "study", element: <StudyDeepLinkPage /> },
      { path: "diagnostic/:sessionId", element: <DiagnosticPage /> },
      { path: "path/:sessionId", element: <PathPage /> },
      { path: "learn/:sessionId/:nodeId", element: <LearnPage /> },
      { path: "activity/:sessionId/:activityId", element: <ActivityPage /> },
      { path: "summary/:sessionId", element: <SummaryPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
