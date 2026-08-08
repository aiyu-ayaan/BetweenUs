import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { ChannelType, CreateChannelRequest, CreateWorkspaceRequest } from '@nexora/shared-types';

export class CreateWorkspaceDto implements CreateWorkspaceRequest {
  @IsString()
  @Length(2, 64)
  name!: string;
}

export class JoinWorkspaceDto {
  @IsString()
  @Length(2, 64)
  slug!: string;
}

export class CreateChannelDto implements CreateChannelRequest {
  @IsUUID()
  workspaceId!: string;

  @IsString()
  @Length(1, 32)
  name!: string;

  @IsOptional()
  @IsIn(['TEXT', 'VOICE'])
  type?: ChannelType;
}
