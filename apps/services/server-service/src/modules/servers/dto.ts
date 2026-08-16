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
import { SERVER_ROLES } from '@nexora/permissions';
import { UPLOADED_PICTURE_URL } from '@nexora/shared-types';
import type {
  AddServerMemberRequest,
  ChannelType,
  CreateChannelRequest,
  CreateServerRequest,
  ServerRole,
  SetChannelMembersRequest,
  UpdateChannelRequest,
  UpdateServerMemberRequest,
  UpdateServerRequest,
} from '@nexora/shared-types';

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
}
