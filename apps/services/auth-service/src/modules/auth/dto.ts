import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RefreshRequest,
  RegisterRequest,
  UpdateAccountRequest,
} from '@nexora/shared-types';

export class RegisterDto implements RegisterRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(3, 32)
  @Matches(/^[a-z0-9_.-]+$/i, {
    message: 'Username may contain letters, numbers, dot, dash and underscore only',
  })
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class LoginDto implements LoginRequest {
  /**
   * Email or username. The admin account is created with a username and no
   * memorable address, and people type whichever they remember anyway.
   */
  @IsString()
  @Length(3, 254, { message: 'Enter your username or email address' })
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}

export class RefreshDto implements RefreshRequest {
  @IsString()
  @MaxLength(4096)
  refreshToken!: string;
}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}

export class UpdateAccountDto implements UpdateAccountRequest {
  @IsOptional()
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-z0-9_.-]+$/i, {
    message: 'Username may contain letters, numbers, dot, dash and underscore only',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  displayName?: string;
}
