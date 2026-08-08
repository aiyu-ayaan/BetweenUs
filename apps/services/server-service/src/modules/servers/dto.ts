import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { ChannelType, CreateChannelRequest, CreateServerRequest } from '@nexora/shared-types';

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
