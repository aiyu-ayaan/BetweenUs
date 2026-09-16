import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import type {
  EnrolMachineRequest,
  RemotePermission,
  RemoteSessionUsage,
  SetRemoteGrantRequest,
  StartRemoteSessionRequest,
} from '@betweenus/shared-types';

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

/**
 * What the controller's machine counted, sent as it leaves.
 *
 * Every field is optional: a client that reports nothing is a session that
 * reads as zero, which is exactly what a window killed mid-session is, and a
 * build that predates this reports nothing at all. Numbers are clamped in the
 * service rather than bounded here - the ceiling belongs with the thing that
 * writes the row.
 */
export class EndRemoteSessionDto implements Partial<RemoteSessionUsage> {
  @IsOptional()
  @IsNumber()
  bytesSent?: number;

  @IsOptional()
  @IsNumber()
  bytesReceived?: number;

  @IsOptional()
  @IsIn(['direct', 'relay'])
  transport?: 'direct' | 'relay' | null;
}
