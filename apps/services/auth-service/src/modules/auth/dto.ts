import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UPLOADED_PICTURE_URL } from '@betweenus/shared-types';
import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RefreshRequest,
  RegisterRequest,
  ResetPasswordRequest,
  UpdateAccountRequest,
} from '@betweenus/shared-types';

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

export class ForgotPasswordDto implements ForgotPasswordRequest {
  /** Email or username - the same field the login form takes. */
  @IsString()
  @Length(3, 254, { message: 'Enter your username or email address' })
  identifier!: string;
}

export class ResetPasswordDto implements ResetPasswordRequest {
  @IsString()
  @Length(16, 200)
  token!: string;

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

  /**
   * An uploaded picture, or null to go back to the initial. It has to be one of
   * ours: an avatar renders in every client that can see the account, so an
   * arbitrary URL here would be a beacon that reports back who looked at it.
   */
  @ValidateIf((dto: UpdateAccountDto) => dto.avatarUrl !== null && dto.avatarUrl !== undefined)
  @IsString()
  @MaxLength(512)
  @Matches(UPLOADED_PICTURE_URL, { message: 'avatarUrl must be an uploaded picture' })
  avatarUrl?: string | null;
}
