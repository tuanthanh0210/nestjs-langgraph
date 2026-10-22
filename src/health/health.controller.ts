import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('api/health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'The process is up.' })
  check(): {
    status: 'ok';
    uptime: number;
    timestamp: string;
    version: string;
  } {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? '0.1.0',
    };
  }
}
