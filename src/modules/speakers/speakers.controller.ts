import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/guards/public.decorator';
import { SpeakersService } from './speakers.service';

@ApiTags('speakers')
@Controller('speakers')
export class SpeakersController {
  constructor(private readonly speakersService: SpeakersService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List available Azure TTS speakers' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of available speakers',
  })
  async listSpeakers() {
    return this.speakersService.listAvailableSpeakers();
  }
}
