import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';

/** An RFC 9457 problem document. Extension members are allowed. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  [extension: string]: unknown;
}

// TODO: catch every exception and answer with application/problem+json.
// Register the filter in AppModule under the APP_FILTER token.
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    throw new Error('ProblemDetailsFilter is not implemented');
  }
}
