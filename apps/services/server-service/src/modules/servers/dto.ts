import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { SERVER_ROLES } from '@nexora/permissions';
import type {
  ChannelType,
  CreateChannelRequest,
  CreateServerRequest,
  ServerRole,
  UpdateServerMemberRequest,
  UpdateServerRequest,
} from '@nexora/shared-types';

export class CreateServerDto implements CreateServerRequest {
  @IsString()
  @Length(2, 64)
  name!: string;
}

export class JoinServerDto {
  @IsString()
  @Length(2, 64)
  slug!: string;
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
}

export class UpdateServerDto implements UpdateServerRequest {
  @IsOptional()
  @IsString()
  @Length(2, 64)
  name?: string;
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
