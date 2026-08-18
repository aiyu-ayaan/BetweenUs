import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
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
} from '@betweenus/shared-types';

/** A serialised ECDH P-256 JWK is ~200 chars; the cap is slack, not a guess. */
const MAX_PUBLIC_KEY_LENGTH = 1024;

/**
 * A device id is minted by the client and is opaque here. Not a UUID pipe: the
 * one thing the server must never do with it is assume a shape it did not
 * issue, and the rows carried over from the single-key directory are called
 * `legacy`.
 */
const MAX_DEVICE_ID_LENGTH = 128;

export class RegisterDeviceKeyDto implements RegisterDeviceKeyRequest {
  @IsString()
  @Length(1, MAX_DEVICE_ID_LENGTH)
  deviceId!: string;

  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  publicKey!: string;

  /** Shown in a list of this account's machines, so it is short and optional. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  label?: string;
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
  @Length(1, MAX_DEVICE_ID_LENGTH)
  recipientDeviceId!: string;

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

  @IsString()
  @Length(1, MAX_DEVICE_ID_LENGTH)
  senderDeviceId!: string;

  @IsArray()
  // One entry per member *device* now rather than per member, so the ceiling
  // rises with it. Still small enough that a bigger bundle is not a real server,
  // it is someone probing the endpoint.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ChannelKeyEntryDto)
  entries!: ChannelKeyEntryDto[];
}
