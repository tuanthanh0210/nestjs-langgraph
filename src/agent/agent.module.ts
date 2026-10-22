import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';
import { ChatModelService } from './chat-model.service.js';
import { CheckpointerService } from './checkpointer.service.js';

@Module({
  imports: [CatalogModule, ToolsModule],
  controllers: [AgentController],
  providers: [ChatModelService, CheckpointerService, AgentService],
  exports: [AgentService],
})
export class AgentModule {}
