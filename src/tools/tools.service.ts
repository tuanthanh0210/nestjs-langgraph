import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { Env } from '../config/env.validation.js';
import { calculatorTool } from './calculator.tool.js';
import { createCurrentTimeTool } from './current-time.tool.js';
import { weatherTool } from './weather.tool.js';

export interface ToolDescriptor {
  name: string;
  description: string;
}

/**
 * Single place where the agent's capabilities are declared.
 *
 * To add a tool: create it with `tool()` from `@langchain/core/tools`, import it
 * here and append it to the array. The graph, REST API and demo UI pick it up
 * automatically.
 */
@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);
  private readonly toolList: StructuredToolInterface[];

  constructor(config: ConfigService<Env, true>) {
    const timezone = config.get('DEFAULT_TIMEZONE', { infer: true });

    this.toolList = [
      calculatorTool,
      createCurrentTimeTool(timezone),
      weatherTool,
    ] as unknown as StructuredToolInterface[];

    this.logger.log(`Registered tools: ${this.toolList.map((item) => item.name).join(', ')}`);
  }

  getTools(): StructuredToolInterface[] {
    return this.toolList;
  }

  describe(): ToolDescriptor[] {
    return this.toolList.map((item) => ({
      name: item.name,
      description: item.description,
    }));
  }
}
