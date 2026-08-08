import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { PublishChannelKeysRequest, RegisterDeviceKeyRequest } from '@nexora/shared-types';

/** A serialised ECDH P-256 JWK is ~200 chars; the cap is slack, not a guess. */
const MAX_PUBLIC_KEY_LENGTH = 1024;

export class RegisterDeviceKeyDto implements RegisterDeviceKeyRequest {
  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  publicKey!: string;
}

export class ChannelKeyEntryDto {
  @IsUUID()
  recipientUserId!: string;

  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  senderPublicKey!: string;

  @IsString()
  @Length(1, 512)
  wrappedKey!: string;

  @IsString()
  @Length(1, 64)
  iv!: string;
}

export class PublishChannelKeysDto implements PublishChannelKeysRequest {
  @IsUUID()
  channelId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  epoch!: number;

  @IsArray()
  // One entry per workspace member; a bigger bundle than this is not a real
  // workspace, it is someone probing the endpoint.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ChannelKeyEntryDto)
  entries!: ChannelKeyEntryDto[];
}
