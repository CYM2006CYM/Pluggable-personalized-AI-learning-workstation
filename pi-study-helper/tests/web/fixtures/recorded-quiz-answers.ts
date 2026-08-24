import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface RecordedGenerator {
  graphId: string;
  payload?: { candidateFeedback?: string };
}

interface RecordedQuestion {
  questionId: string;
  correctAnswer: string | boolean;
}

export async function recordedQuizAnswers(): Promise<Map<string, string | boolean>> {
  const raw = await readFile(resolve(import.meta.dirname, "../../../fixtures/model-responses/w6/recorded-quiz-responses.json"), "utf8");
  const parsed = JSON.parse(raw) as { recordings: RecordedGenerator[] };
  const answers = new Map<string, string | boolean>();
  for (const recording of parsed.recordings) {
    if (recording.graphId !== "generator" || recording.payload?.candidateFeedback === undefined) continue;
    const candidate = JSON.parse(recording.payload.candidateFeedback) as { questions?: RecordedQuestion[] };
    for (const question of candidate.questions ?? []) answers.set(question.questionId, question.correctAnswer);
  }
  return answers;
}
