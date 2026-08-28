import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  AdminOAuthProviderUpdate,
  AdminSmtpTestRequest,
  AdminSmtpUpdate,
  AdminUserUpdate,
  GlobalRole,
} from '@betweenus/shared-types';

export class AdminUserUpdateDto implements AdminUserUpdate {
  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: GlobalRole;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  /** True opens the reset window; false closes one that was not used. */
  @IsOptional()
  @IsBoolean()
  passwordReset?: boolean;
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

export class AdminSmtpDto implements AdminSmtpUpdate {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsString()
  @MaxLength(255)
  username!: string;

  /** Omitted keeps the stored password; the panel cannot read it back. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  password?: string;

  @IsString()
  @MaxLength(254)
  fromAddress!: string;

  @IsString()
  @MaxLength(120)
  fromName!: string;
}

export class AdminSmtpTestDto implements AdminSmtpTestRequest {
  /** Defaults to the administrator's own address when left out. */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  to?: string;
}
