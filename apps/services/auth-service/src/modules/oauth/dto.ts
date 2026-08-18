import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { OAuthExchangeRequest } from '@betweenus/shared-types';

export class OAuthExchangeDto implements OAuthExchangeRequest {
  @IsString()
  @MaxLength(100)
  code!: string;

  /** The secret behind the challenge, for a sign-in that was started with one. */
  @IsOptional()
  @IsString()
  @Length(43, 128)
  verifier?: string;
}
