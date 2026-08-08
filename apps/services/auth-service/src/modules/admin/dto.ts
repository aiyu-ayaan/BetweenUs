import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AdminOAuthProviderUpdate, AdminUserUpdate, GlobalRole } from '@nexora/shared-types';

export class AdminUserUpdateDto implements AdminUserUpdate {
  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: GlobalRole;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

export class AdminOAuthProviderDto implements AdminOAuthProviderUpdate {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(400)
  clientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  clientSecret?: string;
}
