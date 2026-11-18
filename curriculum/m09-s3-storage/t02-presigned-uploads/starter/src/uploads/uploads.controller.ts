import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserGuard } from '../auth/user.guard.js';
import { UploadsService } from './uploads.service.js';

@Controller()
@UseGuards(UserGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Step 1: the browser asks for somewhere to put a file. Body: { contentType, size }. */
  @Post('uploads')
  create(@CurrentUser() userId: string, @Body() body: unknown) {
    // TODO: validate the body (allowed types and sizes are in file-types.ts), answer 400 otherwise.
    return this.uploads.createUpload(userId, body);
  }

  /** Step 3: after the PUT to S3, the browser says it is done. Body: { key }. */
  @Post('uploads/complete')
  @HttpCode(200)
  complete(@CurrentUser() userId: string, @Body() body: unknown) {
    // TODO: validate the body.
    return this.uploads.completeUpload(userId, body);
  }

  @Get('downloads')
  download(@CurrentUser() userId: string, @Query('key') key: unknown) {
    return this.uploads.downloadUrl(userId, key);
  }
}
