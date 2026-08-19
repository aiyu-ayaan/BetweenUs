import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { DevicePlatform } from '@betweenus/shared-types';

/** Long enough that nothing sensible is refused, short enough to bound a row. */
const MAX_TOKEN = 4096;

export class RegisterDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TOKEN)
  token!: string;

  @IsIn(['android', 'ios', 'web'])
  platform!: DevicePlatform;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  deviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}
