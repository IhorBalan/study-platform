import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/** Creates the app. main.ts and the checks both call this, so every option set here applies to both. */
export async function createApp(): Promise<INestApplication> {
  // TODO: the webhook signature covers the exact bytes Stripe sent. Make them available to the controller.
  return NestFactory.create(AppModule, { logger: ['error', 'warn'] });
}
