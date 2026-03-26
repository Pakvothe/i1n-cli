import { callCliSync } from "../../shared/supabase.js";
import type { TranslationProgressResponse } from "../../shared/types.js";

const MAX_WAIT_MS = 3 * 60 * 1000; // 3 minutes
const MAX_CONSECUTIVE_ERRORS = 10;

export async function waitForTranslation(
  projectId: string,
  apiKey: string,
): Promise<{ done: boolean; completed: number; total: number }> {
  let pollInterval = 1000;
  let lastCompleted = 0;
  let consecutiveErrors = 0;
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      return { done: false, completed: lastCompleted, total: 0 };
    }

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      return { done: false, completed: lastCompleted, total: 0 };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    let progress: TranslationProgressResponse;
    try {
      progress = await callCliSync(
        "translation-progress",
        { project_id: projectId },
        apiKey,
      );
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors++;
      pollInterval = Math.min(pollInterval * 1.5, 5000);
      continue;
    }

    if (progress.status === "done") {
      return { done: true, completed: progress.completed, total: progress.total };
    }

    const madeProgress = progress.completed > lastCompleted;
    lastCompleted = progress.completed;

    if (madeProgress) {
      pollInterval = Math.max(1000, Math.min(2000, progress.remaining * 50));
    } else if (progress.completed > 0) {
      pollInterval = Math.min(3000, pollInterval * 1.2);
    } else {
      pollInterval = Math.min(pollInterval * 1.3, 5000);
    }
  }
}
