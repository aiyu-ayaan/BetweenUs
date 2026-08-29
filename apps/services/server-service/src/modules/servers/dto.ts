import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SERVER_ROLES } from '@betweenus/permissions';
import { DISAPPEARING_WINDOWS, UPLOADED_PICTURE_URL } from '@betweenus/shared-types';
import type {
  AddServerMemberRequest,
  ChannelType,
  CreateChannelRequest,
  CreateServerEmojiRequest,
  CreateServerRequest,
  CreateServerRoleRequest,
  ServerRole,
  UpdateServerRoleRequest,
  SetChannelMembersRequest,
  UpdateChannelRequest,
  UpdateServerMemberRequest,
  UpdateServerRequest,
} from '@betweenus/shared-types';

export class CreateServerDto implements CreateServerRequest {
  @IsString()
  @Length(2, 64)
  name!: string;
}

export class JoinServerDto {
  /** An invite code. A server's slug is not one and no longer opens a door. */
  @IsString()
  @Length(4, 64)
  code!: string;
}

export class CreateServerInviteDto {
  /** Absent or null for an invite that never expires. A year is the ceiling. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number | null;

  /** Absent or null for unlimited. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number | null;
}

export class AddServerMemberDto implements AddServerMemberRequest {
  @IsString()
  @Length(2, 32)
  username!: string;
}

/**
 * Naming a picture that is already uploaded.
 *
 * The shape is checked here and the *content* is checked in the service: that
 * the URL is one this deployment stored, that the name is free, and that the
 * server has room. A URL somebody else controls, rendered by every client in
 * the server, is the thing worth refusing rather than validating.
 */
export class CreateServerEmojiDto implements CreateServerEmojiRequest {
  @IsString()
  @Length(2, 32)
  name!: string;

  @IsString()
  @Length(1, 512)
  url!: string;

  @IsOptional()
  @IsBoolean()
  animated?: boolean;
}

export class CreateChannelDto implements CreateChannelRequest {
  @IsUUID()
  serverId!: string;

  @IsString()
  @Length(1, 32)
  name!: string;

  @IsOptional()
  @IsIn(['TEXT', 'VOICE'])
  type?: ChannelType;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(256)
  memberIds?: string[];
}

export class UpdateChannelDto implements UpdateChannelRequest {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 256)
  topic?: string;
}

export class SetChannelMembersDto implements SetChannelMembersRequest {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(256)
  userIds!: string[];
}

export class UpdateServerDto implements UpdateServerRequest {
  @IsOptional()
  @IsString()
  @Length(2, 64)
  name?: string;

  /**
   * An uploaded picture, or null to go back to the initials. It has to be one
   * of ours - see `UPLOADED_PICTURE_URL`.
   */
  @ValidateIf((dto: UpdateServerDto) => dto.iconUrl !== null && dto.iconUrl !== undefined)
  @IsString()
  @MaxLength(512)
  @Matches(UPLOADED_PICTURE_URL, { message: 'iconUrl must be an uploaded picture' })
  iconUrl?: string | null;

  /**
   * How long a message sent here lives, in seconds, or null to keep everything.
   *
   * Checked against the published list rather than accepted as any number: a
   * free integer here is a server-wide retention policy nobody's client can
   * offer to undo, in both directions - three seconds is a conversation that
   * cannot be read, and ten years is a retention policy wearing a privacy
   * feature's clothes.
   */
  @IsOptional()
  @IsIn([null, ...DISAPPEARING_WINDOWS], {
    message: 'messageTtlSeconds must be null or one of the published windows',
  })
  messageTtlSeconds?: number | null;
}

/**
 * The permission arrays are filtered against the assignable list in the
 * service, so the DTO only has to stop an unbounded body getting that far.
 */
export class UpdateServerMemberDto implements UpdateServerMemberRequest {
  @IsOptional()
  @IsIn([...SERVER_ROLES])
  role?: ServerRole;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(32)
  grantedPermissions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(32)
  deniedPermissions?: string[];

  /** Replaces the whole set. Ids from another server are dropped, not refused. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(64)
  roleIds?: string[];
}

/** Colour is validated in the service too - it ends up in a stylesheet. */
export class CreateServerRoleDto implements CreateServerRoleRequest {
  @IsString()
  @Length(1, 32)
  name!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colour must be #rrggbb' })
  colour?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-1000)
  @Max(1000)
  rank?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(32)
  permissions?: string[];
}

export class UpdateServerRoleDto implements UpdateServerRoleRequest {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  name?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colour must be #rrggbb' })
  colour?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-1000)
  @Max(1000)
  rank?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(32)
  permissions?: string[];
}
