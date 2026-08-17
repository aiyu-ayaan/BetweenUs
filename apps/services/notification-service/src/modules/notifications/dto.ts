import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/** A day has 1440 minutes; anything else is not a time of day. */
const MINUTES_IN_DAY = 1439;

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Null is meaningful here - it clears the window - so it has to pass the
  // validator rather than be rejected as a non-integer.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  quietStartMinute?: number | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY)
  quietEndMinute?: number | null;

  /** The whole list, not a delta. Capped so one account cannot store a novel. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  mutedChannelIds?: string[];

  /** Same shape and same cap: the mentions-only list is the other half of it. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  mentionOnlyChannelIds?: string[];

  /** People rather than channels, same shape and same cap. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  mutedUserIds?: string[];
}

export class MarkReadDto {
  @IsUUID()
  channelId!: string;
}
