import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Subject } from 'rxjs';

export interface LogEvent {
  projectId: string;
  level: string;
  code: string;
  message: string;
  meta?: any;
  timestamp: Date;
}

@Injectable()
export class LogsService {
  private logSubjects = new Map<string, Subject<LogEvent>>();

  constructor(private prisma: PrismaService) {}

  async getProjectLogs(projectId: string) {
    return this.prisma.storyLog.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  getLogStream(projectId: string): Subject<LogEvent> {
    if (!this.logSubjects.has(projectId)) {
      this.logSubjects.set(projectId, new Subject<LogEvent>());
    }
    return this.logSubjects.get(projectId);
  }

  emitLog(event: LogEvent) {
    const subject = this.getLogStream(event.projectId);
    subject.next(event);
  }

  closeStream(projectId: string) {
    const subject = this.logSubjects.get(projectId);
    if (subject) {
      subject.complete();
      this.logSubjects.delete(projectId);
    }
  }
}
