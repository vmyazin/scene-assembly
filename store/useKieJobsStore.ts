import type { KieJob } from '@/lib/kie/types';

import { createJobStore } from './createJobStore';

export const useKieJobsStore = createJobStore<KieJob>();
