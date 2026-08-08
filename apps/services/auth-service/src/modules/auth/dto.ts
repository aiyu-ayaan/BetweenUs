import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import type {
  LoginRequest,
  RefreshRequest,
  RegisterRequest,
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
  @IsEmail()
  @MaxLength(254)
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
