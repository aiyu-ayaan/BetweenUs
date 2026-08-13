import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  BackupSecretKind,
  PublishChannelKeysRequest,
  PutIdentityBackupRequest,
  RegisterDeviceKeyRequest,
} from '@nexora/shared-types';

/** A serialised ECDH P-256 JWK is ~200 chars; the cap is slack, not a guess. */
const MAX_PUBLIC_KEY_LENGTH = 1024;

export class RegisterDeviceKeyDto implements RegisterDeviceKeyRequest {
  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  publicKey!: string;
}

/**
 * A sealed identity key. The server checks shape and size only - it cannot tell
 * a real blob from noise - except for the iteration floor, which is worth
 * enforcing: it is the one number in here that decides how expensive guessing
 * the user's secret would be for whoever steals the table.
 */
export class PutIdentityBackupDto implements PutIdentityBackupRequest {
  @Equals(1)
  v!: 1;

  @IsIn(['password', 'passphrase'])
  kind!: BackupSecretKind;

  @IsIn(['PBKDF2-SHA256'])
  kdf!: 'PBKDF2-SHA256';

  @IsInt()
  @Min(100_000)
  @Max(10_000_000)
  iterations!: number;

  @IsString()
  @Length(16, 128)
  salt!: string;

  @IsString()
  @Length(1, 64)
  iv!: string;

  // An ECDH P-256 key pair as JWK JSON is ~600 bytes; base64 of its ciphertext
  // is under 1 KB. The cap is slack for a future format, not a guess at this one.
  @IsString()
  @Length(1, 4096)
  ct!: string;

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
  // One entry per server member; a bigger bundle than this is not a real
  // server, it is someone probing the endpoint.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ChannelKeyEntryDto)
  entries!: ChannelKeyEntryDto[];
}
