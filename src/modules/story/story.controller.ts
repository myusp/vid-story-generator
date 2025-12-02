import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { Response } from 'express';
import { StoryService } from './story.service';
import { StartStoryDto } from '../../common/dto/start-story.dto';
import { Public } from '../../common/guards/public.decorator';
import * as fs from 'fs';
import * as path from 'path';

@ApiTags('stories')
@ApiSecurity('api-key')
@Controller('stories')
export class StoryController {
  constructor(private readonly storyService: StoryService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start a new story project and begin generation' })
  @ApiResponse({
    status: 201,
    description: 'Project created and generation started',
  })
  async startProject(@Body() dto: StartStoryDto) {
    const project = await this.storyService.startProject(dto);

    // Automatically trigger generation in background
    this.storyService.generateFullStory(project.id).catch((error) => {
      console.error('Generation failed:', error);
    });

    return {
      ...project,
      message: 'Project created and generation started in background',
    };
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

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry/resume failed or incomplete generation' })
  @ApiResponse({
    status: 200,
    description: 'Retry started',
  })
  async retryGeneration(@Param('id') id: string) {
    const project = await this.storyService.getProject(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Run generation in background with resume capability
    this.storyService.generateFullStory(id).catch((error) => {
      console.error('Retry generation failed:', error);
    });

    return { message: 'Retry started', id, currentStatus: project.status };
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

  @Public()
  @Get(':id/download/video')
  @ApiOperation({ summary: 'Download project video' })
  @ApiResponse({
    status: 200,
    description: 'Returns the video file',
  })
  async downloadVideo(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const project = await this.storyService.getProject(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!project.videoPath || !fs.existsSync(project.videoPath)) {
      throw new NotFoundException('Video not found');
    }

    // Security: Validate the file is in the expected storage directory
    const resolvedPath = path.resolve(project.videoPath);
    const storageDir = path.resolve('./storage/videos');
    if (!resolvedPath.startsWith(storageDir)) {
      throw new NotFoundException('Video not found');
    }

    const fileName = path.basename(project.videoPath);
    const file = fs.createReadStream(project.videoPath);

    res.set({
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    return new StreamableFile(file);
  }

  @Public()
  @Get(':id/download/srt')
  @ApiOperation({ summary: 'Download project subtitles' })
  @ApiResponse({
    status: 200,
    description: 'Returns the SRT file',
  })
  async downloadSrt(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const project = await this.storyService.getProject(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!project.srtPath || !fs.existsSync(project.srtPath)) {
      throw new NotFoundException('Subtitles not found');
    }

    // Security: Validate the file is in the expected storage directory
    const resolvedPath = path.resolve(project.srtPath);
    const storageDir = path.resolve('./storage/subtitles');
    if (!resolvedPath.startsWith(storageDir)) {
      throw new NotFoundException('Subtitles not found');
    }

    const fileName = path.basename(project.srtPath);
    const file = fs.createReadStream(project.srtPath);

    res.set({
      'Content-Type': 'text/plain',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    return new StreamableFile(file);
  }
}
