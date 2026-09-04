import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ABOUT_MAX_LENGTH,
  DISAPPEARING_WINDOWS,
  LAST_SEEN_VISIBILITIES,
  STATUS_PRIVACIES,
  STATUS_PRIVACY_LIST_MAX,
  UPLOADED_PICTURE_URL,
} from '@betweenus/shared-types';
import type {
  ChangePasswordRequest,
  LastSeenVisibility,
  ForgotPasswordRequest,
  LoginRequest,
  RefreshRequest,
  RegisterRequest,
  ResetPasswordRequest,
  StatusPrivacy,
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
   * The line under the name on a profile card.
   *
   * An empty string is allowed and means "draw no line", so the lower bound is
   * zero rather than one. The upper bound is `ABOUT_MAX_LENGTH`, measured in
   * UTF-16 units by `MaxLength` where the clients count code points - a line of
   * astral emoji is therefore cut off by the client before it ever reaches a
   * limit here, which is the safe direction for the two counts to disagree in.
   */
  @IsOptional()
  @IsString()
  @MaxLength(ABOUT_MAX_LENGTH * 2)
  about?: string;

  /**
   * Who may see when this account was last here.
   *
   * Validated against the published list rather than trusted, because an
   * unrecognised value written straight through would be a privacy setting
   * nothing can read back - and the safe reading of one of those is the widest,
   * which is the opposite of what somebody narrowing it intended.
   */
  @IsOptional()
  @IsIn(LAST_SEEN_VISIBILITIES)
  lastSeenVisibility?: LastSeenVisibility;

  /**
   * Who this account's moments are sealed for.
   *
   * Validated against the published list for the same reason the one above is:
   * a value nothing can read back is a privacy setting whose safe reading has
   * to be guessed, and every guess is wrong for somebody.
   */
  @IsOptional()
  @IsIn(STATUS_PRIVACIES)
  statusPrivacy?: StatusPrivacy;

  /**
   * The people that choice names. Ids only - the server resolves nothing here,
   * and the friend list is still the ceiling when a post is written, so an id
   * that names a stranger or nobody at all simply never matches.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STATUS_PRIVACY_LIST_MAX)
  @IsUUID('4', { each: true })
  statusPrivacyList?: string[];

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

  /**
   * The wide picture behind the name, or null to go back to the flat accent
   * band. Held to the same rule as `avatarUrl` and for the same reason: a
   * profile picture is fetched by every client that can see the account, so an
   * arbitrary URL here would be a beacon reporting who looked at whom.
   */
  @ValidateIf((dto: UpdateAccountDto) => dto.coverUrl !== null && dto.coverUrl !== undefined)
  @IsString()
  @MaxLength(512)
  @Matches(UPLOADED_PICTURE_URL, { message: 'coverUrl must be an uploaded picture' })
  coverUrl?: string | null;

  /**
   * This account's own disappearing window in seconds, or null to switch it
   * off. One of the published list, for the same reason a server's is.
   *
   * It hides history from this account on every device it signs in on and
   * changes nothing for anybody else - so it is a preference and not a
   * retention policy, and a server's own window still outranks it.
   */
  @IsOptional()
  @IsIn([null, ...DISAPPEARING_WINDOWS], {
    message: 'messageTtlSeconds must be null or one of the published windows',
  })
  messageTtlSeconds?: number | null;
}
