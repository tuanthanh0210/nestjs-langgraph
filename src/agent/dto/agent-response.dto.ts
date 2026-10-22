import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ChatRole } from '../agent.types.js';

export class ToolCallDto {
  @ApiProperty({ example: 'call_abc123' })
  id!: string;

  @ApiProperty({ example: 'calculator' })
  name!: string;

  @ApiProperty({
    description: 'Arguments the model passed to the tool',
    type: 'object',
    additionalProperties: true,
    example: { expression: '12 * (3 + 1)' },
  })
  args!: Record<string, unknown>;
}

export class ChatMessageDto {
  @ApiProperty({ enum: ['system', 'user', 'assistant', 'tool'], example: 'assistant' })
  role!: ChatRole;

  @ApiProperty({ example: 'Kết quả là 48.' })
  content!: string;

  @ApiPropertyOptional({ description: 'Tool name for tool messages', example: 'calculator' })
  name?: string;

  @ApiPropertyOptional({ type: [ToolCallDto], description: 'Tool calls requested by the model' })
  toolCalls?: ToolCallDto[];
}

export class TokenUsageDto {
  @ApiProperty({ example: 812 })
  inputTokens!: number;

  @ApiProperty({ example: 96 })
  outputTokens!: number;

  @ApiProperty({ example: 908 })
  totalTokens!: number;
}

export class ChatResponseDto {
  @ApiProperty({ example: '6f1a9d6e-3a7b-4f1e-9c2a-4d2e8b7c1a90' })
  threadId!: string;

  @ApiProperty({ type: ChatMessageDto })
  message!: ChatMessageDto;

  @ApiProperty({ description: 'Number of model calls in this run', example: 2 })
  iterations!: number;

  @ApiPropertyOptional({ type: TokenUsageDto })
  usage?: TokenUsageDto;
}

export class ToolInfoDto {
  @ApiProperty({ example: 'search_products' })
  name!: string;

  @ApiProperty({ example: 'Search the store product catalog…' })
  description!: string;
}

export class StoreInfoDto {
  @ApiProperty({ example: 'NestShop' })
  name!: string;

  @ApiPropertyOptional({ example: '0900 000 000' })
  hotline?: string;

  @ApiPropertyOptional({ example: 'hello@nestshop.vn' })
  email?: string;

  @ApiPropertyOptional({ example: '123 Nguyễn Trãi, Quận 1, TP.HCM' })
  address?: string;
}

export class CatalogInfoDto {
  @ApiProperty({ example: 14 })
  products!: number;

  @ApiProperty({ type: [String], example: ['Phụ kiện', 'Thiết bị', 'Âm thanh', 'Đời sống'] })
  categories!: string[];
}

export class AgentInfoDto {
  @ApiProperty({ enum: ['openai', 'mock'], example: 'openai' })
  provider!: 'openai' | 'mock';

  @ApiProperty({ example: 'gpt-4o-mini' })
  model!: string;

  @ApiProperty({ enum: ['memory', 'postgres'], example: 'memory' })
  persistence!: 'memory' | 'postgres';

  @ApiProperty({ example: 8 })
  maxIterations!: number;

  @ApiProperty({ type: StoreInfoDto })
  store!: StoreInfoDto;

  @ApiProperty({ type: CatalogInfoDto })
  catalog!: CatalogInfoDto;

  @ApiProperty({ type: [ToolInfoDto] })
  tools!: ToolInfoDto[];
}

export class ThreadHistoryDto {
  @ApiProperty({ example: '6f1a9d6e-3a7b-4f1e-9c2a-4d2e8b7c1a90' })
  threadId!: string;

  @ApiProperty({ description: 'False when the thread has no checkpoints yet' })
  exists!: boolean;

  @ApiProperty({ type: [ChatMessageDto] })
  messages!: ChatMessageDto[];

  @ApiPropertyOptional({ example: '2026-10-22T16:30:00.000Z' })
  createdAt?: string;

  @ApiProperty({ type: [String], example: [] })
  next!: string[];
}
