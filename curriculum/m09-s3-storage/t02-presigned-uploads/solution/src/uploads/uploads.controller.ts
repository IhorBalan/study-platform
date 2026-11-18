import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserGuard } from '../auth/user.guard.js';
import { FILE_TYPES, MAX_UPLOAD_BYTES } from './file-types.js';
import { UploadsService } from './uploads.service.js';

const CreateUpload = z.strictObject({
  contentType: z.enum(Object.keys(FILE_TYPES) as [string, ...string[]]),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
const KeyBody = z.strictObject({ key: z.string().min(1).max(1024) });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({ message: 'Invalid request', issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  return result.data;
}

@Controller()
@UseGuards(UserGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Step 1: the browser asks for somewhere to put a file. */
  @Post('uploads')
  create(@CurrentUser() userId: string, @Body() body: unknown) {
    const { contentType, size } = parse(CreateUpload, body);
    return this.uploads.createUpload(userId, contentType, size);
  }

  /** Step 3: after the PUT to S3, the browser says it is done; we check what arrived. */
  @Post('uploads/complete')
  @HttpCode(200)
  complete(@CurrentUser() userId: string, @Body() body: unknown) {
    const { key } = parse(KeyBody, body);
    return this.uploads.completeUpload(userId, key);
  }

  @Get('downloads')
  download(@CurrentUser() userId: string, @Query('key') key: unknown) {
    if (typeof key !== 'string' || key.length === 0) throw new BadRequestException('key is required');
    return this.uploads.downloadUrl(userId, key);
  }
}
