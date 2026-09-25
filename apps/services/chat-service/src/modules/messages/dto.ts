import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MAX_MESSAGE_CONTENT_LENGTH,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
} from '@betweenus/shared-types';
import type {
  ClearChatsRequest,
  CreateMessageRequest,
  CreatePollSettings,
  MarkThreadReadRequest,
  ReactToMessageRequest,
  UpdateMessageRequest,
  VotePollRequest,
} from '@betweenus/shared-types';

/**
 * What the server is told about a poll: numbers only. The question and the
 * labels are sealed in `content` beside it. The duration is checked against
 * `POLL_DURATIONS` by the service, which is also what turns it into a moment.
 */
export class CreatePollDto implements CreatePollSettings {
  @IsInt()
  @Min(POLL_MIN_OPTIONS)
  @Max(POLL_MAX_OPTIONS)
  optionCount!: number;

  @IsOptional()
  @IsBoolean()
  multiChoice?: boolean;

  @IsOptional()
  @IsInt()
  durationSeconds?: number | null;
}

export class CreateMessageDto implements CreateMessageRequest {
  @IsUUID()
  channelId!: string;

  /**
   * Ciphertext envelope, not plaintext - see development/E2EE.md. The ceiling
   * is generous because the envelope also carries the attachment manifest:
   * a key, a name, a size and a content type per file, all encrypted.
   */
  @IsString()
  @Length(1, MAX_MESSAGE_CONTENT_LENGTH)
  content!: string;

  /**
   * Which uploaded blobs this message claims. Only keys this account uploaded
   * and nothing else has claimed are taken; anything else is ignored rather
   * than refused, because a message is not worth failing over a stale key.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  attachmentKeys?: string[];

  /**
   * Send this as a one-time message: its media may be opened once by somebody
   * other than the author, and that opening destroys the row and its blobs.
   *
   * The one thing about a message the server is told in the clear besides who
   * sent it and when, and it has to be: burning is a row update and a blob
   * delete, neither of which a server that cannot read the body can be asked
   * to do by the body.
   */
  @IsOptional()
  @IsBoolean()
  viewOnce?: boolean;

  /** Send this as a poll. See `CreatePollDto`. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePollDto)
  poll?: CreatePollDto;

  /**
   * Post into the thread under this root instead of the channel. The pointer
   * is the only thing about a thread the server is told; the body is sealed
   * with the channel key like any other message.
   */
  @IsOptional()
  @IsUUID()
  threadRootId?: string;
}

export class UpdateMessageDto implements UpdateMessageRequest {
  /** The replacement envelope, same shape and same ceiling as the original. */
  @IsString()
  @Length(1, MAX_MESSAGE_CONTENT_LENGTH)
  content!: string;
}

export class ReactToMessageDto implements ReactToMessageRequest {
  /**
   * The emoji itself. The service checks it further - no whitespace, and short
   * enough to be one symbol rather than a paragraph.
   */
  @IsString()
  @Length(1, 32)
  emoji!: string;
}

/**
 * A whole ballot: the option indexes chosen, never their labels. An empty list
 * takes the vote back. Range and single-choice are the service's to check,
 * because only it knows how many options this poll has.
 */
export class VotePollDto implements VotePollRequest {
  @IsArray()
  @ArrayMaxSize(POLL_MAX_OPTIONS)
  @IsInt({ each: true })
  options!: number[];
}

export class MessageQueryDto {
  @IsUUID()
  channelId!: string;

  /** Message id to page backwards from. */
  @IsOptional()
  @IsUUID()
  before?: string;

  /**
   * Page this root's thread instead of the channel's timeline. Absent means
   * the timeline, which never includes thread replies.
   */
  @IsOptional()
  @IsUUID()
  threadRootId?: string;
}

export class PinQueryDto {
  @IsUUID()
  channelId!: string;
}

/**
 * What to clear. An absent or null `channelId` means every conversation, which
 * is what an older client that sends no body at all also means.
 */
export class ClearChatsDto implements ClearChatsRequest {
  @IsOptional()
  @IsUUID()
  channelId?: string | null;
}

/** Narrows the followed-threads list to one server; absent means everywhere. */
export class FollowedThreadsQueryDto {
  @IsOptional()
  @IsUUID()
  serverId?: string;
}

/** The newest reply the client has on screen in a thread. */
export class MarkThreadReadDto implements MarkThreadReadRequest {
  @IsUUID()
  messageId!: string;
}
