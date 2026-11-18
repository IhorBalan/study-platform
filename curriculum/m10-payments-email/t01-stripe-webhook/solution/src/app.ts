import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/** Creates the app. main.ts and the checks both call this, so every option set here applies to both. */
export async function createApp(): Promise<INestApplication> {
  // rawBody keeps the exact request bytes on req.rawBody next to the parsed body. The signature covers those bytes.
  return NestFactory.create(AppModule, { rawBody: true, logger: ['error', 'warn'] });
}
