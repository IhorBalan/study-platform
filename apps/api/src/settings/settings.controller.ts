import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateSettings, type SettingsDto } from '@study/shared';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<SettingsDto> {
    return this.settings.get();
  }

  @Patch()
  update(@Body({ schema: UpdateSettings }) body: UpdateSettings): Promise<SettingsDto> {
    return this.settings.update(body);
  }
}
