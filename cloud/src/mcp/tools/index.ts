import type { AnyTool } from '../tool';
import { cancelJob, dismissJob, generate, getJobTool, listJobsTool, resumeJobTool } from './jobs';
import { deleteAssetTool, getSpend, listAssetsTool, viewAsset } from './library';
import { estimateCost, listModels } from './models';
import { addReference } from './references';

/** Every tool the MCP server offers, in the order an agent should meet them. */
export const TOOLS: AnyTool[] = [listModels, estimateCost, addReference, generate, getJobTool, listJobsTool, cancelJob, resumeJobTool, dismissJob, listAssetsTool, viewAsset, deleteAssetTool, getSpend];
