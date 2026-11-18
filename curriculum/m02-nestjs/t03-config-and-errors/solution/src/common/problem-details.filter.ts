import { STATUS_CODES } from 'node:http';
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from './domain-error.js';

/** An RFC 9457 problem document. Extension members are allowed. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  [extension: string]: unknown;
}

const DOMAIN_STATUS: Record<DomainError['kind'], number> = {
  conflict: HttpStatus.CONFLICT,
  'not-found': HttpStatus.NOT_FOUND,
};

/** The standard reason phrase: 404 -> "Not Found". */
function titleFor(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

/**
 * Turns every exception into an RFC 9457 problem document. With `type` set to
 * "about:blank" the title is simply the HTTP status phrase.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const problem = this.toProblem(exception);
    if (problem.status >= 500) {
      // The full error goes to the log, where operators can read it. The client gets none of it.
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${req.method} ${req.originalUrl} failed`, stack);
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof DomainError) {
      const status = DOMAIN_STATUS[exception.kind];
      return { type: 'about:blank', title: titleFor(status), status, detail: exception.message };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const problem: ProblemDetails = { type: 'about:blank', title: titleFor(status), status };
      if (status >= 500) return problem;

      // getResponse() is a string, or an object such as { message, error, statusCode }.
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      if (Array.isArray(message)) {
        // Validation pipes report one message per broken rule.
        problem.detail = 'The request is not valid.';
        problem.errors = message.map(String);
      } else if (typeof message === 'string') {
        problem.detail = message;
      }
      return problem;
    }

    // Anything else is a bug or an outage. Say so, and nothing more.
    return {
      type: 'about:blank',
      title: titleFor(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
