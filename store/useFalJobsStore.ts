import type { FalJob } from '@/lib/fal/types';

import { createJobStore } from './createJobStore';

export const useFalJobsStore = createJobStore<FalJob>();
