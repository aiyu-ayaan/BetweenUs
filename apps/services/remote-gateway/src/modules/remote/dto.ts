import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import type {
  EnrolMachineRequest,
  RemotePermission,
  SetRemoteGrantRequest,
  StartRemoteSessionRequest,
} from '@nexora/shared-types';

export class EnrolMachineDto implements EnrolMachineRequest {
  @IsString()
  @Length(1, 64)
  name!: string;

  @IsString()
  @Length(1, 32)
  platform!: string;

  /** Present when this machine has enrolled before; it rotates the token. */
  @IsOptional()
  @IsUUID()
  machineId?: string;
}

export class RenameMachineDto {
  @IsString()
  @Length(1, 64)
  name!: string;
}

export class SetRemoteGrantDto implements SetRemoteGrantRequest {
  @IsUUID()
  userId!: string;

  /** Empty revokes. Names are validated against the vocabulary in the service. */
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  permissions!: RemotePermission[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

export class StartRemoteSessionDto implements StartRemoteSessionRequest {
  @IsUUID()
  machineId!: string;
}
