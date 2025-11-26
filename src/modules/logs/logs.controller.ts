import { Controller, Get, Param, Sse } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { LogsService } from './logs.service';

@ApiTags('stories')
@ApiSecurity('api-key')
@Controller('stories/:projectId/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all logs for a project' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of logs',
  })
  async getLogs(@Param('projectId') projectId: string) {
    return this.logsService.getProjectLogs(projectId);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'Stream logs in real-time (SSE)' })
  streamLogs(@Param('projectId') projectId: string): Observable<any> {
    const logSubject = this.logsService.getLogStream(projectId);

    return logSubject.pipe(
      map((log) => ({
        data: log,
      })),
    );
  }
}
