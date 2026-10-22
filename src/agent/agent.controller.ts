import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AgentService } from './agent.service.js';
import type { AgentStreamEvent } from './agent.types.js';
import { AgentInfoDto, ChatResponseDto, ThreadHistoryDto } from './dto/agent-response.dto.js';
import { ChatRequestDto, ThreadIdParamDto } from './dto/chat.dto.js';

@ApiTags('agent')
@Controller('api/agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentService: AgentService) {}

  @Get('info')
  @ApiOperation({ summary: 'Describe the configured agent' })
  @ApiOkResponse({ type: AgentInfoDto, description: 'Provider, model, persistence and tools.' })
  info(): AgentInfoDto {
    return this.agentService.getInfo();
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run the agent and wait for the final answer',
    description:
      'Invokes the LangGraph agent, executing any tools the model requests. ' +
      'Pass the returned threadId in later calls to continue the conversation.',
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiOkResponse({ type: ChatResponseDto, description: 'The final assistant message.' })
  @ApiBadGatewayResponse({ description: 'The language model or a tool failed.' })
  chat(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return this.agentService.run(dto);
  }

  @Post('chat/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run the agent and stream progress over Server-Sent Events',
    description:
      'Emits named events: `meta`, `token`, `tool_start`, `tool_end`, `done`, `error`. ' +
      'Each event also carries a JSON payload with a `type` field in the `data:` line.',
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiProduces('text/event-stream')
  @ApiResponse({
    status: 200,
    description:
      'SSE stream. Example frame:\n\n' +
      'event: token\n' +
      'data: {"type":"token","content":"The answer"}\n\n',
  })
  async stream(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    res.on('close', onClose);

    // Keep proxies (nginx, load balancers) from closing idle SSE connections.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(': ping\n\n');
      }
    }, 15_000);

    try {
      for await (const event of this.agentService.stream(dto, abortController.signal)) {
        this.send(res, event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (error) {
      this.logger.error(
        'Unhandled error while streaming',
        error instanceof Error ? error.stack : String(error),
      );
      this.send(res, {
        type: 'error',
        message: 'The agent could not complete this request. Please try again.',
      });
    } finally {
      clearInterval(heartbeat);
      res.off('close', onClose);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Get('threads/:threadId')
  @ApiOperation({ summary: 'Read the stored conversation for a thread' })
  @ApiOkResponse({ type: ThreadHistoryDto })
  history(@Param() params: ThreadIdParamDto): Promise<ThreadHistoryDto> {
    return this.agentService.getHistory(params.threadId);
  }

  @Delete('threads/:threadId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a thread and all of its checkpoints' })
  @ApiNoContentResponse({ description: 'Thread deleted (idempotent).' })
  async deleteThread(@Param() params: ThreadIdParamDto): Promise<void> {
    await this.agentService.deleteThread(params.threadId);
  }

  private send(res: Response, event: AgentStreamEvent): void {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}
