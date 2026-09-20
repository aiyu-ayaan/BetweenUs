import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
  ValidatorConstraint,
  registerDecorator,
  type ValidatorConstraintInterface,
} from 'class-validator';
import {
  ACCOUNT_SCOPE,
  isClientDeviceId,
  type BackupSecretKind,
  type CreateVaultRequest,
  type PublishChannelKeysRequest,
  type PutIdentityBackupRequest,
  type PutVaultFactorRequest,
  type RegisterDeviceKeyRequest,
  type RotateVaultRequest,
  type SealedKeyring,
  type VaultFactorKind,
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

/**
 * A device id a *client* may mint.
 *
 * The `@` namespace is the server's: `@account` is what an account-scoped
 * channel key is filed under, and a machine that could claim it would be a
 * machine able to write a wrap everybody else believes is addressed to the
 * account. One line, and the whole of what keeps the two namespaces apart.
 */
@ValidatorConstraint({ name: 'clientDeviceId', async: false })
class ClientDeviceIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isClientDeviceId(value);
  }

  defaultMessage(): string {
    return `A device id may not begin with "@" (reserved, e.g. "${ACCOUNT_SCOPE}")`;
  }
}

/** The same rule, for a field that is legitimately empty on a portable factor. */
@ValidatorConstraint({ name: 'clientDeviceIdOrEmpty', async: false })
class ClientDeviceIdOrEmptyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return value === '' || (typeof value === 'string' && isClientDeviceId(value));
  }

  defaultMessage(): string {
    return `A device id may not begin with "@" (reserved, e.g. "${ACCOUNT_SCOPE}")`;
  }
}

export function IsClientDeviceIdOrEmpty() {
  return function decorate(object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      constraints: [],
      validator: ClientDeviceIdOrEmptyConstraint,
    });
  };
}

export function IsClientDeviceId() {
  return function decorate(object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      constraints: [],
      validator: ClientDeviceIdConstraint,
    });
  };
}

export class RegisterDeviceKeyDto implements RegisterDeviceKeyRequest {
  @IsString()
  @Length(1, MAX_DEVICE_ID_LENGTH)
  @IsClientDeviceId()
  deviceId!: string;

  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  publicKey!: string;

  /** Shown in a list of this account's machines, so it is short and optional. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  label?: string;

  /** See the note on `RegisterDeviceKeyRequest.holdsVault`. */
  @IsOptional()
  @IsBoolean()
  holdsVault?: boolean;
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

  /**
   * `@account` for everything written now. Not constrained to it here: the
   * service refuses a device-scoped wrap with a code the client can act on,
   * and a 400 from a validator would say nothing about *why* the shape that
   * worked in v1 no longer does.
   */
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
  @IsClientDeviceId()
  senderDeviceId!: string;

  @IsArray()
  // One entry per member account, which is where it was before v1 went per
  // device and where it stays however many machines those people sign in on.
  // The ceiling is kept high because a promotion bundle from a long-running
  // install can carry many epochs at once; a bigger one is not a real server,
  // it is someone probing the endpoint.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ChannelKeyEntryDto)
  entries!: ChannelKeyEntryDto[];
}

// --- The account vault --------------------------------------------------------

/** A base64 AES-GCM blob's worth of slack. A keyring of 32 generations fits. */
const MAX_KEYRING_LENGTH = 65536;

export class SealedKeyringDto implements SealedKeyring {
  @Equals(1)
  v!: 1;

  @IsString()
  @Length(1, 64)
  iv!: string;

  @IsString()
  @Length(1, MAX_KEYRING_LENGTH)
  ct!: string;
}

/**
 * One door into the vault.
 *
 * The shape rules that matter - a PBKDF2 iteration floor, an ECDH factor that
 * names the machine it is for - are enforced in the service rather than here,
 * because they are conditional on `kind` and a decorator cannot say "required
 * unless". What this class does is bound every field so a malformed body
 * cannot reach that logic, and refuse a `deviceId` in the reserved namespace.
 */
export class VaultFactorDto implements PutVaultFactorRequest {
  @Equals(1)
  v!: 1;

  @IsIn(['password', 'passphrase', 'recovery-code', 'device'])
  kind!: VaultFactorKind;

  /** Empty for the portable kinds; a machine's own id for a grant. */
  @IsString()
  @Length(0, MAX_DEVICE_ID_LENGTH)
  @IsClientDeviceIdOrEmpty()
  deviceId!: string;

  @IsIn(['PBKDF2-SHA256', 'ECDH-HKDF-SHA256'])
  kdf!: 'PBKDF2-SHA256' | 'ECDH-HKDF-SHA256';

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  iterations!: number;

  @IsString()
  @Length(0, 128)
  salt!: string;

  @IsString()
  @Length(1, 64)
  iv!: string;

  /** 32 bytes of master key, sealed. Base64 of that is well under this. */
  @IsString()
  @Length(1, 1024)
  ct!: string;

  @IsString()
  @Length(0, MAX_PUBLIC_KEY_LENGTH)
  senderPublicKey!: string;
}

export class PutVaultFactorDto extends VaultFactorDto {}

export class CreateVaultDto implements CreateVaultRequest {
  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  publicKey!: string;

  @ValidateNested()
  @Type(() => SealedKeyringDto)
  keyring!: SealedKeyringDto;

  @IsArray()
  // Four kinds exist and only `device` repeats, so anything past this is not a
  // vault being created, it is somebody filling the table.
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => VaultFactorDto)
  factors!: VaultFactorDto[];
}

export class RotateVaultDto implements RotateVaultRequest {
  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  publicKey!: string;

  @IsInt()
  @Min(2)
  @Max(1_000_000)
  generation!: number;

  @ValidateNested()
  @Type(() => SealedKeyringDto)
  keyring!: SealedKeyringDto;
}

export class RequestVaultGrantDto {
  @IsString()
  @Length(1, MAX_DEVICE_ID_LENGTH)
  @IsClientDeviceId()
  deviceId!: string;

  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  publicKey!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  label?: string;

  /** Sixty digits in groups, or whatever the clients agree on. Bounded, not parsed. */
  @IsString()
  @Length(1, 128)
  fingerprint!: string;
}
