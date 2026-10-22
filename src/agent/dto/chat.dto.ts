import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class ChatRequestDto {
  @ApiProperty({
    description: 'The user message. The agent keeps the full thread history.',
    example: 'Tính 12 * (3 + 1) giúp anh',
    maxLength: 32_000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32_000)
  message!: string;

  @ApiPropertyOptional({
    description:
      'Existing conversation id. Omit it to start a new thread; the response returns the id.',
    example: '6f1a9d6e-3a7b-4f1e-9c2a-4d2e8b7c1a90',
    pattern: THREAD_ID_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Matches(THREAD_ID_PATTERN, {
    message: 'threadId may contain only letters, numbers, "_" and "-" (max 128 characters)',
  })
  threadId?: string;
}

export class ThreadIdParamDto {
  @ApiProperty({
    description: 'Conversation/thread id',
    example: '6f1a9d6e-3a7b-4f1e-9c2a-4d2e8b7c1a90',
    pattern: THREAD_ID_PATTERN.source,
  })
  @IsString()
  @Matches(THREAD_ID_PATTERN, {
    message: 'threadId may contain only letters, numbers, "_" and "-" (max 128 characters)',
  })
  threadId!: string;
}
