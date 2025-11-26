import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { StoryService } from './story.service';
import { StartStoryDto } from '../../common/dto/start-story.dto';

@ApiTags('stories')
@ApiSecurity('api-key')
@Controller('stories')
export class StoryController {
  constructor(private readonly storyService: StoryService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start a new story project' })
  @ApiResponse({
    status: 201,
    description: 'Project created successfully',
  })
  async startProject(@Body() dto: StartStoryDto) {
    return this.storyService.startProject(dto);
  }

  @Post(':id/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate story scenes and video' })
  @ApiResponse({
    status: 200,
    description: 'Generation started',
  })
  async generateStory(@Param('id') id: string) {
    const project = await this.storyService.getProject(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Run generation in background (should use queue in production)
    this.storyService.generateFullStory(id).catch((error) => {
      console.error('Generation failed:', error);
    });

    return { message: 'Generation started', id };
  }

  @Get()
  @ApiOperation({ summary: 'List all projects' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of projects',
  })
  async listProjects() {
    return this.storyService.listProjects();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details' })
  @ApiResponse({
    status: 200,
    description: 'Returns project details',
  })
  async getProject(@Param('id') id: string) {
    const project = await this.storyService.getProject(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }
}
