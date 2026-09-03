import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  UPLOADED_PICTURE_URL,
  WEBHOOK_CONTENT_MAX_LENGTH,
  WEBHOOK_NAME_MAX_LENGTH,
  type CreateWebhookRequest,
  type ExecuteWebhookRequest,
  type UpdateWebhookRequest,
  type WebhookEmbed,
} from '@betweenus/shared-types';

export class CreateWebhookDto implements CreateWebhookRequest {
  @IsUUID()
  channelId!: string;

  @IsString()
  @Length(1, WEBHOOK_NAME_MAX_LENGTH)
  name!: string;

  /**
   * It has to be one of ours, for the reason an avatar does: this picture is
   * drawn in every client that can see the channel, so an arbitrary URL would
   * be a beacon reporting who read it.
   */
  @IsOptional()
  @ValidateIf((dto: CreateWebhookDto) => dto.avatarUrl !== null && dto.avatarUrl !== undefined)
  @IsString()
  @MaxLength(512)
  @Matches(UPLOADED_PICTURE_URL, { message: 'avatarUrl must be an uploaded picture' })
  avatarUrl?: string | null;
}

export class UpdateWebhookDto implements UpdateWebhookRequest {
  @IsOptional()
  @IsString()
  @Length(1, WEBHOOK_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @ValidateIf((dto: UpdateWebhookDto) => dto.avatarUrl !== null && dto.avatarUrl !== undefined)
  @IsString()
  @MaxLength(512)
  @Matches(UPLOADED_PICTURE_URL, { message: 'avatarUrl must be an uploaded picture' })
  avatarUrl?: string | null;
}

/** The part of a Discord embed this app draws. See `renderBody`. */
export class WebhookEmbedDto implements WebhookEmbed {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(WEBHOOK_CONTENT_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsInt()
  color?: number;

  /**
   * Left loose on purpose.
   *
   * Every field here is optional and every one of them is rendered by
   * `renderEmbed`, which reads each value defensively because the payloads
   * arrive from integrations written against Discord rather than against this.
   * Validating the shape strictly would turn "we did not draw your footer" into
   * "your deploy notification 400s", and the whole point of copying Discord's
   * body is that an existing integration works by changing only the URL.
   */
  @IsOptional()
  @IsArray()
  fields?: Array<{ name: string; value: string; inline?: boolean }>;

  @IsOptional()
  footer?: { text: string };

  @IsOptional()
  @IsString()
  timestamp?: string;
}

export class ExecuteWebhookDto implements ExecuteWebhookRequest {
  /**
   * Optional because `embeds` may carry the whole message. The service refuses
   * a payload that renders to nothing, which is the check that actually
   * matters and cannot be written as a decorator on one field.
   */
  @IsOptional()
  @IsString()
  @MaxLength(WEBHOOK_CONTENT_MAX_LENGTH)
  content?: string;

  /** Accepted and ignored; the response lists it. See `ignoredFields`. */
  @IsOptional()
  @IsString()
  @MaxLength(WEBHOOK_NAME_MAX_LENGTH)
  username?: string;

  /** Accepted and ignored; the response lists it. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatar_url?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WebhookEmbedDto)
  embeds?: WebhookEmbedDto[];
}
