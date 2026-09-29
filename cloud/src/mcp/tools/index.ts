import type { AnyTool } from '../tool';
import { cancelJob, dismissJob, generate, getJobTool, listJobs, resumeJobTool } from './jobs';
import { estimateCost, listModels } from './models';
import { addReference } from './references';

/** Every tool the MCP server offers, in the order an agent should meet them. */
export const TOOLS: AnyTool[] = [listModels, estimateCost, addReference, generate, getJobTool, listJobs, cancelJob, resumeJobTool, dismissJob];
