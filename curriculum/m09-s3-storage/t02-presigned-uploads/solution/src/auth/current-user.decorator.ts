import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The id that UserGuard read from the request. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest<{ userId: string }>().userId;
});
