import { useMemo } from 'react';
import type { ResultStackItem } from '@/components/ResultStack';
import { useImageResultsStore } from '@/store/useImageResultsStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';

/**
 * Every image finished in this tab, from any engine and any model, newest first.
 *
 * Both local image panels render this rather than their own slice, because a
 * result is a result wherever it came from: filtering by the engine on screen
 * meant a person comparing Nano Banana against a Kie model lost one side the
 * moment they switched to the other. Each card still names its provider and
 * model in `ResultMeta`, so nothing is lost by mixing them.
 */
export function useImageResultFeed(): ResultStackItem[] {
  const local = useImageResultsStore((state) => state.items);
  const kieJobs = useKieJobsStore((state) => state.jobs);

  return useMemo(() => {
    const kie = kieJobs.flatMap((job): ResultStackItem[] =>
      job.mediaType === 'image' && job.state === 'success' && job.resultUrls[0]
        ? [
            {
              id: job.id,
              src: job.resultUrls[0],
              provider: 'kie',
              modelId: job.modelId,
              prompt: job.prompt,
              slug: job.slug,
              createdAt: job.createdAt,
              // `updatedAt` is the poll that saw it finish, so this is
              // submit-to-result including queue time. Kie reports no cost
              // per task — only a credit balance — so the footer omits it.
              startedAt: job.createdAt,
              finishedAt: job.updatedAt,
            },
          ]
        : []
    );
    // Ordered by when each arrived, so a Kie job that finishes after a Gemini
    // run lands on top even though it was submitted first.
    const arrived = (item: ResultStackItem) => item.finishedAt ?? item.createdAt ?? 0;
    return [...local, ...kie].sort((a, b) => arrived(b) - arrived(a));
  }, [local, kieJobs]);
}
