import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
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
}
