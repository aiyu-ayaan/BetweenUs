import { IsString, MaxLength } from 'class-validator';
import type { OAuthExchangeRequest } from '@nexora/shared-types';

export class OAuthExchangeDto implements OAuthExchangeRequest {
  @IsString()
  @MaxLength(100)
  code!: string;
}
