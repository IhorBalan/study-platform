import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ProblemDetails } from '@study/shared';
import type { Response } from 'express';

/**
 * Turns every error into an RFC 9457 problem document, so the web app and the
 * learner's own HTTP probes always see the same error shape.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      title = HttpStatus[status]?.replaceAll('_', ' ').toLowerCase() ?? title;
      title = title.charAt(0).toUpperCase() + title.slice(1);
      if (typeof body === 'string') detail = body;
      else if (typeof body === 'object' && body !== null && 'message' in body) {
        const message = (body as { message: unknown }).message;
        detail = Array.isArray(message) ? message.join('; ') : String(message);
      }
    } else {
      // Unknown errors are logged in full but never echoed to the client.
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const problem: ProblemDetails = { type: 'about:blank', title, status, detail };
    res.status(status).type('application/problem+json').json(problem);
  }
}
