import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ScenesService } from './scenes.service';

@ApiTags('stories')
@ApiSecurity('api-key')
@Controller('stories/:projectId/scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all scenes for a project' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of scenes',
  })
  async getScenes(@Param('projectId') projectId: string) {
    return this.scenesService.getProjectScenes(projectId);
  }
}
