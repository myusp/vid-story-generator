import { Controller, Get, Query, Res, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/guards/public.decorator';
import { SpeakersService } from './speakers.service';

@ApiTags('speakers')
@Controller('speakers')
export class SpeakersController {
  constructor(private readonly speakersService: SpeakersService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List available Edge TTS speakers (free)' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of available speakers',
  })
  async listSpeakers() {
    return this.speakersService.listAvailableSpeakers();
  }

  @Get('gemini')
  @Public()
  @ApiOperation({ summary: 'List available Gemini TTS speakers' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of available Gemini TTS speakers',
  })
  async listGeminiSpeakers() {
    return this.speakersService.listGeminiSpeakers();
  }

  @Get('pollinations')
  @Public()
  @ApiOperation({ summary: 'List available Pollinations TTS speakers' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of available Pollinations TTS speakers',
  })
  async listPollinationsSpeakers() {
    return this.speakersService.listPollinationsSpeakers();
  }

  @Get('locale')
  @Public()
  @ApiOperation({ summary: 'Get speakers by locale' })
  @ApiQuery({
    name: 'locale',
    required: true,
    description: 'Locale code (e.g., en-US, id-ID, zh-CN)',
    example: 'en-US',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns filtered speakers by locale',
  })
  async getSpeakersByLocale(@Query('locale') locale: string) {
    return this.speakersService.getSpeakersByLocale(locale);
  }

  @Get('popular')
  @Public()
  @ApiOperation({ summary: 'Get popular/commonly used speakers' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of popular speakers',
  })
  async getPopularSpeakers() {
    return this.speakersService.getPopularSpeakers();
  }

  @Get('preview')
  @Public()
  @Header('Content-Type', 'audio/mpeg')
  @Header('Transfer-Encoding', 'chunked')
  @ApiOperation({ summary: 'Stream TTS audio preview for a speaker' })
  @ApiQuery({
    name: 'speaker',
    required: true,
    description: 'Speaker short name (e.g., en-US-JennyNeural)',
    example: 'en-US-JennyNeural',
  })
  @ApiQuery({
    name: 'text',
    required: false,
    description: 'Text to synthesize (default: sample text)',
    example: 'Hello! This is a voice preview.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns streaming audio data',
  })
  async previewSpeaker(
    @Query('speaker') speaker: string,
    @Query('text') text: string,
    @Res() res: Response,
  ) {
    const previewText =
      text || 'Hello! This is a voice preview for short story generation.';
    await this.speakersService.streamPreview(speaker, previewText, res);
  }
}
