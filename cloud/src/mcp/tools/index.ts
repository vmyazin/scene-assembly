import type { AnyTool } from '../tool';
import { estimateCost, listModels } from './models';

/** Every tool the MCP server offers, in the order an agent should meet them. */
export const TOOLS: AnyTool[] = [listModels, estimateCost];
